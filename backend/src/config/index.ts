import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: parseInt(process.env.PORT || '3000', 10),

  // Database
  database: {
    url: requireEnv('DATABASE_URL'),
    ssl: process.env.NODE_ENV === 'production',
  },

  // Redis
  redis: {
    url: requireEnv('REDIS_URL'),
  },

  // Session
  session: {
    secret: requireEnv('SESSION_SECRET'),
    encryptionKey: requireEnv('SESSION_ENCRYPTION_KEY'),
    ttlSeconds: 7 * 24 * 60 * 60, // 7 days
  },

  // LinkedIn OAuth
  linkedin: {
    clientId: requireEnv('LINKEDIN_CLIENT_ID'),
    clientSecret: requireEnv('LINKEDIN_CLIENT_SECRET'),
    callbackUrl: requireEnv('LINKEDIN_CALLBACK_URL'),
    scopes: ['openid', 'profile', 'email'],
  },

  // CORS
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'https://deepakkulkarni.space').split(','),

  // Rate Limiting
  rateLimit: {
    searchesPerHour: parseInt(process.env.RATE_LIMIT_SEARCHES_PER_HOUR || '30', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_WINDOW_SECONDS || '3600', 10),
  },

  // Playwright
  playwright: {
    maxPages: parseInt(process.env.PLAYWRIGHT_MAX_PAGES || '5', 10),
    browserTimeoutMs: parseInt(process.env.PLAYWRIGHT_BROWSER_TIMEOUT_MS || '15000', 10),
    navDelayMinMs: parseInt(process.env.PLAYWRIGHT_NAV_DELAY_MIN_MS || '500', 10),
    navDelayMaxMs: parseInt(process.env.PLAYWRIGHT_NAV_DELAY_MAX_MS || '1500', 10),
  },

  // Cache
  cache: {
    resultTtlSeconds: parseInt(process.env.RESULT_CACHE_TTL_SECONDS || '600', 10),
  },

  // GDPR
  gdpr: {
    dataResidencyRegion: 'EU',
    dataRetentionDays: 90,
    auditLogRetentionDays: 365,
  },
};

export type Config = typeof config;
