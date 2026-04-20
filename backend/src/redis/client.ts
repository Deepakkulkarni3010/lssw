import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

const redisClient = new Redis(config.redis.url, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times: number) => {
    if (times > 10) return null;
    return Math.min(times * 100, 3000);
  },
  reconnectOnError: (err: Error) => {
    const targetErrors = ['READONLY', 'ECONNRESET'];
    return targetErrors.some((e) => err.message.includes(e));
  },
});

redisClient.on('connect', () => logger.info('Redis connected'));
redisClient.on('error', (err) => logger.error('Redis error', { error: err.message }));
redisClient.on('reconnecting', () => logger.warn('Redis reconnecting...'));

export { redisClient };

export async function checkRedisHealth(): Promise<boolean> {
  try {
    await redisClient.ping();
    return true;
  } catch {
    return false;
  }
}

// ─── Redis Key Helpers ────────────────────────────────────────────────────────

export const keys = {
  oauthState:    (nonce: string)   => `oauth:state:${nonce}`,
  rateLimit:     (userId: string, epochHour: number) => `rate:${userId}:${epochHour}`,
  resultCache:   (hash: string)    => `cache:results:${hash}`,
  jobStatus:     (jobId: string)   => `job:${jobId}`,
  browserCtx:    (userId: string)  => `browser:ctx:${userId}`,
  captchaBan:    (userId: string)  => `captcha:ban:${userId}`,
  gdprConsent:   (userId: string)  => `gdpr:consent:${userId}`,
};

// ─── Rate Limiter (sliding window) ────────────────────────────────────────────

export async function incrementRateLimit(userId: string): Promise<number> {
  const epochHour = Math.floor(Date.now() / 1000 / 3600);
  const key = keys.rateLimit(userId, epochHour);
  const pipe = redisClient.pipeline();
  pipe.incr(key);
  pipe.expire(key, 7200); // 2h TTL to allow overlap
  const results = await pipe.exec();
  const count = (results?.[0]?.[1] as number) ?? 0;
  return count;
}

export async function getRateLimitCount(userId: string): Promise<number> {
  const epochHour = Math.floor(Date.now() / 1000 / 3600);
  const key = keys.rateLimit(userId, epochHour);
  const val = await redisClient.get(key);
  return val ? parseInt(val, 10) : 0;
}
