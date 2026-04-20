import express from 'express';
import session from 'express-session';
import RedisStore from 'connect-redis';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import cookieParser from 'cookie-parser';
import cron from 'node-cron';

import { config } from './config';
import { logger } from './utils/logger';
import { redisClient } from './redis/client';
import { db } from './db';
import { searchHistory } from './db/schema';
import { linkedInAdapter } from './adapters/linkedin/PlaywrightAdapter';
import { gdprHeaders } from './middleware/gdpr.middleware';

// Routes
import authRoutes from './routes/auth.routes';
import searchRoutes from './routes/search.routes';
import savedSearchesRoutes from './routes/savedSearches.routes';
import historyRoutes from './routes/history.routes';
import gdprRoutes from './routes/gdpr.routes';
import healthRoutes from './routes/health.routes';

import { lt } from 'drizzle-orm';

const app = express();

// ─── Trust Proxy (Hostinger/Nginx) ───────────────────────────────────────────
app.set('trust proxy', 1);

// ─── Security Middleware ──────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'https://media.licdn.com'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 63072000, includeSubDomains: true, preload: true },
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(cors({
  origin: config.allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Requested-With'],
}));

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(cookieParser());

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(morgan(config.isProduction ? 'combined' : 'dev', {
  stream: { write: (msg) => logger.info(msg.trim()) },
  skip: (req) => req.path === '/health',
}));

// ─── GDPR Headers ────────────────────────────────────────────────────────────
app.use(gdprHeaders);

// ─── Session ──────────────────────────────────────────────────────────────────
app.use(session({
  store: new RedisStore({
    client: redisClient,
    prefix: 'sess:',
    ttl: config.session.ttlSeconds,
  }),
  secret: config.session.secret,
  name: 'lssw.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    maxAge: config.session.ttlSeconds * 1000,
  },
}));

// ─── CSRF Guard: reject non-XHR state-changing requests ──────────────────────
app.use((req, res, next) => {
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const xrw = req.headers['x-requested-with'];
    // Allow OAuth callback (GET) and health (GET)
    if (!xrw && !req.path.startsWith('/auth/linkedin')) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'CSRF check failed' } });
      return;
    }
  }
  next();
});

// ─── Routes ───────────────────────────────────────────────────────────────────
app.use('/health',             healthRoutes);
app.use('/auth',               authRoutes);
app.use('/api/search',         searchRoutes);
app.use('/api/saved-searches', savedSearchesRoutes);
app.use('/api/history',        historyRoutes);
app.use('/api/gdpr',           gdprRoutes);

// ─── 404 Handler ──────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
});

// ─── Error Handler ────────────────────────────────────────────────────────────
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
});

// ─── GDPR: Scheduled Data Purge (runs daily at 2am UTC) ──────────────────────
cron.schedule('0 2 * * *', async () => {
  logger.info('Running GDPR data purge job');
  try {
    const deleted = await db
      .delete(searchHistory)
      .where(lt(searchHistory.purgeDueAt, new Date()))
      .returning();
    logger.info('GDPR purge completed', { deletedCount: deleted.length });
  } catch (err) {
    logger.error('GDPR purge failed', { error: (err as Error).message });
  }
}, { timezone: 'UTC' });

// ─── Startup ──────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  try {
    await linkedInAdapter.initialize();
    logger.info('LinkedIn adapter initialized');

    app.listen(config.port, () => {
      logger.info(`🚀 LSSW backend running`, {
        port: config.port,
        env: config.env,
        region: 'EU',
        domain: 'deepakkulkarni.space',
      });
    });
  } catch (err) {
    logger.error('Startup failed', { error: (err as Error).message });
    process.exit(1);
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  await linkedInAdapter.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down gracefully');
  await linkedInAdapter.shutdown();
  process.exit(0);
});

start();
