import { Router, Request, Response } from 'express';
import { RealtimeEventBus } from '../events/eventBus.js';

export function createEventsRouter(): Router {
  const router = Router();

  // GET /api/events/subscribe - Server-Sent Events (SSE) endpoint
  router.get('/subscribe', (req: Request, res: Response) => {
    // Set proper headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable proxy buffering
    res.flushHeaders?.();

    const clientId = 'client-' + Math.random().toString(36).substring(2, 9);
    const userId = req.user?.id || 'anonymous';
    const activeWorkItemId = req.query.work_item_id as string | undefined;

    RealtimeEventBus.registerClient({
      id: clientId,
      userId,
      res,
      activeWorkItemId
    });

    // Cleanup on client disconnect
    req.on('close', () => {
      RealtimeEventBus.removeClient(clientId);
    });
  });

  return router;
}
