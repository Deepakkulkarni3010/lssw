import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { db } from '../db';
import { users } from '../db/schema';
import { redisClient, keys } from '../redis/client';
import { encrypt, decrypt, generateRandomState, generateCodeVerifier, generateCodeChallenge } from '../utils/crypto';
import { logger } from '../utils/logger';
import { auditLog } from '../middleware/gdpr.middleware';
import { eq } from 'drizzle-orm';
import { linkedInAdapter } from '../adapters/linkedin/PlaywrightAdapter';

const router = Router();

// ─── LinkedIn OAuth 2.0 PKCE Initiation ──────────────────────────────────────

router.get('/linkedin', async (req: Request, res: Response) => {
  const state = generateRandomState();

  // Store state in Redis (5 min TTL) for CSRF protection
  await redisClient.setex(keys.oauthState(state), 300, 'valid');
  req.session.oauthState = state;

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.linkedin.clientId,
    redirect_uri: config.linkedin.callbackUrl,
    state,
    scope: config.linkedin.scopes.join(' '),
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
    const storedState = await redisClient.get(keys.oauthState(state));
    if (!storedState || state !== req.session.oauthState) {
      logger.warn('OAuth state mismatch — possible CSRF', { state });
      return res.redirect(`${frontendBase}/?error=state_mismatch`);
    }
    await redisClient.del(keys.oauthState(state));

    // Exchange code for tokens (standard auth code flow — no PKCE for server-side apps)
    const tokenResponse = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        client_id: config.linkedin.clientId,
        client_secret: config.linkedin.clientSecret,
        redirect_uri: config.linkedin.callbackUrl,
      }),
    });

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text();
      logger.error('Token exchange failed', { status: tokenResponse.status, body: errBody });
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


// ─── LinkedIn Browser Session (inject li_at + JSESSIONID) ────────────────────

router.post('/linkedin-session', async (req: Request, res: Response) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Not logged in' } });
  }
  const { liAt, jsessionid } = req.body;
  if (!liAt || !jsessionid) {
    return res.status(400).json({ error: { code: 'MISSING_COOKIES', message: 'li_at and jsessionid are required' } });
  }
  try {
    await linkedInAdapter.injectLinkedInSession(userId, liAt, jsessionid);
    logger.info('LinkedIn session injected', { userId });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Failed to inject LinkedIn session', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Failed to store session' } });
  }
});

export default router;
