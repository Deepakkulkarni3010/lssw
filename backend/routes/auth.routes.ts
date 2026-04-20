import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { users, linkedinSessions } from '../db/schema';
import { redisClient, keys } from '../redis/client';
import { encrypt, decrypt, generateRandomState, generateCodeVerifier, generateCodeChallenge } from '../utils/crypto';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/gdpr.middleware';
import { requireAuth } from '../middleware/auth.middleware';
import { eq } from 'drizzle-orm';

const router = Router();

// ─── LinkedIn OAuth 2.0 PKCE Initiation ──────────────────────────────────────

router.get('/linkedin', async (req: Request, res: Response) => {
  const state = generateRandomState();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(codeVerifier);

  // Store state + verifier in Redis (5 min TTL) and session
  await redisClient.setex(keys.oauthState(state), 300, codeVerifier);
  req.session.oauthState = state;
  req.session.codeVerifier = codeVerifier;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.callbackUrl,
    state,
    scope: config.linkedin.scopes.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  res.redirect(`https://www.linkedin.com/oauth/v2/authorization?${params}`);
});

// ─── LinkedIn OAuth 2.0 Callback ──────────────────────────────────────────────

const callbackSchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

router.get('/linkedin/callback', async (req: Request, res: Response) => {
  const frontendBase = config.allowedOrigins[0];

  try {
    const parsed = callbackSchema.safeParse(req.query);
    if (!parsed.success) {
      return res.redirect(`${frontendBase}/?error=invalid_callback`);
    }

    const { code, state } = parsed.data;

    // Validate state against Redis
    const storedVerifier = await redisClient.get(keys.oauthState(state));
    if (!storedVerifier || state !== req.session.oauthState) {
      logger.warn('OAuth state mismatch — possible CSRF', { state });
      return res.redirect(`${frontendBase}/?error=state_mismatch`);
    }
    await redisClient.del(keys.oauthState(state));

    // Exchange code for tokens
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.linkedin.clientId,
        client_secret: config.linkedin.clientSecret,
        redirect_uri: config.linkedin.callbackUrl,
        code_verifier: storedVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      logger.error('Token exchange failed', { status: tokenResponse.status });
      return res.redirect(`${frontendBase}/?error=token_exchange_failed`);
    }

    const tokens = await tokenResponse.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in: number;
    };

    // Fetch LinkedIn user profile (OpenID Connect)
    const profileResponse = await fetch('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!profileResponse.ok) {
      return res.redirect(`${frontendBase}/?error=profile_fetch_failed`);
    }

    const profile = await profileResponse.json() as {
      sub: string;
      name: string;
      email?: string;
      picture?: string;
      headline?: string;
    };

    // Upsert user in database
    const [user] = await db
      .insert(users)
      .values({
        linkedinId: profile.sub,
        fullName: profile.name,
        email: profile.email,
        profilePic: profile.picture,
        headline: profile.headline,
        linkedinTier: 'premium',
        lastLoginAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.linkedinId,
        set: {
          fullName: profile.name,
          email: profile.email,
          profilePic: profile.picture,
          lastLoginAt: new Date(),
        },
      })
      .returning();

    // Store encrypted tokens in session
    req.session.userId = user.id;
    req.session.encryptedAccessToken = encrypt(tokens.access_token);
    req.session.encryptedRefreshToken = tokens.refresh_token
      ? encrypt(tokens.refresh_token)
      : undefined;
    req.session.tokenExpiresAt = Date.now() + tokens.expires_in * 1000;
    req.session.linkedinId = profile.sub;
    req.session.gdprConsented = !!user.gdprConsentAt;
    delete req.session.oauthState;
    delete req.session.codeVerifier;

    await auditLog(req, 'write', 'users.login');

    // If GDPR consent not yet given, redirect to consent page
    if (!user.gdprConsentAt) {
      return res.redirect(`${frontendBase}/gdpr-consent`);
    }

    logger.info('User authenticated', { userId: user.id });
    return res.redirect(`${frontendBase}/search`);

  } catch (err) {
    logger.error('OAuth callback error', { error: (err as Error).message });
    return res.redirect(`${frontendBase}/?error=internal`);
  }
});

// ─── GDPR Consent ─────────────────────────────────────────────────────────────

router.post('/gdpr-consent', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } });
  }

  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket.remoteAddress
    || 'unknown';

  await db.update(users).set({
    gdprConsentAt: new Date(),
    gdprConsentVersion: '1.0',
    gdprConsentIp: ip,
    dataRetentionUntil: new Date(Date.now() + config.gdpr.dataRetentionDays * 24 * 60 * 60 * 1000),
  }).where(eq(users.id, userId));

  req.session.gdprConsented = true;
  await auditLog(req, 'write', 'users.gdpr_consent', { version: '1.0' });

  return res.json({ success: true });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

router.post('/logout', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (userId) {
    await auditLog(req, 'write', 'users.logout');
  }

  req.session.destroy((err) => {
    if (err) logger.error('Session destroy error', { error: err.message });
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ─── LinkedIn Session Management (v2) ─────────────────────────────────────────

const linkedinSessionSchema = z.object({
  liAt:       z.string().min(10).max(2000),
  jsessionid: z.string().min(4).max(500),
});

// GET /auth/linkedin-session — return status (masked, never returns raw cookie)
router.get('/linkedin-session', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const [session] = await db
      .select({ updatedAt: linkedinSessions.updatedAt, isActive: linkedinSessions.isActive })
      .from(linkedinSessions)
      .where(eq(linkedinSessions.userId, userId))
      .limit(1);

    if (!session) {
      return res.json({ configured: false });
    }
    return res.json({
      configured: true,
      isActive: session.isActive,
      updatedAt: session.updatedAt,
    });
  } catch (err) {
    logger.error('Error fetching linkedin session', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// POST /auth/linkedin-session — save/update encrypted cookies
router.post('/linkedin-session', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const parsed = linkedinSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: 'INVALID_PARAMS', message: parsed.error.message } });
  }

  const { liAt, jsessionid } = parsed.data;
  try {
    const encryptedLiAt = encrypt(liAt);
    const encryptedJsessionid = encrypt(jsessionid);

    // Upsert — one row per user
    await db
      .insert(linkedinSessions)
      .values({
        userId,
        liAt: encryptedLiAt,
        jsessionid: encryptedJsessionid,
        updatedAt: new Date(),
        isActive: true,
      })
      .onConflictDoUpdate({
        target: linkedinSessions.userId,
        set: {
          liAt: encryptedLiAt,
          jsessionid: encryptedJsessionid,
          updatedAt: new Date(),
          isActive: true,
        },
      });

    // Also inject into Playwright context immediately
    try {
      const { linkedInAdapter } = await import('../adapters/linkedin/PlaywrightAdapter');
      await linkedInAdapter.injectLinkedInSession(userId, liAt, jsessionid);
    } catch (injectErr) {
      logger.warn('Could not inject session into Playwright context', { error: String(injectErr) });
    }

    await auditLog(req, 'write', 'linkedin_sessions.update');
    logger.info('LinkedIn session saved', { userId });

    return res.json({ success: true, updatedAt: new Date() });
  } catch (err) {
    logger.error('Error saving linkedin session', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// DELETE /auth/linkedin-session — clear session
router.delete('/linkedin-session', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    await db.delete(linkedinSessions).where(eq(linkedinSessions.userId, userId));
    // Also clear Playwright context
    const { linkedInAdapter } = await import('../adapters/linkedin/PlaywrightAdapter');
    await linkedInAdapter.clearUserSession(userId);
    await auditLog(req, 'delete', 'linkedin_sessions.clear');
    return res.json({ success: true });
  } catch (err) {
    logger.error('Error clearing linkedin session', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// ─── Current User ─────────────────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } });
  }

  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    return res.json({
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      profilePic: user.profilePic,
      headline: user.headline,
      linkedinTier: user.linkedinTier,
      gdprConsented: !!user.gdprConsentAt,
      tokenExpiresAt: req.session.tokenExpiresAt,
    });
  } catch (err) {
    logger.error('Error fetching user', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

export default router;
