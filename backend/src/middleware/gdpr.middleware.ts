import { Request, Response, NextFunction } from 'express';
import { db } from '../db';
import { gdprAuditLog } from '../db/schema';
import { logger } from '../utils/logger';

// GDPR response headers (EU data residency)
export function gdprHeaders(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Data-Region', 'EU');
  res.setHeader('X-Data-Controller', 'deepakkulkarni.space');
  res.setHeader('X-Privacy-Policy', 'https://deepakkulkarni.space/privacy');
  next();
}

// Audit log for GDPR-sensitive operations
export async function auditLog(
  req: Request,
  action: 'read' | 'write' | 'delete' | 'export',
  resource: string,
  details?: object,
): Promise<void> {
  const userId = req.session?.userId;
  if (!userId) return;

  try {
    await db.insert(gdprAuditLog).values({
      userId,
      action,
      resource,
      ipAddress: (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
        || req.socket.remoteAddress
        || 'unknown',
      userAgent: req.headers['user-agent'] || 'unknown',
      details: details || {},
    });
  } catch (err) {
    logger.error('Failed to write GDPR audit log', { error: (err as Error).message });
  }
}

// Data minimization: strip any fields not explicitly needed
export function minimizeUserData(data: Record<string, unknown>): Record<string, unknown> {
  const allowedFields = [
    'id', 'linkedinId', 'email', 'fullName', 'headline',
    'linkedinTier', 'createdAt', 'lastLoginAt', 'gdprConsentAt',
  ];
  return Object.fromEntries(
    Object.entries(data).filter(([k]) => allowedFields.includes(k)),
  );
}
