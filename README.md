# Newtonite Operations Under Pressure — Operations Management Platform

> A full-stack coordination and management platform engineered for rapidly growing organizations handling high-pressure operational workflows, incidents, payment clearances, and multi-team approvals.

---

## 🌟 Key Highlights & Critical Behaviors

This system replaces disorganized chat threads, spreadsheets, and emails with a resilient, auditable platform designed for concurrency, consistency, and scale:

1. **Optimistic Concurrency Control (OCC) & Versioning**:
   * Every work item maintains a strict monotonically increasing `version` counter.
   * State updates, ownership claims, and approvals use atomic conditional queries (`WHERE id = ? AND version = ?`).
   * Stale updates are intercepted with **HTTP 409 Conflict**, triggering a side-by-side **Conflict Resolution Dialog** allowing the user to inspect changes and reconcile safely.
2. **Idempotency Keys & Safe Deduplication**:
   * All mutating requests support the `Idempotency-Key` header with payload hashing (`SHA-256`).
   * Accidental double-clicks and network retries return the original cached response with `X-Idempotent-Replay: true` without duplicating work items or audit events.
3. **Rigid State Machine with Dual-Signoff Gates & Segregation of Duties**:
   * Lifecycle stages: `TRIAGE` → `READY` → `IN_PROGRESS` → `PENDING_APPROVAL` → `RESOLVED` / `CANCELLED`.
   * Items requiring signoff cannot skip approval stages.
   * **Segregation of Duties**: Creators and owners of requests cannot approve their own items; only authorized team approvers or leads can grant signoff.
   * Resolution requires a mandatory resolution summary and root cause categorization.
4. **Transactional Outbox Pattern for Background Resilience**:
   * Notifications, SLA evaluations, and audit enrichments are written to an `outbox_jobs` table inside the same ACID transaction as the primary work item mutation.
   * A background worker daemon continuously processes jobs with **exponential backoff retries** and an automatic **Dead Letter Queue (DLQ)**.
5. **Real-time Live Sync & Active Viewer Presence**:
   * Server-Sent Events (SSE) stream broadcasts updates in real-time across all connected clients.
   * Active viewer presence indicators show who is currently viewing an item, preventing blind editing collisions.
6. **Scalable Querying & Server-Side Pagination**:
   * SQLite with Write-Ahead Logging (`WAL` mode) and composite indexing on `(status, priority)`, `(assigned_team_id, status)`, `(sla_due_at)`, and `(created_at)`.
   * Paginated, indexed search across tracking numbers, titles, and descriptions designed to handle tens of thousands of items without client-side memory bloat.

---

## 🚀 Quick Start Instructions

### Prerequisites
* **Node.js** (v18+; verified on v24)
* **npm** (v9+)

### Installation
Clone or navigate to the repository directory:
```bash
# In repository root
npm run install:all
```
*(Or install inside each folder: `cd server && npm install`, then `cd ../client && npm install`)*

### Seed Database
Seed rich, realistic operational data across 5 cross-functional teams, 8 user personas, and active operational items (including critical incidents and approval-gated payments):
```bash
npm run seed
```

### Running the Application

To run the backend server and frontend client concurrently:

**Terminal 1 — Backend API Server:**
```bash
npm run dev:server
```
*Backend runs on: `http://localhost:3001`*

**Terminal 2 — Frontend Client:**
```bash
npm run dev:client
```
*Frontend runs on: `http://localhost:5173`*

Open **http://localhost:5173** in your browser.

---

## 🧪 Running Automated Tests

A comprehensive Vitest test suite covers all critical edge cases, race conditions, and failure modes:

```bash
npm test
```

### Verified Test Cases:
* ✅ **OCC Race Conditions:** Stale claim or update rejection with HTTP 409 and fresh version payload.
* ✅ **Idempotency Deduplication:** Replaying identical requests with the same key returns cached responses without duplicate side-effects.
* ✅ **Idempotency Tamper Protection:** Reusing a key with a modified payload returns HTTP 422 Unprocessable Entity.
* ✅ **Approval Gates:** Blocks direct resolution of approval-gated items without formal signoff.
* ✅ **Segregation of Duties:** Rejects self-approval attempts by ticket creators/owners with HTTP 403 Forbidden.
* ✅ **Resolution Completeness:** Validates that resolving a work item requires a detailed resolution summary.
* ✅ **Outbox Exponential Backoff:** Re-schedules transient failures with exponential backoff.
* ✅ **Dead Letter Queue:** Transitions jobs to `DEAD_LETTER` after exceeding max attempts.
* ✅ **SLA Breach Monitoring:** Identifies overdue items, sets `sla_breached = 1`, and creates automated system audit logs.

---

## 🧭 How to Test & Demo Key Behaviors in the UI

### 1. Test Concurrency Conflict (OCC 409)
* In the top bar, click the **"Simulate Concurrency Conflict"** button.
* The system intentionally triggers a simulated simultaneous write collision.
* The **Optimistic Concurrency Conflict Dialog** immediately appears, showing:
  * Your stale version vs current server state.
  * Details of what changed on the server.
  * A 1-click **"Reload Latest Server State"** button to reconcile safely.

### 2. Test Idempotency & Duplicate Prevention
* Click **"New Request"** (+ button in header).
* Fill in details and click **"Simulate Double-Click (Test Idempotency)"**.
* The modal will submit two requests in rapid succession with the same `Idempotency-Key`.
* An alert will verify that the server processed the first request and returned the cached result with `X-Idempotent-Replay: true` for the second, without duplicating the item in the database!

### 3. Test Dual-Signoff & Segregation of Duties
* In the table, click **`OPS-1002`** (*High-Value Transaction Clearance: $450,000 Corporate Wire Escrow*).
* Notice the banner: **Dual-Signoff Approval Gate**.
* In the top header persona dropdown, select **Marcus Vance (Payments Specialist)**:
  * Marcus is the requester and assigned owner. Notice the warning:
    > *"Segregation of Duties Enforced: As the creator or assigned owner of this request, you cannot approve your own signoff."*
* Now switch persona in the dropdown to **Sophia Chen (Payments Lead)**:
  * Sophia has approver authority. The approval action box immediately unlocks!
  * Enter a signoff note and click **"Approve Request"**.
  * The item advances and unlocks the **"Complete & Resolve"** button.

### 4. Test Background Outbox Worker & Dead Letter Queue
* In the top header, click **"Worker & Outbox"**.
* View queue statistics (Total, Pending, Completed, Failed, Dead Letter).
* Click **"Run SLA Check Now"** to force immediate SLA evaluation across all items.
* If any job fails, click **"Retry"** to reset it for immediate processing.

---

## 📁 Repository Structure

```
newtonite-ops/
├── README.md                     # Setup, usage, and demonstration guide
├── ENGINEERING_DECISIONS.md      # In-depth architectural trade-offs document
├── package.json                  # Root orchestration scripts
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── app.ts                # Express app factory & middleware pipeline
│   │   ├── index.ts              # Server bootstrapper & Outbox daemon starter
│   │   ├── types.ts              # TypeScript domain types & interfaces
│   │   ├── db/
│   │   │   ├── connection.ts     # SQLite connection with WAL mode & busy timeout
│   │   │   ├── schema.ts         # Relational schema DDL & indexes
│   │   │   └── seed.ts           # Rich operational seed data generator
│   │   ├── domain/
│   │   │   ├── stateMachine.ts   # Transition graphs & segregation of duties engine
│   │   │   └── outboxWorker.ts   # Async worker with exponential backoff & DLQ
│   │   ├── events/
│   │   │   └── eventBus.ts       # SSE event hub & presence tracker
│   │   ├── middleware/
│   │   │   ├── auth.ts           # Identity & multi-team role enforcement
│   │   │   └── idempotency.ts    # Request hashing & duplicate prevention
│   │   └── routes/
│   │       ├── workItems.ts      # REST API for work items with OCC checks
│   │       ├── teams.ts          # Teams & memberships
│   │       ├── users.ts          # Identity & persona switching
│   │       ├── events.ts         # SSE subscription endpoint
│   │       └── outbox.ts         # Worker health and DLQ inspection
│   └── tests/
│       └── critical_behaviors.test.ts # Vitest suite for OCC, Idempotency & Outbox
└── client/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── App.tsx               # Main operational hub with view toggles
        ├── api.ts                # API client with OCC & Idempotency handling
        ├── types.ts              # Frontend domain interfaces
        ├── hooks/
        │   └── useSSE.ts         # Server-Sent Events live sync hook
        └── components/
            ├── Header.tsx        # Top bar with persona switcher & live status
            ├── WorkItemList.tsx  # Dense operational table with SLA countdowns
            ├── KanbanBoard.tsx   # Visual board grouped by workflow status
            ├── WorkItemDrawer.tsx# Item detail, approvals, audit log & comments
            ├── CreateItemModal.tsx # Request creation & idempotency tester
            ├── ConflictModal.tsx # 409 OCC collision reconciliation modal
            └── OutboxMonitorModal.tsx # Worker queue & DLQ health inspector
```

---

## 🎯 Architecture Discussion Points (For Assessment Review)

During review, the following core architectural choices can be demonstrated:
1. **How the system handles failure**: Network disconnects trigger auto-reconnection via SSE; outbox jobs handle downstream failures through exponential backoff retries and dead-lettering; mutating failures rollback completely without partial state mutations.
2. **What assumptions were made**: Assumed organizations with hundreds of employees benefit most from clear accountability (immutable audit logs, explicit ownership claiming) rather than freeform unassigned queues. Assumed high-stakes actions require segregation of duties.
3. **What would change if the company scaled to 100x**:
   * Migrate SQLite to PostgreSQL with read replicas and PgBouncer connection pooling.
   * Shift the Outbox Worker to a partitioned Kafka/RabbitMQ consumer group for multi-node worker pools.
   * Introduce Elasticsearch or OpenSearch for full-text search across millions of historical requests.
