import Database from 'better-sqlite3';
import { initializeSchema } from './schema.js';
import { getDb, createDbConnection } from './connection.js';

export function seedDatabase(db: Database.Database): void {
  initializeSchema(db);

  // Clear existing data for fresh seed
  db.exec(`
    DELETE FROM audit_events;
    DELETE FROM comments;
    DELETE FROM outbox_jobs;
    DELETE FROM idempotency_records;
    DELETE FROM work_items;
    DELETE FROM team_memberships;
    DELETE FROM teams;
    DELETE FROM users;
  `);

  const now = new Date();
  const isoNow = now.toISOString();

  // Helper for relative timestamps
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 60 * 60 * 1000).toISOString();
  const hoursFromNow = (h: number) => new Date(now.getTime() + h * 60 * 60 * 1000).toISOString();

  // 1. Seed Users
  const insertUser = db.prepare(`
    INSERT INTO users (id, name, email, avatar_url, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const users = [
    { id: 'usr-alex-lead', name: 'Alex Rivera', email: 'alex.rivera@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=100' },
    { id: 'usr-elena-eng', name: 'Elena Rostov', email: 'elena.rostov@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=100' },
    { id: 'usr-marcus-pay', name: 'Marcus Vance', email: 'marcus.vance@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=100' },
    { id: 'usr-sophia-pay-lead', name: 'Sophia Chen', email: 'sophia.chen@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100' },
    { id: 'usr-clara-risk', name: 'Clara Dubois', email: 'clara.dubois@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=100' },
    { id: 'usr-david-support', name: 'David Kim', email: 'david.kim@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100' },
    { id: 'usr-sarah-lead-support', name: 'Sarah Jenkins', email: 'sarah.jenkins@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=100' },
    { id: 'usr-admin', name: 'Jordan Bell (Admin)', email: 'admin@newtonite.io', avatar_url: 'https://images.unsplash.com/photo-1472099645785-5658abf4ff4e?w=100' }
  ];

  for (const u of users) {
    insertUser.run(u.id, u.name, u.email, u.avatar_url, hoursAgo(72));
  }

  // 2. Seed Teams
  const insertTeam = db.prepare(`
    INSERT INTO teams (id, name, slug, description, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const teams = [
    { id: 'team-eng', name: 'Core Engineering', slug: 'engineering', description: 'Core infrastructure, platform services, and backend reliability' },
    { id: 'team-pay', name: 'Payments Operations', slug: 'payments', description: 'High-value transactions, payouts, disputes, and payment gateway health' },
    { id: 'team-risk', name: 'Risk & Compliance', slug: 'compliance', description: 'AML, regulatory reviews, KYC investigations, and audit verification' },
    { id: 'team-sec', name: 'Incident Response & SecOps', slug: 'incident-response', description: 'Live production outages, security alerts, and critical containment' },
    { id: 'team-cust', name: 'Customer Support Escalations', slug: 'customer-ops', description: 'Tier-3 VIP escalations, tenant provisioning, and billing disputes' }
  ];

  for (const t of teams) {
    insertTeam.run(t.id, t.name, t.slug, t.description, hoursAgo(72));
  }

  // 3. Seed Team Memberships with distinct roles
  const insertMembership = db.prepare(`
    INSERT INTO team_memberships (id, user_id, team_id, role, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const memberships = [
    // Engineering
    { id: 'mem-1', user_id: 'usr-alex-lead', team_id: 'team-eng', role: 'LEAD' },
    { id: 'mem-2', user_id: 'usr-elena-eng', team_id: 'team-eng', role: 'MEMBER' },
    { id: 'mem-3', user_id: 'usr-admin', team_id: 'team-eng', role: 'ADMIN' },
    // Payments
    { id: 'mem-4', user_id: 'usr-sophia-pay-lead', team_id: 'team-pay', role: 'LEAD' },
    { id: 'mem-5', user_id: 'usr-marcus-pay', team_id: 'team-pay', role: 'APPROVER' },
    // Risk & Compliance
    { id: 'mem-6', user_id: 'usr-clara-risk', team_id: 'team-risk', role: 'APPROVER' },
    // Incident Response
    { id: 'mem-7', user_id: 'usr-alex-lead', team_id: 'team-sec', role: 'LEAD' },
    { id: 'mem-8', user_id: 'usr-elena-eng', team_id: 'team-sec', role: 'MEMBER' },
    // Customer Support
    { id: 'mem-9', user_id: 'usr-sarah-lead-support', team_id: 'team-cust', role: 'LEAD' },
    { id: 'mem-10', user_id: 'usr-david-support', team_id: 'team-cust', role: 'MEMBER' }
  ];

  for (const m of memberships) {
    insertMembership.run(m.id, m.user_id, m.team_id, m.role, hoursAgo(72));
  }

  // 4. Seed Work Items
  const insertWorkItem = db.prepare(`
    INSERT INTO work_items (
      id, tracking_num, title, description, category, priority, status,
      assigned_team_id, assigned_user_id, created_by_user_id,
      requires_approval, approval_status, approval_requested_at, approved_by_user_id, approval_note,
      resolution_summary, root_cause_category, sla_due_at, sla_breached,
      version, metadata_json, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?,
      ?, ?, ?, ?
    )
  `);

  const workItems = [
    {
      id: 'wi-1001',
      tracking_num: 'OPS-1001',
      title: 'Payment Gateway 502 Webhook Drops on European Ingress',
      description: 'Incoming Stripe webhook events for EUR settlements are failing at 8% rate across cluster ingress due to connection pool exhaustion.',
      category: 'INCIDENT',
      priority: 'P0_CRITICAL',
      status: 'IN_PROGRESS',
      assigned_team_id: 'team-sec',
      assigned_user_id: 'usr-alex-lead',
      created_by_user_id: 'usr-sophia-pay-lead',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursAgo(1), // Breached!
      sla_breached: 1,
      version: 3,
      metadata_json: JSON.stringify({ affected_service: 'api-gateway-eu', error_code: 'HTTP_502', impact: '8% webhook drops' }),
      created_at: hoursAgo(4),
      updated_at: hoursAgo(1)
    },
    {
      id: 'wi-1002',
      tracking_num: 'OPS-1002',
      title: 'High-Value Transaction Clearance: $450,000 Corporate Wire Escrow',
      description: 'Outbound escrow release for enterprise customer Nova Corp requires dual-signoff authorization from Payment Operations Lead or Approver.',
      category: 'PAYMENTS',
      priority: 'P1_HIGH',
      status: 'PENDING_APPROVAL',
      assigned_team_id: 'team-pay',
      assigned_user_id: 'usr-marcus-pay',
      created_by_user_id: 'usr-marcus-pay',
      requires_approval: 1,
      approval_status: 'PENDING',
      approval_requested_at: hoursAgo(2),
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(2),
      sla_breached: 0,
      version: 2,
      metadata_json: JSON.stringify({ transaction_id: 'TXN-99812-US', amount: 450000, currency: 'USD', counterparty: 'Nova Corp International' }),
      created_at: hoursAgo(3),
      updated_at: hoursAgo(2)
    },
    {
      id: 'wi-1003',
      tracking_num: 'OPS-1003',
      title: 'GDPR Article 17 Data Erasure Request (Subject: CUST-88392)',
      description: 'Customer requested full erasure of personal identifiable records across backup cold stores and analytics logs within the mandatory 30-day statutory window.',
      category: 'COMPLIANCE',
      priority: 'P2_MEDIUM',
      status: 'IN_PROGRESS',
      assigned_team_id: 'team-risk',
      assigned_user_id: 'usr-clara-risk',
      created_by_user_id: 'usr-david-support',
      requires_approval: 1,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(18),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ regulation: 'GDPR', data_subject_id: 'CUST-88392', requested_scope: 'all_pii' }),
      created_at: hoursAgo(6),
      updated_at: hoursAgo(6)
    },
    {
      id: 'wi-1004',
      tracking_num: 'OPS-1004',
      title: 'Database Replica Replication Lag Spike on Aurora Cluster-3',
      description: 'Read replica in eu-west-1 experiencing 340s replication lag following batch migration job. Need team triage.',
      category: 'ENGINEERING',
      priority: 'P1_HIGH',
      status: 'READY',
      assigned_team_id: 'team-eng',
      assigned_user_id: null, // Unassigned!
      created_by_user_id: 'usr-alex-lead',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(3),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ cluster: 'aurora-prod-eu3', current_lag_seconds: 340 }),
      created_at: hoursAgo(1),
      updated_at: hoursAgo(1)
    },
    {
      id: 'wi-1005',
      tracking_num: 'OPS-1005',
      title: 'Enterprise Customer SLA Breach Warning: Acronis Global',
      description: 'VIP Account Manager notified that 4 distinct support tickets for Acronis breached Tier-1 resolution thresholds today.',
      category: 'CUSTOMER_OPS',
      priority: 'P1_HIGH',
      status: 'TRIAGE',
      assigned_team_id: 'team-cust',
      assigned_user_id: null, // Unassigned!
      created_by_user_id: 'usr-sarah-lead-support',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(2),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ account_tier: 'Enterprise VIP', mrr: '$45k' }),
      created_at: hoursAgo(2),
      updated_at: hoursAgo(2)
    },
    {
      id: 'wi-1006',
      tracking_num: 'OPS-1006',
      title: 'Suspected Card Testing Attack Velocity in Southeast Region',
      description: 'Fraud rules flagged 1,420 rapid $1 authorization attempts originating from ASN 45102 within 15 minutes. WAF rate limiting rule must be verified.',
      category: 'INCIDENT',
      priority: 'P0_CRITICAL',
      status: 'IN_PROGRESS',
      assigned_team_id: 'team-sec',
      assigned_user_id: 'usr-alex-lead',
      created_by_user_id: 'usr-marcus-pay',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(1),
      sla_breached: 0,
      version: 2,
      metadata_json: JSON.stringify({ attack_type: 'card_testing', attempts_per_minute: 95, mitigation_stage: 'ip_blocklist' }),
      created_at: hoursAgo(1),
      updated_at: hoursAgo(1)
    },
    {
      id: 'wi-1007',
      tracking_num: 'OPS-1007',
      title: 'Refund Authorization: Accidental Double Billing for Order #77192',
      description: 'Customer was double charged due to idempotency header omission in legacy mobile app v3.4. Refund amount is $1,250.',
      category: 'PAYMENTS',
      priority: 'P2_MEDIUM',
      status: 'READY',
      assigned_team_id: 'team-pay',
      assigned_user_id: 'usr-marcus-pay',
      created_by_user_id: 'usr-david-support',
      requires_approval: 1,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(12),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ order_id: '77192', refund_amount: 1250 }),
      created_at: hoursAgo(5),
      updated_at: hoursAgo(5)
    },
    {
      id: 'wi-1008',
      tracking_num: 'OPS-1008',
      title: 'Annual SOC2 Type II Audit Artifact Verification',
      description: 'External auditor has requested sample logs for user access reviews conducted in Q2 and Q3.',
      category: 'COMPLIANCE',
      priority: 'P3_LOW',
      status: 'IN_PROGRESS',
      assigned_team_id: 'team-risk',
      assigned_user_id: 'usr-clara-risk',
      created_by_user_id: 'usr-admin',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(48),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ framework: 'SOC2_TYPE_2', evidence_cycle: '2026-H1' }),
      created_at: hoursAgo(12),
      updated_at: hoursAgo(8)
    },
    {
      id: 'wi-1009',
      tracking_num: 'OPS-1009',
      title: 'API Rate Limiting Throttle Misconfiguration on v2/checkout',
      description: 'Legitimate merchant checkout requests were returning HTTP 429 during flash sale.',
      category: 'ENGINEERING',
      priority: 'P1_HIGH',
      status: 'RESOLVED',
      assigned_team_id: 'team-eng',
      assigned_user_id: 'usr-elena-eng',
      created_by_user_id: 'usr-alex-lead',
      requires_approval: 0,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: 'Identified overly aggressive Redis token bucket limit configured on per-IP instead of per-API-token. Replaced configuration in helm chart values and deployed hotfix.',
      root_cause_category: 'CONFIGURATION_ERROR',
      sla_due_at: hoursAgo(10),
      sla_breached: 0,
      version: 4,
      metadata_json: JSON.stringify({ hotfix_pr: '#1420', helm_release: 'checkout-v2.8.1' }),
      created_at: hoursAgo(24),
      updated_at: hoursAgo(12)
    },
    {
      id: 'wi-1010',
      tracking_num: 'OPS-1010',
      title: 'VIP Customer Tenant Migration from US-East to EU-Central',
      description: 'Strategic banking client request for tenant data store migration under German data residency laws.',
      category: 'CUSTOMER_OPS',
      priority: 'P2_MEDIUM',
      status: 'READY',
      assigned_team_id: 'team-cust',
      assigned_user_id: 'usr-david-support',
      created_by_user_id: 'usr-sarah-lead-support',
      requires_approval: 1,
      approval_status: 'NONE',
      approval_requested_at: null,
      approved_by_user_id: null,
      approval_note: null,
      resolution_summary: null,
      root_cause_category: null,
      sla_due_at: hoursFromNow(16),
      sla_breached: 0,
      version: 1,
      metadata_json: JSON.stringify({ tenant_id: 'tenant-de-bank-01', storage_gb: 420 }),
      created_at: hoursAgo(10),
      updated_at: hoursAgo(10)
    }
  ];

  for (const item of workItems) {
    insertWorkItem.run(
      item.id,
      item.tracking_num,
      item.title,
      item.description,
      item.category,
      item.priority,
      item.status,
      item.assigned_team_id,
      item.assigned_user_id,
      item.created_by_user_id,
      item.requires_approval,
      item.approval_status,
      item.approval_requested_at,
      item.approved_by_user_id,
      item.approval_note,
      item.resolution_summary,
      item.root_cause_category,
      item.sla_due_at,
      item.sla_breached,
      item.version,
      item.metadata_json,
      item.created_at,
      item.updated_at
    );
  }

  // 5. Seed Audit Events & Comments
  const insertAudit = db.prepare(`
    INSERT INTO audit_events (id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertAudit.run('aud-1', 'wi-1001', 'usr-sophia-pay-lead', 'CREATED', null, JSON.stringify({ status: 'TRIAGE' }), 'Incident reported via webhook monitor', hoursAgo(4));
  insertAudit.run('aud-2', 'wi-1001', 'usr-alex-lead', 'ASSIGNED', JSON.stringify({ assigned_user_id: null }), JSON.stringify({ assigned_user_id: 'usr-alex-lead' }), 'Claimed incident', hoursAgo(3));
  insertAudit.run('aud-3', 'wi-1001', 'usr-alex-lead', 'STATUS_CHANGED', JSON.stringify({ status: 'TRIAGE' }), JSON.stringify({ status: 'IN_PROGRESS' }), 'Beginning ingress pool debugging', hoursAgo(3));

  insertAudit.run('aud-4', 'wi-1002', 'usr-marcus-pay', 'CREATED', null, JSON.stringify({ status: 'TRIAGE' }), 'Wire clearance request created', hoursAgo(3));
  insertAudit.run('aud-5', 'wi-1002', 'usr-marcus-pay', 'APPROVAL_REQUESTED', JSON.stringify({ status: 'IN_PROGRESS' }), JSON.stringify({ status: 'PENDING_APPROVAL' }), 'Submitted dual-signoff request for $450k escrow', hoursAgo(2));

  insertAudit.run('aud-6', 'wi-1009', 'usr-alex-lead', 'CREATED', null, JSON.stringify({ status: 'TRIAGE' }), 'Reported rate limiting spike', hoursAgo(24));
  insertAudit.run('aud-7', 'wi-1009', 'usr-elena-eng', 'RESOLVED', JSON.stringify({ status: 'IN_PROGRESS' }), JSON.stringify({ status: 'RESOLVED' }), 'Deployed Redis token bucket configuration fix', hoursAgo(12));

  // 6. Comments
  const insertComment = db.prepare(`
    INSERT INTO comments (id, work_item_id, user_id, content, is_internal_only, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  insertComment.run('com-1', 'wi-1001', 'usr-alex-lead', 'Scaled ingress pods from 4 to 12. 502 error rate dropped to 2%, but root cause looks like upstream connection timeout on postgres pool.', 0, hoursAgo(2));
  insertComment.run('com-2', 'wi-1001', 'usr-sophia-pay-lead', 'Internal note: Stripe customer escalation call scheduled in 30 mins with VP.', 1, hoursAgo(1));
  insertComment.run('com-3', 'wi-1002', 'usr-marcus-pay', 'Beneficiary account details and OFAC sanctions list have been verified clean. Awaiting second signoff from Sophia or Jordan.', 0, hoursAgo(2));
}

// Execute when invoked directly
if (process.argv[1]?.endsWith('seed.ts') || process.argv[1]?.endsWith('seed.js')) {
  const db = getDb();
  console.log('Seeding database...');
  seedDatabase(db);
  console.log('Seed completed successfully!');
}
