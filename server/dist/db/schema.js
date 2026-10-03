export function initializeSchema(db) {
    db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      created_at TEXT NOT NULL
    );

    -- Teams table
    CREATE TABLE IF NOT EXISTS teams (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      description TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    -- Team Memberships (Users can belong to multiple teams with distinct roles)
    CREATE TABLE IF NOT EXISTS team_memberships (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN ('ADMIN', 'LEAD', 'MEMBER', 'APPROVER', 'AUDITOR')),
      created_at TEXT NOT NULL,
      UNIQUE(user_id, team_id)
    );

    -- Work Items table
    CREATE TABLE IF NOT EXISTS work_items (
      id TEXT PRIMARY KEY,
      tracking_num TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      category TEXT NOT NULL CHECK(category IN ('ENGINEERING', 'PAYMENTS', 'INCIDENT', 'COMPLIANCE', 'CUSTOMER_OPS', 'GENERAL')),
      priority TEXT NOT NULL CHECK(priority IN ('P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW')),
      status TEXT NOT NULL CHECK(status IN ('TRIAGE', 'READY', 'IN_PROGRESS', 'PENDING_APPROVAL', 'RESOLVED', 'CANCELLED')),
      assigned_team_id TEXT NOT NULL REFERENCES teams(id),
      assigned_user_id TEXT REFERENCES users(id),
      created_by_user_id TEXT NOT NULL REFERENCES users(id),
      requires_approval INTEGER NOT NULL DEFAULT 0,
      approval_status TEXT NOT NULL DEFAULT 'NONE' CHECK(approval_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED')),
      approval_requested_at TEXT,
      approved_by_user_id TEXT REFERENCES users(id),
      approval_note TEXT,
      resolution_summary TEXT,
      root_cause_category TEXT,
      sla_due_at TEXT NOT NULL,
      sla_breached INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Indexes for high-frequency filtering and scalability
    CREATE INDEX IF NOT EXISTS idx_work_items_status_priority ON work_items(status, priority);
    CREATE INDEX IF NOT EXISTS idx_work_items_team_status ON work_items(assigned_team_id, status);
    CREATE INDEX IF NOT EXISTS idx_work_items_user_status ON work_items(assigned_user_id, status);
    CREATE INDEX IF NOT EXISTS idx_work_items_sla ON work_items(sla_due_at, sla_breached);
    CREATE INDEX IF NOT EXISTS idx_work_items_created ON work_items(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_work_items_tracking ON work_items(tracking_num);

    -- Audit Events table (Immutable event log)
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      actor_user_id TEXT REFERENCES users(id),
      event_type TEXT NOT NULL,
      previous_state TEXT,
      new_state TEXT,
      comment TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_audit_work_item ON audit_events(work_item_id, created_at ASC);

    -- Comments & Discussion
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      work_item_id TEXT NOT NULL REFERENCES work_items(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id),
      content TEXT NOT NULL,
      is_internal_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_comments_work_item ON comments(work_item_id, created_at ASC);

    -- Idempotency Records (for safe retries and deduplication)
    CREATE TABLE IF NOT EXISTS idempotency_records (
      idempotency_key TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      request_path TEXT NOT NULL,
      request_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('PROCESSING', 'COMPLETED', 'FAILED')),
      response_status INTEGER,
      response_body TEXT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    -- Transactional Outbox (for resilient asynchronous processing)
    CREATE TABLE IF NOT EXISTS outbox_jobs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD_LETTER')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      last_error TEXT,
      next_retry_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_status_retry ON outbox_jobs(status, next_retry_at);
  `);
}
