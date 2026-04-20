import { Router, Request, Response } from 'express';
import { checkDatabaseHealth } from '../db';
import { checkRedisHealth } from '../redis/client';
import { linkedInAdapter } from '../adapters/linkedin/PlaywrightAdapter';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  const [dbOk, redisOk] = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
  ]);

  const status = dbOk && redisOk ? 'ok' : 'degraded';
  const httpStatus = status === 'ok' ? 200 : 503;

  return res.status(httpStatus).json({
    status,
    version: process.env.npm_package_version || '1.0.0',
    region: 'EU',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    checks: {
      database: dbOk ? 'ok' : 'error',
      redis: redisOk ? 'ok' : 'error',
    },
  });
});

export default router;
