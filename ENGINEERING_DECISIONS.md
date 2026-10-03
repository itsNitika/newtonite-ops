# Newtonite Operations Platform — Engineering Decisions & Architecture

## System Overview
The Newtonite Operations Platform coordinates mission-critical operational work (incidents, payment clearances, customer escalations, compliance reviews) across hundreds of employees and multiple cross-functional teams.

This document outlines five foundational engineering decisions made while architecting and implementing the platform, detailing the problem context, chosen solution, trade-offs evaluated, and failure modes.

```
                              ┌──────────────────────────────────────────────┐
                              │                 React Client                 │
                              │  - Dense Table & Kanban Board Views          │
                              │  - Realtime Presence & Collision Prevention  │
                              │  - Conflict Resolution Modal (409)           │
                              └──────────────┬──────────────────▲────────────┘
                                             │ REST (with       │ Server-Sent
                                             │ Idempotency-Key) │ Events (SSE)
                                             ▼                  │
                              ┌─────────────────────────────────┴────────────┐
                              │              Express API Server              │
                              │  - Identity & Multi-Team RBAC                │
                              │  - Idempotency Deduplication Middleware     │
                              │  - State Machine & Segregation of Duties     │
                              └──────────────┬──────────────────▲────────────┘
                                             │ Atomic Writes    │ Polling
                                             │ (WAL mode)       │ (3s loop)
                                             ▼                  │
                              ┌─────────────────────────────────┴────────────┐
                              │            SQLite Database (WAL)             │
                              │  - work_items (versioned for OCC)            │
                              │  - audit_events (immutable log)              │
                              │  - idempotency_records                       │
                              │  - outbox_jobs (transactional queue)         │
                              └──────────────┬───────────────────────────────┘
                                             │
                                             ▼
                              ┌──────────────────────────────────────────────┐
                              │            Outbox Worker Daemon              │
                              │  - Exponential Backoff Retries               │
                              │  - Dead Letter Queue (DLQ)                   │
                              │  - Periodic SLA Breach Evaluator             │
                              └──────────────────────────────────────────────┘
```

---

## Decision 1: Optimistic Concurrency Control (OCC) over Pessimistic Locking

### Context & Problem
Operational environments are collaborative and high-pressure. Multiple engineers or ops analysts often examine the same high-severity incident or disputed payment simultaneously. Two users might attempt to claim the same unassigned item, or User A might update incident severity while User B is still viewing stale diagnostic data.

### Decision
We implemented **Optimistic Concurrency Control (OCC)** using an incrementing integer `version` field on the `work_items` record:
1. Every mutating API endpoint (`/claim`, `/transition`, `/approve`, `PATCH /`) requires the client to supply `expected_version`.
2. The database performs an atomic conditional update:
   ```sql
   UPDATE work_items 
   SET status = :next_status, version = version + 1, updated_at = :now
   WHERE id = :id AND version = :expected_version;
   ```
3. If zero rows are affected, the backend recognizes that a concurrent transaction modified the record. It rejects the request with **HTTP 409 Conflict** and returns the latest server state and version.
4. On the frontend, a dedicated **Conflict Resolution Modal** intercepts the 409, displays a side-by-side diff showing what changed on the server, and allows the user to safely refresh and reconcile without silently overwriting colleague contributions.

### Trade-offs & Alternatives
* **Alternative Considered: Pessimistic Row Locking (`SELECT ... FOR UPDATE` or explicit lock holds).**
  * *Downside:* If a user opens a work item drawer and leaves their desk or loses internet connectivity, the item remains locked for all other team members. Pessimistic locking creates operational bottlenecks, deadlocks, and poor user experience in distributed teams.
* **OCC Advantage:** Read operations remain 100% lock-free and blazing fast. Contention is surfaced transparently with clear user agency. To minimize collisions before they happen, we paired OCC with a real-time **SSE Presence Heartbeat** that notifies users when others are actively viewing or editing the same item.

---

## Decision 2: Idempotency Keys for Safe Retries & Deduplication

### Context & Problem
Under stressful operational situations (such as a production outage), users frequently double-click buttons, or flaky network connections drop during flight, prompting client-side retries. Without protection, this can result in duplicate wire releases, duplicate incident tickets, or duplicate state transitions.

### Decision
We introduced an **Idempotency Key middleware** applied to all mutating operations (`POST`, `PATCH`):
1. Mutating requests accept an `Idempotency-Key` header (generated client-side via cryptographic tokens or UUIDs).
2. The middleware hashes the request verb, target path, and payload body (`SHA-256`).
3. An `idempotency_records` table tracks key status:
   * **`PROCESSING`**: If a concurrent request arrives with the same key while processing is in flight, the system returns **HTTP 409 Conflict** ("Request in progress, please wait").
   * **`COMPLETED`**: If a replayed request arrives with matching hash, the middleware intercepts execution and returns the original cached HTTP status code and response payload with header `X-Idempotent-Replay: true`.
   * **Payload Mismatch**: If the same key is reused with a *different* body, the system rejects it with **HTTP 422 Unprocessable Entity** ("Idempotency key reused with mismatched payload").

### Trade-offs & Alternatives
* **Alternative Considered: Client-side button disabling only.**
  * *Downside:* Client-only debouncing is vulnerable to page reloads, network timeouts, multi-tab usage, and automated API callers.
* **Server-side Idempotency Advantage:** Protects system integrity regardless of client behavior or network volatility. The response caching prevents duplicate downstream side-effects (e.g. outbox notifications or duplicate audit logs).

---

## Decision 3: Transactional Outbox Pattern for Resilient Asynchronous Processing

### Context & Problem
Primary operational transactions (e.g., claiming a ticket, changing state, submitting signoff) must be fast and consistent. However, secondary operations—such as sending email/Slack notifications, broadcasting webhooks, evaluating SLA breach thresholds, and audit enrichment—can fail, experience network latency, or require retry logic. Executing secondary actions synchronously inside the HTTP request path risks failing the user's primary action due to downstream timeouts.

### Decision
We implemented the **Transactional Outbox Pattern**:
1. When a work item is mutated, an `outbox_jobs` record is inserted inside the **exact same SQLite database transaction** as the item mutation. If the transaction rolls back, no orphan job is created; if it commits, the job is guaranteed to exist.
2. A lightweight background worker daemon (`OutboxWorker`) polls the outbox queue:
   * Successfully processed jobs are marked `COMPLETED`.
   * On transient failure (e.g. simulated network 504), the worker increments `attempts`, logs `last_error`, and schedules a retry with **exponential backoff** (`next_retry_at = now + 2^attempts * 1000ms`).
   * When retries exceed `max_attempts` (default: 5), the job transitions to `DEAD_LETTER` (DLQ) status without crashing the worker.
3. The platform provides a live **Outbox & Worker Health Inspector** in the UI, enabling operations leads to monitor queue depth, inspect failures, and manually re-trigger failed jobs with one click.

### Trade-offs & Alternatives
* **Alternative Considered: In-memory task queue (`async/await` without database persistence).**
  * *Downside:* If the server process restarts or crashes while a background notification or enrichment task is pending, the task is permanently lost.
* **Alternative Considered: Heavy message brokers (Kafka, RabbitMQ, Redis BullMQ).**
  * *Downside:* Introduces external infrastructure dependencies and dual-write consistency hazards (database commits, but broker publish fails).
* **Transactional Outbox Advantage:** Guaranteed at-least-once delivery, zero external infrastructure requirements, strict ACID durability, and complete operational transparency.

---

## Decision 4: Rigid State Machine with Dual-Signoff Gates & Segregation of Duties

### Context & Problem
Operations involve high-stakes workflows (e.g., $450,000 corporate wire clearances, GDPR compliance erasures, critical incident resolutions). Without server-enforced state machine rules:
* Requests could skip necessary triage or approval stages.
* Workers could resolve critical incidents without documenting root causes or resolution steps.
* The person who requested a high-risk action could approve their own request (lack of segregation of duties).

### Decision
We built a centralized `StateMachineEngine` enforced strictly on the backend:
1. **Transition Graph**: Enforces allowed state edges (`TRIAGE` -> `READY` -> `IN_PROGRESS` -> `PENDING_APPROVAL` -> `RESOLVED` / `CANCELLED`).
2. **Approval Gate**: Items flagged with `requires_approval = true` are structurally barred from transitioning to `RESOLVED` directly from `IN_PROGRESS`. They must transition to `PENDING_APPROVAL` and receive formal signoff.
3. **Segregation of Duties**: Only users holding `APPROVER` or `LEAD` roles for that item's assigned team can approve. Crucially, **the creator or assigned owner of an item is explicitly forbidden from approving their own request** (unless overridden by a global Admin with audit notes).
4. **Resolution Completeness**: Transitioning to `RESOLVED` enforces that a non-empty `resolution_summary` (minimum 5 characters) and a valid `root_cause_category` are provided, preventing tickets from being closed with undocumented outcomes.

### Trade-offs
* *Trade-off:* Adds minor friction compared to freeform kanban boards where any user can drag any card into "Done".
* *Justification:* In operations under pressure, auditability, accountability, and prevention of unauthorized actions are non-negotiable.

---

## Decision 5: Storage Architecture, Server-Side Pagination, & WAL Mode

### Context & Problem
The system is specified to scale to thousands of users, many teams, and tens of thousands of active work items with an ever-growing history of audit logs. Fetching the entire dataset into the browser or keeping everything in application memory would lead to severe browser lag, high memory consumption, and slow queries.

### Decision
1. **Storage Engine**: SQLite configured in **WAL (Write-Ahead Logging)** mode with `PRAGMA synchronous = NORMAL` and `PRAGMA busy_timeout = 5000`. WAL mode permits simultaneous concurrent readers without blocking writes.
2. **Indexing Strategy**: Dedicated composite indexes on high-frequency query patterns:
   * `idx_work_items_status_priority` (`status`, `priority`)
   * `idx_work_items_team_status` (`assigned_team_id`, `status`)
   * `idx_work_items_user_status` (`assigned_user_id`, `status`)
   * `idx_work_items_sla` (`sla_due_at`, `sla_breached`)
   * `idx_work_items_tracking` (`tracking_num`)
   * `idx_audit_work_item` (`work_item_id`, `created_at ASC`)
3. **Server-Side Pagination & Query Filtering**: The API and frontend only load current page slices (`limit`, `offset`, total count) rather than loading 50,000 records. Full-text token search on tracking numbers, titles, and descriptions is performed at the database level.

---

## Intentionally Deferred & Known Limitations

| Omission / Limitation | Rationale & Trade-off | Future Production Path |
| :--- | :--- | :--- |
| **Full OAuth2 / OIDC Identity Provider** | In this exercise, full authentication handshakes (Okta/Google SSO) would distract from the core operational and concurrency problem. We implemented robust RBAC + multi-team memberships and a persona switcher to make evaluating different roles effortless. | Integrate Auth0, Okta, or Keycloak via standard JWT bearer middleware. |
| **Distributed Multi-Node SQLite Clustered Deployment** | SQLite in WAL mode easily handles tens of thousands of writes and reads for hundreds of employees on a single node with zero external dependencies. | Migrate to PostgreSQL with connection pooling (PgBouncer) when horizontal multi-node API scaling is required. Schema and queries are standard SQL. |
| **Elasticsearch / Meilisearch Cluster** | Basic SQL indexing and prefix matching handle tens of thousands of work items with sub-10ms query times without running another memory-heavy container. | Introduce OpenSearch or SQLite FTS5 for fuzzy search and stemming if request history expands to millions of records. |
| **WebSocket Bidirectional Protocol** | SSE (Server-Sent Events) is simpler, auto-reconnecting, works through corporate proxies and firewalls without upgrade overhead, and perfectly fits the one-way server-to-client broadcast model. | Add WebSockets only if high-frequency collaborative rich-text typing (Operational Transformation / CRDTs) is required. |
