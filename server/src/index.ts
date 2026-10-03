import { getDb } from './db/connection.js';
import { initializeSchema } from './db/schema.js';
import { seedDatabase } from './db/seed.js';
import { OutboxWorker } from './domain/outboxWorker.js';
import { createApp } from './app.js';

const PORT = parseInt(process.env.PORT || '3001', 10);
const HOST = '0.0.0.0';

async function bootstrap() {
  const db = getDb();
  
  // Ensure tables and indexes are initialized
  initializeSchema(db);

  // If database is brand new (0 users), run initial seed
  const countRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (countRow.count === 0) {
    console.log('🌱 Empty database detected. Populating seed dataset...');
    seedDatabase(db);
  }

  // Start background outbox and SLA evaluation worker
  const outboxWorker = new OutboxWorker(db);
  outboxWorker.start(3000); // Check outbox and SLA alerts every 3 seconds

  const app = createApp(db, outboxWorker);

  const server = app.listen(PORT, HOST, () => {
    console.log(`=================================================`);
    console.log(`🚀 Newtonite Operations Platform Backend`);
    console.log(`📡 Server running on http://${HOST}:${PORT}`);
    console.log(`⚡ Outbox Background Worker: ACTIVE`);
    console.log(`🔔 Realtime SSE Bus: ACTIVE`);
    console.log(`=================================================`);
  });

  const shutdown = () => {
    console.log('Shutting down gracefully...');
    outboxWorker.stop();
    server.close(() => {
      console.log('Server stopped.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

bootstrap().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
