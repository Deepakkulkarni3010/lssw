import { Request, Response, NextFunction } from 'express';
import { incrementRateLimit, getRateLimitCount } from '../redis/client';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function searchRateLimiter(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) {
    next();
    return;
  }

  try {
    const count = await incrementRateLimit(userId);
    const limit = config.rateLimit.searchesPerHour;

    // Set rate limit headers (RFC 6585)
    res.setHeader('X-RateLimit-Limit', limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limit - count));

    if (count > limit) {
      const epochHour = Math.floor(Date.now() / 1000 / 3600);
      const resetAt = (epochHour + 1) * 3600;
      const retryAfter = resetAt - Math.floor(Date.now() / 1000);

      logger.warn('Rate limit exceeded', { userId, count, limit });

      res.setHeader('Retry-After', retryAfter);
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `You have reached the ${limit} searches per hour limit.`,
          retryAfter,
        },
      });
      return;
    }

    next();
  } catch (err) {
    // Redis failure — fail open (allow request, log error)
    logger.error('Rate limiter Redis error', { error: (err as Error).message });
    next();
  }
}
