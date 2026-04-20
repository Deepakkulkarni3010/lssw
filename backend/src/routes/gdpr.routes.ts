import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/gdpr.middleware';
import { db } from '../db';
import { users, savedSearches, searchHistory, gdprAuditLog } from '../db/schema';
import { eq } from 'drizzle-orm';
import { linkedInAdapter } from '../adapters/linkedin/PlaywrightAdapter';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/gdpr/export — Right to Data Portability (Art. 20 GDPR)
router.get('/export', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    const searches = await db.select().from(savedSearches).where(eq(savedSearches.userId, userId));
    const history = await db.select().from(searchHistory).where(eq(searchHistory.userId, userId)).limit(50);

    await auditLog(req, 'export', 'gdpr.data_export');

    const exportData = {
      exportedAt: new Date().toISOString(),
      region: 'EU',
      dataController: 'deepakkulkarni.space',
      subject: 'LinkedIn Smart Search Wrapper',
      user: {
        id: user?.id,
        email: user?.email,
        fullName: user?.fullName,
        createdAt: user?.createdAt,
        lastLoginAt: user?.lastLoginAt,
        gdprConsentAt: user?.gdprConsentAt,
        gdprConsentVersion: user?.gdprConsentVersion,
      },
      savedSearches: searches.map((s) => ({
        id: s.id, name: s.name, createdAt: s.createdAt, searchParams: s.searchParams,
      })),
      searchHistory: history.map((h) => ({
        id: h.id, executedAt: h.executedAt, status: h.status, searchParams: h.searchParams,
      })),
      note: 'No candidate profile data is stored. Results are cached transiently (max 10 minutes) and automatically deleted.',
    };

    res.setHeader('Content-Disposition', 'attachment; filename="lssw-data-export.json"');
    res.setHeader('Content-Type', 'application/json');
    return res.json(exportData);
  } catch (err) {
    logger.error('GDPR export error', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Export failed' } });
  }
});

// DELETE /api/gdpr/me — Right to Erasure (Art. 17 GDPR)
router.delete('/me', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    // Log before deletion (GDPR audit log survives user deletion)
    await auditLog(req, 'delete', 'gdpr.right_to_erasure');

    // Clear browser session
    await linkedInAdapter.clearUserSession(userId);

    // Delete all user data (cascades to saved_searches and search_history)
    await db.delete(users).where(eq(users.id, userId));

    // Destroy session
    req.session.destroy(() => {});
    res.clearCookie('connect.sid');

    logger.info('User data deleted (GDPR erasure)', { userId });
    return res.json({
      success: true,
      message: 'All personal data has been deleted.',
      retainedData: 'GDPR audit logs are retained for 365 days as required by applicable law.',
    });
  } catch (err) {
    logger.error('GDPR erasure error', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Deletion failed' } });
  }
});

// GET /api/gdpr/audit — Right of Access to audit log (Art. 15 GDPR)
router.get('/audit', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const logs = await db
      .select()
      .from(gdprAuditLog)
      .where(eq(gdprAuditLog.userId, userId))
      .limit(100);

    return res.json({ data: logs, total: logs.length });
  } catch (err) {
    logger.error('GDPR audit log error', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

export default router;
