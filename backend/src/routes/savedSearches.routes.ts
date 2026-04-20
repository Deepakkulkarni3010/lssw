import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { requireAuth } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/gdpr.middleware';
import { db } from '../db';
import { savedSearches, searchHistory } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';
import { config } from '../config';

const router = Router();

const SavedSearchSchema = z.object({
  name:         z.string().min(1).max(255),
  description:  z.string().max(1000).optional(),
  searchParams: z.object({
    keywords:          z.string().max(200).optional(),
    title:             z.string().max(100).optional(),
    company:           z.string().max(100).optional(),
    location:          z.string().max(150).optional(),
    industry:          z.string().max(100).optional(),
    school:            z.string().max(100).optional(),
    connectionDegree:  z.array(z.enum(['F', 'S', 'O'])).max(3).optional(),
    yearsOfExperience: z.string().max(20).optional(),
    customString:      z.string().max(500).optional(),
    templateId:        z.string().max(50).optional(),
  }),
  isTemplate: z.boolean().optional().default(false),
});

// GET /api/saved-searches
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const searches = await db
      .select()
      .from(savedSearches)
      .where(eq(savedSearches.userId, userId))
      .orderBy(desc(savedSearches.updatedAt));

    await auditLog(req, 'read', 'saved_searches.list');
    return res.json({ data: searches, total: searches.length });
  } catch (err) {
    logger.error('Error fetching saved searches', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// POST /api/saved-searches
router.post('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const parsed = SavedSearchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: parsed.error.message } });
  }

  try {
    const [search] = await db.insert(savedSearches).values({
      userId,
      ...(parsed.data as any),
    }).returning();

    await auditLog(req, 'write', 'saved_searches.create', { id: search.id });
    return res.status(201).json(search);
  } catch (err) {
    logger.error('Error creating saved search', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// PUT /api/saved-searches/:id
router.put('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  const parsed = SavedSearchSchema.partial().safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: parsed.error.message } });
  }

  try {
    const [updated] = await db
      .update(savedSearches)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Saved search not found' } });
    }

    await auditLog(req, 'write', 'saved_searches.update', { id });
    return res.json(updated);
  } catch (err) {
    logger.error('Error updating saved search', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// DELETE /api/saved-searches/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;

  try {
    const deleted = await db
      .delete(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)))
      .returning();

    if (!deleted.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Saved search not found' } });
    }

    await auditLog(req, 'delete', 'saved_searches.delete', { id });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting saved search', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// POST /api/saved-searches/:id/run — run a saved search
router.post('/:id/run', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;

  try {
    const [search] = await db
      .select()
      .from(savedSearches)
      .where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId)))
      .limit(1);

    if (!search) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Saved search not found' } });
    }

    // Update run count
    await db.update(savedSearches).set({
      runCount: search.runCount + 1,
      lastRunAt: new Date(),
    }).where(eq(savedSearches.id, id));

    // Delegate to search handler logic
    req.body = { ...(search.searchParams as object), savedSearchId: id };
    return res.redirect(307, '/api/search');
  } catch (err) {
    logger.error('Error running saved search', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// GET /api/templates — predefined search string templates
router.get('/templates', requireAuth, (_req: Request, res: Response) => {
  return res.json({
    templates: [
      { id: 'open-to-work', name: 'Open to Work', string: '#OpenToWork OR "Open to work" OR "Actively looking"' },
      { id: 'immediate-joiner', name: 'Immediate Joiner', string: '"Immediate joiner" OR "Notice period: 0" OR "Joining immediately"' },
      { id: 'notice-30', name: '≤30 Days Notice', string: '"30 days notice" OR "1 month notice" OR "serving notice"' },
      { id: 'actively-hiring', name: 'Recruiting Boolean', string: '"(Java OR Python OR React)" AND "(AWS OR GCP OR Azure)"' },
      { id: 'senior-only', name: 'Senior+ Roles', string: '"Senior" OR "Lead" OR "Principal" OR "Staff" OR "Manager"' },
      { id: 'fresh-grad', name: 'Fresh Graduate', string: '"2023" OR "2024" OR "fresher" OR "entry level" OR "graduate"' },
      { id: 'remote-ok', name: 'Open to Remote', string: '"Remote" OR "Work from home" OR "WFH" OR "fully remote"' },
      { id: 'ex-faang', name: 'Ex-FAANG', string: '(Google OR Meta OR Amazon OR Apple OR Netflix OR Microsoft) AND (ex OR former OR previously)' },
    ],
  });
});

export default router;
