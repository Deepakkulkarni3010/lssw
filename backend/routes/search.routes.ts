import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.middleware';
import { searchRateLimiter } from '../middleware/rateLimit.middleware';
import { auditLog } from '../middleware/gdpr.middleware';
import { redisClient, keys, getRateLimitCount } from '../redis/client';
import { db } from '../db';
import { searchHistory, searchResults, linkedinSessions } from '../db/schema';
import { linkedInAdapter } from '../adapters/linkedin/PlaywrightAdapter';
import { hashSearchParams, decrypt } from '../utils/crypto';
import { logger } from '../utils/logger';
import { config } from '../config';
import type { SearchParams, SearchJob } from '../types';
import { eq } from 'drizzle-orm';

const router = Router();

// ─── Validation Schema ────────────────────────────────────────────────────────

const SearchParamsSchema = z.object({
  keywords:          z.string().max(200).optional(),
  firstName:         z.string().max(100).optional(),
  lastName:          z.string().max(100).optional(),
  title:             z.string().max(100).optional(),
  company:           z.string().max(100).optional(),
  location:          z.string().max(150).optional(),
  industry:          z.string().max(100).optional(),
  school:            z.string().max(100).optional(),
  connectionDegree:  z.array(z.enum(['F', 'S', 'O'])).max(3).optional(),
  yearsOfExperience: z.string().max(20).optional(),
  companySize:       z.string().max(50).optional(),
  customString:      z.string().max(500).optional(),
  templateId:        z.string().max(50).optional(),
  page:              z.number().int().min(1).max(100).optional().default(1),
});

// ─── Load LinkedIn cookies from DB into Playwright ───────────────────────────

async function ensureLinkedInSession(userId: string): Promise<boolean> {
  try {
    const [session] = await db
      .select()
      .from(linkedinSessions)
      .where(eq(linkedinSessions.userId, userId))
      .limit(1);

    if (!session || !session.isActive) {
      logger.warn('No LinkedIn session configured for user', { userId });
      return false;
    }

    const liAt = decrypt(session.liAt);
    const jsessionid = decrypt(session.jsessionid);
    await linkedInAdapter.injectLinkedInSession(userId, liAt, jsessionid);
    logger.debug('LinkedIn session loaded from DB', { userId });
    return true;
  } catch (err) {
    logger.error('Failed to load LinkedIn session from DB', { userId, error: String(err) });
    return false;
  }
}

// ─── POST /api/search — initiate a search ────────────────────────────────────

router.post('/', requireAuth, searchRateLimiter, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const parsed = SearchParamsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: { code: 'INVALID_PARAMS', message: parsed.error.message },
    });
  }

  const { page, ...searchParams } = parsed.data;
  const jobId = `job_${uuidv4().replace(/-/g, '')}`;

  // Create history entry
  const [historyEntry] = await db.insert(searchHistory).values({
    userId,
    searchParams,
    status: 'pending',
    purgeDueAt: new Date(Date.now() + config.gdpr.dataRetentionDays * 24 * 60 * 60 * 1000),
  }).returning();

  // Store job in Redis (300s TTL — enough for Playwright to finish)
  const job: SearchJob = {
    jobId,
    userId,
    params: searchParams,
    status: 'pending',
    createdAt: new Date(),
  };
  await redisClient.setex(keys.jobStatus(jobId), 300, JSON.stringify(job));

  // Execute search asynchronously
  executeSearchAsync(jobId, userId, searchParams, page || 1, historyEntry.id)
    .catch((err) => logger.error('Async search error', { jobId, error: err.message }));

  await auditLog(req, 'read', 'linkedin.search', { paramsKeys: Object.keys(searchParams) });

  return res.status(202).json({
    jobId,
    estimatedSeconds: 15,
    sseUrl: `/api/search/stream/${jobId}`,
    pollUrl: `/api/search/status/${jobId}`,
  });
});

// ─── Async Search Execution ───────────────────────────────────────────────────

async function executeSearchAsync(
  jobId: string,
  userId: string,
  params: SearchParams,
  page: number,
  historyId: string,
): Promise<void> {
  const startMs = Date.now();

  // Update job: running
  await redisClient.setex(keys.jobStatus(jobId), 300, JSON.stringify({
    jobId, userId, params, status: 'running', createdAt: new Date(),
  }));
  await db.update(searchHistory).set({ status: 'running' }).where(eq(searchHistory.id, historyId));

  try {
    // Check result cache (Redis — fast path)
    const cacheKey = keys.resultCache(hashSearchParams({ ...params, page }));
    const cached = await redisClient.get(cacheKey);
    if (cached) {
      const cachedResult = JSON.parse(cached);
      await finalizeJob(jobId, historyId, userId, cacheKey, cachedResult.total, startMs, true);
      return;
    }

    // Load LinkedIn session cookies from DB into Playwright
    await ensureLinkedInSession(userId);

    // Execute via Playwright
    const { results, hasMore } = await linkedInAdapter.executeSearch(params, userId, page);
    const durationMs = Date.now() - startMs;

    const resultPayload = {
      total: results.length,
      page,
      perPage: 10,
      results,
      cached: false,
      executedAt: new Date().toISOString(),
      hasMore,
      durationMs,
    };

    // Persist to DB (permanent, GDPR-purged at 90 days)
    await db.insert(searchResults).values({
      searchHistoryId: historyId,
      userId,
      resultsJson: results as any,
      totalCount: results.length,
      pageNumber: page,
      hasMore,
      durationMs,
    }).onConflictDoUpdate({
      target: searchResults.searchHistoryId,
      set: {
        resultsJson: results as any,
        totalCount: results.length,
        hasMore,
        durationMs,
        storedAt: new Date(),
      },
    });

    // Also cache in Redis for quick retrieval (10 min TTL)
    await redisClient.setex(cacheKey, config.cache.resultTtlSeconds, JSON.stringify(resultPayload));

    await finalizeJob(jobId, historyId, userId, cacheKey, results.length, startMs, false);

  } catch (err) {
    const error = err as Error;
    let status: 'failed' | 'rate_limited' | 'captcha' = 'failed';
    if (error.message === 'LINKEDIN_CAPTCHA') status = 'captcha';
    if (error.message.includes('RATE_LIMIT')) status = 'rate_limited';

    logger.error('Search execution failed', { jobId, error: error.message });
    await redisClient.setex(keys.jobStatus(jobId), 120, JSON.stringify({
      jobId, userId, params, status, error: error.message, createdAt: new Date(),
    }));
    await db.update(searchHistory).set({
      status,
      errorMessage: error.message,
      durationMs: Date.now() - startMs,
    }).where(eq(searchHistory.id, historyId));
  }
}

async function finalizeJob(
  jobId: string,
  historyId: string,
  userId: string,
  resultKey: string,
  resultCount: number,
  startMs: number,
  cached: boolean,
): Promise<void> {
  await redisClient.setex(keys.jobStatus(jobId), 300, JSON.stringify({
    jobId, userId, status: 'completed', resultKey, historyId, createdAt: new Date(), completedAt: new Date(),
  }));
  await db.update(searchHistory).set({
    status: 'completed',
    resultCount,
    durationMs: Date.now() - startMs,
  }).where(eq(searchHistory.id, historyId));
}

// ─── GET /api/search/status/:jobId ────────────────────────────────────────────

router.get('/status/:jobId', requireAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const stored = await redisClient.get(keys.jobStatus(jobId));
  if (!stored) {
    return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Job not found or expired' } });
  }
  const job = JSON.parse(stored) as SearchJob;
  if (job.userId !== req.session.userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }
  return res.json(job);
});

// ─── GET /api/search/stream/:jobId (Server-Sent Events) ──────────────────────

router.get('/stream/:jobId', requireAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  const send = (event: string, data: object) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const poll = setInterval(async () => {
    const stored = await redisClient.get(keys.jobStatus(jobId));
    if (!stored) {
      send('error', { code: 'JOB_NOT_FOUND' });
      clearInterval(poll);
      res.end();
      return;
    }
    const job = JSON.parse(stored) as SearchJob;
    send('status', job);
    if (['completed', 'failed', 'captcha', 'rate_limited'].includes(job.status)) {
      clearInterval(poll);
      res.end();
    }
  }, 500);

  req.on('close', () => clearInterval(poll));
});

// ─── GET /api/search/results/:jobId ──────────────────────────────────────────

router.get('/results/:jobId', requireAuth, async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const stored = await redisClient.get(keys.jobStatus(jobId));
  if (!stored) {
    return res.status(404).json({ error: { code: 'JOB_NOT_FOUND', message: 'Results expired' } });
  }
  const job = JSON.parse(stored) as SearchJob;
  if (job.userId !== req.session.userId) {
    return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
  }
  if (job.status !== 'completed') {
    return res.status(404).json({ error: { code: 'RESULTS_NOT_READY', message: 'Results not ready' } });
  }

  // Try Redis cache first (fast path)
  if (job.resultKey) {
    const cached = await redisClient.get(job.resultKey);
    if (cached) {
      return res.json(JSON.parse(cached));
    }
  }

  // Fall back to DB (persistent path)
  if (job.historyId) {
    try {
      const [dbResult] = await db
        .select()
        .from(searchResults)
        .where(eq(searchResults.searchHistoryId, job.historyId))
        .limit(1);

      if (dbResult) {
        return res.json({
          total: dbResult.totalCount,
          page: dbResult.pageNumber,
          perPage: 10,
          results: dbResult.resultsJson,
          cached: false,
          executedAt: dbResult.storedAt.toISOString(),
          hasMore: dbResult.hasMore,
          durationMs: dbResult.durationMs,
        });
      }
    } catch (dbErr) {
      logger.error('DB results lookup failed', { error: String(dbErr) });
    }
  }

  return res.status(404).json({ error: { code: 'RESULTS_EXPIRED', message: 'Results have expired' } });
});

// ─── GET /api/search/history/:historyId/results ───────────────────────────────
// Fetch stored results for a past search (from DB, for history page replay)

router.get('/history/:historyId/results', requireAuth, async (req: Request, res: Response) => {
  const { historyId } = req.params;
  const userId = req.session.userId!;

  try {
    const [dbResult] = await db
      .select()
      .from(searchResults)
      .where(eq(searchResults.searchHistoryId, historyId))
      .limit(1);

    if (!dbResult) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No results stored for this search' } });
    }
    if (dbResult.userId !== userId) {
      return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Access denied' } });
    }

    return res.json({
      total: dbResult.totalCount,
      page: dbResult.pageNumber,
      perPage: 10,
      results: dbResult.resultsJson,
      cached: false,
      executedAt: dbResult.storedAt.toISOString(),
      hasMore: dbResult.hasMore,
      durationMs: dbResult.durationMs,
    });
  } catch (err) {
    logger.error('Error fetching history results', { error: String(err) });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// ─── GET /api/search/rate-limit ───────────────────────────────────────────────

router.get('/rate-limit', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const used = await getRateLimitCount(userId);
  const limit = config.rateLimit.searchesPerHour;
  const epochHour = Math.floor(Date.now() / 1000 / 3600);
  const resetAt = (epochHour + 1) * 3600 * 1000;
  return res.json({ used, limit, remaining: Math.max(0, limit - used), resetAt });
});

export default router;
