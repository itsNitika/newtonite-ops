import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import { authMiddleware } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { createWorkItemsRouter } from './routes/workItems.js';
import { createTeamsRouter } from './routes/teams.js';
import { createUsersRouter } from './routes/users.js';
import { createEventsRouter } from './routes/events.js';
import { createOutboxRouter } from './routes/outbox.js';
import { OutboxWorker } from './domain/outboxWorker.js';

export function createApp(db: Database.Database, worker?: OutboxWorker): Express {
  const app = express();

  // CORS configuration supporting deployed frontend origin and local dev
  const corsOrigin = process.env.CORS_ORIGIN
    ? (process.env.CORS_ORIGIN.includes(',')
        ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
        : process.env.CORS_ORIGIN.trim())
    : true; // Reflect request origin if not explicitly restricted

  app.use(cors({
    origin: corsOrigin,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'x-user-id'],
    exposedHeaders: ['X-Idempotent-Replay', 'X-Cache-Lookup']
  }));
  app.use(express.json());

  // Attach database to request
  app.use((req: Request, res: Response, next: NextFunction) => {
    req.db = db;
    next();
  });

  // Identity & Authorization Middleware
  app.use(authMiddleware);

  // Idempotency Middleware for mutating requests
  app.use(idempotencyMiddleware);

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Mount API routers
  app.use('/api/work-items', createWorkItemsRouter());
  app.use('/api/teams', createTeamsRouter());
  app.use('/api/users', createUsersRouter());
  app.use('/api/events', createEventsRouter());
  app.use('/api/outbox', createOutboxRouter(worker));

  // Global Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('Unhandled Application Error:', err);
    res.status(err.status || 500).json({
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected server error occurred'
    });
  });

  return app;
}
