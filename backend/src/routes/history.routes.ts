import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth.middleware';
import { auditLog } from '../middleware/gdpr.middleware';
import { db } from '../db';
import { searchHistory } from '../db/schema';
import { eq, and, desc } from 'drizzle-orm';
import { logger } from '../utils/logger';

const router = Router();

// GET /api/history
router.get('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    const entries = await db
      .select()
      .from(searchHistory)
      .where(eq(searchHistory.userId, userId))
      .orderBy(desc(searchHistory.executedAt))
      .limit(50);

    await auditLog(req, 'read', 'search_history.list');
    return res.json({ data: entries, total: entries.length });
  } catch (err) {
    logger.error('Error fetching history', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// DELETE /api/history/:id
router.delete('/:id', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  const { id } = req.params;
  try {
    const deleted = await db
      .delete(searchHistory)
      .where(and(eq(searchHistory.id, id), eq(searchHistory.userId, userId)))
      .returning();

    if (!deleted.length) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'History entry not found' } });
    }

    await auditLog(req, 'delete', 'search_history.delete', { id });
    return res.json({ success: true });
  } catch (err) {
    logger.error('Error deleting history entry', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

// DELETE /api/history — clear all history for user
router.delete('/', requireAuth, async (req: Request, res: Response) => {
  const userId = req.session.userId!;
  try {
    await db.delete(searchHistory).where(eq(searchHistory.userId, userId));
    await auditLog(req, 'delete', 'search_history.clear_all');
    return res.json({ success: true });
  } catch (err) {
    logger.error('Error clearing history', { error: (err as Error).message });
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Server error' } });
  }
});

export default router;
