import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createDbConnection } from '../src/db/connection.js';
import { initializeSchema } from '../src/db/schema.js';
import { seedDatabase } from '../src/db/seed.js';
import { OutboxWorker } from '../src/domain/outboxWorker.js';
import { WorkItemService } from '../src/services/workItemService.js';
import Database from 'better-sqlite3';

describe('Newtonite Operational Platform - Critical Behaviors & Edge Cases', () => {
  let db: Database.Database;
  let worker: OutboxWorker;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    // In-memory isolated DB for lightning-fast test execution
    db = createDbConnection(':memory:');
    seedDatabase(db);
    worker = new OutboxWorker(db);
    app = createApp(db, worker);
  });

  afterEach(() => {
    worker.stop();
    db.close();
  });

  describe('1. Optimistic Concurrency Control (OCC) & Race Conditions', () => {
    it('prevents two users from taking the same work item blindly (409 Conflict on stale version)', async () => {
      // wi-1004 is currently unassigned at version 1
      const initialRes = await request(app)
        .get('/api/work-items/wi-1004')
        .set('x-user-id', 'usr-elena-eng');
      
      expect(initialRes.status).toBe(200);
      const initialItem = initialRes.body.item;
      expect(initialItem.version).toBe(1);
      expect(initialItem.assigned_user_id).toBeNull();

      // User A (Elena) claims item with expected_version: 1
      const claimA = await request(app)
        .post('/api/work-items/wi-1004/claim')
        .set('x-user-id', 'usr-elena-eng')
        .send({ expected_version: 1 });

      expect(claimA.status).toBe(200);
      expect(claimA.body.assigned_user_id).toBe('usr-elena-eng');
      expect(claimA.body.version).toBe(2);

      // User B (Alex) was viewing version 1 simultaneously and tries to claim or update it
      const claimB = await request(app)
        .post('/api/work-items/wi-1004/claim')
        .set('x-user-id', 'usr-alex-lead')
        .send({ expected_version: 1 }); // Stale version!

      // System rejects User B's stale write with 409 Conflict
      expect(claimB.status).toBe(409);
      expect(claimB.body.error).toBe('Conflict detected');
      expect(claimB.body.current_version).toBe(2);
      expect(claimB.body.current_item.assigned_user_id).toBe('usr-elena-eng');
    });

    it('rejects stale status transition if another user modified details in the interim', async () => {
      // wi-1003 is currently IN_PROGRESS at version 1
      // User A updates details (bumps version to 2)
      const updateRes = await request(app)
        .patch('/api/work-items/wi-1003')
        .set('x-user-id', 'usr-clara-risk')
        .send({
          expected_version: 1,
          title: 'GDPR Article 17 Data Erasure Request (URGENT UPDATE)'
        });
      expect(updateRes.status).toBe(200);
      expect(updateRes.body.version).toBe(2);

      // User B tries to transition status based on old version 1
      const transitionRes = await request(app)
        .post('/api/work-items/wi-1003/transition')
        .set('x-user-id', 'usr-clara-risk')
        .send({
          expected_version: 1,
          target_status: 'READY'
        });

      expect(transitionRes.status).toBe(409);
      expect(transitionRes.body.current_version).toBe(2);
    });
  });

  describe('2. Idempotency & Safe Deduplication of Duplicate Operations', () => {
    it('returns identical cached response and prevents duplicate executions when Idempotency-Key is reused', async () => {
      const idempotencyKey = 'client-req-' + Math.random().toString(36).substring(2, 9);
      
      const payload = {
        title: 'Network Switch Port Flapping in DC-2',
        description: 'Interface eth0/1 flapping every 20 seconds. Packet drops observed on host bridge.',
        category: 'ENGINEERING',
        priority: 'P1_HIGH',
        assigned_team_id: 'team-eng'
      };

      // Initial request
      const res1 = await request(app)
        .post('/api/work-items')
        .set('x-user-id', 'usr-alex-lead')
        .set('idempotency-key', idempotencyKey)
        .send(payload);

      expect(res1.status).toBe(201);
      const createdItem = res1.body;
      expect(createdItem.tracking_num).toBeDefined();

      // Count work items in DB with this title
      const count1 = db.prepare('SELECT COUNT(*) as count FROM work_items WHERE title = ?').get(payload.title) as any;
      expect(count1.count).toBe(1);

      // Repeated request (e.g. user double-clicked or network re-sent request)
      const res2 = await request(app)
        .post('/api/work-items')
        .set('x-user-id', 'usr-alex-lead')
        .set('idempotency-key', idempotencyKey)
        .send(payload);

      // Should return identical cached 201 response with X-Idempotent-Replay header
      expect(res2.status).toBe(201);
      expect(res2.headers['x-idempotent-replay']).toBe('true');
      expect(res2.body.id).toBe(createdItem.id);
      expect(res2.body.tracking_num).toBe(createdItem.tracking_num);

      // Work item count should still be 1 (NOT duplicated!)
      const count2 = db.prepare('SELECT COUNT(*) as count FROM work_items WHERE title = ?').get(payload.title) as any;
      expect(count2.count).toBe(1);
    });

    it('rejects Idempotency-Key reuse with altered payload with 422 Unprocessable Entity', async () => {
      const idempotencyKey = 'idem-' + Math.random().toString(36).substring(2, 9);

      // First call
      await request(app)
        .post('/api/work-items')
        .set('x-user-id', 'usr-alex-lead')
        .set('idempotency-key', idempotencyKey)
        .send({
          title: 'Initial Request Payload',
          description: 'Valid payload description',
          category: 'ENGINEERING',
          priority: 'P2_MEDIUM',
          assigned_team_id: 'team-eng'
        });

      // Second call reusing same key with DIFFERENT payload
      const conflictRes = await request(app)
        .post('/api/work-items')
        .set('x-user-id', 'usr-alex-lead')
        .set('idempotency-key', idempotencyKey)
        .send({
          title: 'TAMPERED / DIFFERENT Payload',
          description: 'Valid payload description',
          category: 'ENGINEERING',
          priority: 'P2_MEDIUM',
          assigned_team_id: 'team-eng'
        });

      expect(conflictRes.status).toBe(422);
      expect(conflictRes.body.error).toContain('Idempotency conflict');
    });
  });

  describe('3. State Machine & Approval Gates with Segregation of Duties', () => {
    it('blocks direct resolution of work items requiring approval without formal approval', async () => {
      // wi-1002 has requires_approval = 1, currently in PENDING_APPROVAL
      const res = await request(app)
        .post('/api/work-items/wi-1002/transition')
        .set('x-user-id', 'usr-sophia-pay-lead')
        .send({
          expected_version: 2,
          target_status: 'RESOLVED',
          resolution_summary: 'Attempting to resolve directly without explicit signoff'
        });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain('An authorized approver must approve it before resolution');
    });

    it('enforces segregation of duties: creator/owner cannot approve their own high-stakes work item', async () => {
      // wi-1002 was created and owned by Marcus (usr-marcus-pay).
      // Marcus attempts to approve his own wire clearance
      const marcusApprove = await request(app)
        .post('/api/work-items/wi-1002/approve')
        .set('x-user-id', 'usr-marcus-pay')
        .send({
          decision: 'APPROVED',
          note: 'Self-approval attempt',
          expected_version: 2
        });

      expect(marcusApprove.status).toBe(403);
      expect(marcusApprove.body.message).toContain('Segregation of duties violation');
    });

    it('allows designated Team Lead or Approver to formally approve, permitting subsequent resolution', async () => {
      // Sophia (usr-sophia-pay-lead) is the Team Lead for Payments Operations (not the creator/assignee)
      const approveRes = await request(app)
        .post('/api/work-items/wi-1002/approve')
        .set('x-user-id', 'usr-sophia-pay-lead')
        .send({
          decision: 'APPROVED',
          note: 'Beneficiary wire details and AML checks independently audited and approved.',
          expected_version: 2
        });

      expect(approveRes.status).toBe(200);
      expect(approveRes.body.approval_status).toBe('APPROVED');
      expect(approveRes.body.version).toBe(3);

      // Now the item can be cleanly resolved with resolution notes
      const resolveRes = await request(app)
        .post('/api/work-items/wi-1002/transition')
        .set('x-user-id', 'usr-marcus-pay')
        .send({
          expected_version: 3,
          target_status: 'RESOLVED',
          resolution_summary: 'Wire transfer executed successfully via Fedwire terminal.'
        });

      expect(resolveRes.status).toBe(200);
      expect(resolveRes.body.status).toBe('RESOLVED');
    });

    it('enforces that resolution requires a meaningful resolution summary', async () => {
      // wi-1001 is an active incident in progress
      const emptySummaryRes = await request(app)
        .post('/api/work-items/wi-1001/transition')
        .set('x-user-id', 'usr-alex-lead')
        .send({
          expected_version: 3,
          target_status: 'RESOLVED',
          resolution_summary: '' // Blank!
        });

      expect(emptySummaryRes.status).toBe(400);
      expect(emptySummaryRes.body.message).toContain('Resolution requires a detailed resolution summary');
    });
  });

  describe('4. Transactional Outbox Pattern & Background Resilience', () => {
    it('handles background worker retry with exponential backoff on transient failure', async () => {
      // Manually insert an outbox job configured to simulate upstream failure
      const now = new Date().toISOString();
      const jobId = 'out-fail-test-1';
      db.prepare(`
        INSERT INTO outbox_jobs (
          id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at
        ) VALUES (?, 'NOTIFICATION_DISPATCH', ?, 'PENDING', 0, 3, ?, ?, ?)
      `).run(
        jobId,
        JSON.stringify({ simulateFailure: true, message: 'Transient timeout' }),
        now, now, now
      );

      // Process batch
      const processed = await worker.processNextBatch();
      expect(processed).toBe(1);

      // Verify job was NOT lost, but updated to FAILED with attempt=1 and backoff set
      const job = db.prepare('SELECT * FROM outbox_jobs WHERE id = ?').get(jobId) as any;
      expect(job.status).toBe('FAILED');
      expect(job.attempts).toBe(1);
      expect(job.last_error).toContain('Simulated upstream delivery timeout');
      expect(new Date(job.next_retry_at).getTime()).toBeGreaterThan(Date.now());
    });

    it('moves failed job to DEAD_LETTER queue when max attempts are exceeded', async () => {
      const now = new Date().toISOString();
      const jobId = 'out-deadletter-test-1';
      db.prepare(`
        INSERT INTO outbox_jobs (
          id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at
        ) VALUES (?, 'NOTIFICATION_DISPATCH', ?, 'PENDING', 2, 3, ?, ?, ?)
      `).run(
        jobId,
        JSON.stringify({ simulateFailure: true, message: 'Permanent failure' }),
        now, now, now
      );

      await worker.processNextBatch();

      const job = db.prepare('SELECT * FROM outbox_jobs WHERE id = ?').get(jobId) as any;
      expect(job.status).toBe('DEAD_LETTER');
      expect(job.attempts).toBe(3);
    });

    it('evaluates and flags SLA breached work items automatically', async () => {
      // Set an active item to have overdue SLA and sla_breached = 0
      const pastTime = new Date(Date.now() - 3600 * 1000).toISOString();
      db.prepare('UPDATE work_items SET sla_due_at = ?, sla_breached = 0 WHERE id = ?').run(pastTime, 'wi-1001');

      const breachedCount = worker.evaluateSlaBreaches();
      expect(breachedCount).toBeGreaterThanOrEqual(1);

      const item = db.prepare('SELECT sla_breached FROM work_items WHERE id = ?').get('wi-1001') as any;
      expect(item.sla_breached).toBe(1);

      const audit = db.prepare('SELECT * FROM audit_events WHERE work_item_id = ? AND event_type = ?').get('wi-1001', 'SLA_BREACHED') as any;
      expect(audit).toBeDefined();
      expect(audit.actor_user_id).toBeNull();
    });
  });
});
