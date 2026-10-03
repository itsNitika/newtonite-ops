import { Router, Request, Response } from 'express';
import { OutboxJob } from '../types.js';

export function createOutboxRouter(outboxWorker?: any): Router {
  const router = Router();

  // GET /api/outbox/jobs - List background queue jobs and stats
  router.get('/jobs', (req: Request, res: Response) => {
    const status = req.query.status as string | undefined;
    const limit = parseInt(req.query.limit as string || '50', 10);

    let query = 'SELECT * FROM outbox_jobs';
    const params: any[] = [];
    if (status) {
      query += ' WHERE status = ?';
      params.push(status);
    }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const jobs = req.db.prepare(query).all(...params) as OutboxJob[];

    const statsSql = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'PROCESSING' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'DEAD_LETTER' THEN 1 ELSE 0 END) as dead_letter
      FROM outbox_jobs
    `;
    const stats = req.db.prepare(statsSql).get();

    res.json({ jobs, stats });
  });

  // POST /api/outbox/jobs/:id/retry - Manually retry a failed or dead-letter job
  router.post('/jobs/:id/retry', (req: Request, res: Response) => {
    const now = new Date().toISOString();
    const update = req.db.prepare(`
      UPDATE outbox_jobs
      SET status = 'PENDING', attempts = 0, last_error = NULL, next_retry_at = ?, updated_at = ?
      WHERE id = ?
    `);
    const result = update.run(now, now, req.params.id);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (outboxWorker) {
      outboxWorker.processNextBatch();
    }

    res.json({ ok: true, message: 'Job reset to PENDING for immediate processing' });
  });

  // POST /api/outbox/trigger-sla-check - Force SLA evaluation across work items
  router.post('/trigger-sla-check', (req: Request, res: Response) => {
    if (outboxWorker) {
      const breachedCount = outboxWorker.evaluateSlaBreaches();
      res.json({ ok: true, breached_detected: breachedCount });
    } else {
      res.json({ ok: true, message: 'Worker not active' });
    }
  });

  return router;
}
