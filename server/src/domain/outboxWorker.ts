import Database from 'better-sqlite3';
import { OutboxJob } from '../types.js';
import { RealtimeEventBus } from '../events/eventBus.js';

export class OutboxWorker {
  private db: Database.Database;
  private intervalHandle: NodeJS.Timeout | null = null;
  private isProcessing: boolean = false;
  private isRunning: boolean = false;

  constructor(db: Database.Database) {
    this.db = db;
  }

  start(intervalMs: number = 2000): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.intervalHandle = setInterval(() => {
      this.processNextBatch();
      this.evaluateSlaBreaches();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
    this.isRunning = false;
  }

  /**
   * Process a batch of pending or retryable outbox jobs
   */
  async processNextBatch(batchSize: number = 10): Promise<number> {
    if (this.isProcessing) return 0;
    this.isProcessing = true;

    try {
      const now = new Date().toISOString();
      const stmt = this.db.prepare(`
        SELECT * FROM outbox_jobs
        WHERE status = 'PENDING'
           OR (status = 'FAILED' AND next_retry_at <= ? AND attempts < max_attempts)
        ORDER BY created_at ASC
        LIMIT ?
      `);

      const jobs = stmt.all(now, batchSize) as OutboxJob[];
      if (jobs.length === 0) {
        this.isProcessing = false;
        return 0;
      }

      for (const job of jobs) {
        await this.executeJob(job);
      }

      return jobs.length;
    } catch (err) {
      console.error('OutboxWorker error during batch processing:', err);
      return 0;
    } finally {
      this.isProcessing = false;
    }
  }

  private async executeJob(job: OutboxJob): Promise<void> {
    const markProcessing = this.db.prepare(`
      UPDATE outbox_jobs 
      SET status = 'PROCESSING', updated_at = ? 
      WHERE id = ? AND status IN ('PENDING', 'FAILED')
    `);
    markProcessing.run(new Date().toISOString(), job.id);

    try {
      const payload = JSON.parse(job.payload);

      // Execute based on job event type
      switch (job.event_type) {
        case 'NOTIFICATION_DISPATCH':
          // Simulate notification dispatch (Email/Slack/Push)
          await this.simulateNotificationDispatch(payload);
          break;

        case 'SLA_EVALUATION':
          // Re-evaluate SLA thresholds
          await this.simulateSlaEvaluation(payload);
          break;

        case 'AUDIT_ENRICHMENT':
          // Secondary analytics / enrichment
          break;

        case 'WEBHOOK_BROADCAST':
          // Broadcast to external integration endpoints
          break;

        default:
          throw new Error(`Unknown outbox job event type: ${job.event_type}`);
      }

      // Mark COMPLETED
      const markCompleted = this.db.prepare(`
        UPDATE outbox_jobs 
        SET status = 'COMPLETED', updated_at = ? 
        WHERE id = ?
      `);
      markCompleted.run(new Date().toISOString(), job.id);
    } catch (error: any) {
      const newAttempts = job.attempts + 1;
      const willDeadLetter = newAttempts >= job.max_attempts;
      const status = willDeadLetter ? 'DEAD_LETTER' : 'FAILED';
      
      // Exponential backoff: 2^attempts * 1000ms
      const backoffMs = Math.pow(2, newAttempts) * 1000;
      const nextRetry = new Date(Date.now() + backoffMs).toISOString();

      const markFailed = this.db.prepare(`
        UPDATE outbox_jobs 
        SET status = ?, 
            attempts = ?, 
            last_error = ?, 
            next_retry_at = ?, 
            updated_at = ? 
        WHERE id = ?
      `);
      markFailed.run(
        status, 
        newAttempts, 
        error?.message || 'Unknown processing error', 
        nextRetry, 
        new Date().toISOString(), 
        job.id
      );

      if (willDeadLetter) {
        console.warn(`[OutboxWorker] Job ${job.id} exhausted max retries. Moved to DEAD_LETTER queue.`);
      }
    }
  }

  private async simulateNotificationDispatch(payload: any): Promise<void> {
    // Intentional failure test hook for unit tests:
    if (payload?.simulateFailure) {
      throw new Error('Simulated upstream delivery timeout (HTTP 504)');
    }

    // In production, this talks to Sendgrid / Slack / Twilio
    // For our app, we broadcast notification via SSE
    RealtimeEventBus.broadcast('NOTIFICATION_SENT', {
      recipientId: payload.recipientId,
      message: payload.message,
      workItemId: payload.workItemId
    });
  }

  private async simulateSlaEvaluation(payload: any): Promise<void> {
    // Process SLA calculations
  }

  /**
   * Periodic evaluation to detect SLA breaches across unresolved work items
   */
  evaluateSlaBreaches(): number {
    const now = new Date().toISOString();
    const findBreachingItems = this.db.prepare(`
      SELECT id, tracking_num, title, assigned_team_id, assigned_user_id, sla_due_at
      FROM work_items
      WHERE sla_due_at < ?
        AND sla_breached = 0
        AND status NOT IN ('RESOLVED', 'CANCELLED')
    `);

    const breachedItems = findBreachingItems.all(now) as any[];
    if (breachedItems.length === 0) return 0;

    const updateStmt = this.db.prepare(`
      UPDATE work_items 
      SET sla_breached = 1, updated_at = ? 
      WHERE id = ?
    `);

    const insertAuditStmt = this.db.prepare(`
      INSERT INTO audit_events (id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at)
      VALUES (?, ?, ?, 'SLA_BREACHED', ?, ?, ?, ?)
    `);

    for (const item of breachedItems) {
      updateStmt.run(now, item.id);
      
      const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
      insertAuditStmt.run(
        auditId,
        item.id,
        null,
        JSON.stringify({ sla_breached: false }),
        JSON.stringify({ sla_breached: true }),
        `Target SLA of ${new Date(item.sla_due_at).toLocaleTimeString()} was breached while in progress.`,
        now
      );

      RealtimeEventBus.broadcast('SLA_BREACHED', {
        workItemId: item.id,
        trackingNum: item.tracking_num,
        title: item.title
      });
    }

    return breachedItems.length;
  }
}
