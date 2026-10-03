import Database from 'better-sqlite3';
import { 
  WorkItem, 
  WorkItemEnriched, 
  WorkItemFilters, 
  PaginatedResult, 
  UserWithTeams, 
  WorkItemStatus, 
  AuditEvent, 
  Comment,
  Priority,
  Category
} from '../types.js';
import { StateMachineEngine } from '../domain/stateMachine.js';
import { RealtimeEventBus } from '../events/eventBus.js';

export class ConflictError extends Error {
  public currentVersion: number;
  public currentItem: WorkItemEnriched;
  constructor(message: string, currentVersion: number, currentItem: WorkItemEnriched) {
    super(message);
    this.name = 'ConflictError';
    this.currentVersion = currentVersion;
    this.currentItem = currentItem;
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

export class WorkItemService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /**
   * Helper to compute SLA due timestamp from priority
   */
  static computeSlaDueDate(priority: Priority, fromDate: Date = new Date()): string {
    const hoursToAdd = {
      P0_CRITICAL: 1,
      P1_HIGH: 4,
      P2_MEDIUM: 24,
      P3_LOW: 72
    }[priority] || 24;

    return new Date(fromDate.getTime() + hoursToAdd * 60 * 60 * 1000).toISOString();
  }

  /**
   * List work items with server-side filtering, sorting and pagination
   */
  listWorkItems(filters: WorkItemFilters = {}): PaginatedResult<WorkItemEnriched> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.search) {
      conditions.push(`(
        w.tracking_num LIKE ? OR
        w.title LIKE ? OR
        w.description LIKE ?
      )`);
      const searchWild = `%${filters.search}%`;
      params.push(searchWild, searchWild, searchWild);
    }

    if (filters.team_id) {
      conditions.push('w.assigned_team_id = ?');
      params.push(filters.team_id);
    }

    if (filters.user_id) {
      conditions.push('w.assigned_user_id = ?');
      params.push(filters.user_id);
    }

    if (filters.status) {
      if (Array.isArray(filters.status)) {
        if (filters.status.length > 0) {
          conditions.push(`w.status IN (${filters.status.map(() => '?').join(',')})`);
          params.push(...filters.status);
        }
      } else {
        conditions.push('w.status = ?');
        params.push(filters.status);
      }
    }

    if (filters.category) {
      conditions.push('w.category = ?');
      params.push(filters.category);
    }

    if (filters.priority) {
      conditions.push('w.priority = ?');
      params.push(filters.priority);
    }

    if (filters.unassigned) {
      conditions.push('w.assigned_user_id IS NULL');
    }

    if (filters.requires_approval) {
      conditions.push('w.requires_approval = 1 AND w.approval_status = ?');
      params.push('PENDING');
    }

    if (filters.sla_breached !== undefined) {
      conditions.push('w.sla_breached = ?');
      params.push(filters.sla_breached ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Count total records
    const countSql = `SELECT COUNT(*) as total FROM work_items w ${whereClause}`;
    const totalCount = (this.db.prepare(countSql).get(...params) as any).total;

    // Sorting
    const sortFieldMap: Record<string, string> = {
      created_at: 'w.created_at',
      updated_at: 'w.updated_at',
      priority: `CASE w.priority 
        WHEN 'P0_CRITICAL' THEN 1 
        WHEN 'P1_HIGH' THEN 2 
        WHEN 'P2_MEDIUM' THEN 3 
        WHEN 'P3_LOW' THEN 4 
        ELSE 5 END`,
      sla_due_at: 'w.sla_due_at',
      tracking_num: 'w.tracking_num'
    };

    const sortBy = sortFieldMap[filters.sort_by || 'created_at'] || 'w.created_at';
    const sortOrder = filters.sort_order === 'asc' ? 'ASC' : 'DESC';

    // Pagination
    const page = Math.max(1, filters.page || 1);
    const limit = Math.min(100, Math.max(1, filters.limit || 20));
    const offset = (page - 1) * limit;

    const querySql = `
      SELECT 
        w.*,
        t.name as assigned_team_name,
        u_assignee.name as assigned_user_name,
        u_creator.name as created_by_user_name,
        u_approver.name as approved_by_user_name,
        (SELECT COUNT(*) FROM comments c WHERE c.work_item_id = w.id) as comment_count
      FROM work_items w
      JOIN teams t ON w.assigned_team_id = t.id
      LEFT JOIN users u_assignee ON w.assigned_user_id = u_assignee.id
      LEFT JOIN users u_creator ON w.created_by_user_id = u_creator.id
      LEFT JOIN users u_approver ON w.approved_by_user_id = u_approver.id
      ${whereClause}
      ORDER BY ${sortBy} ${sortOrder}
      LIMIT ? OFFSET ?
    `;

    const rawItems = this.db.prepare(querySql).all(...params, limit, offset) as any[];

    const enrichedItems: WorkItemEnriched[] = rawItems.map(item => ({
      ...item,
      requires_approval: Boolean(item.requires_approval),
      sla_breached: Boolean(item.sla_breached),
      parsed_metadata: item.metadata_json ? JSON.parse(item.metadata_json) : {}
    }));

    return {
      data: enrichedItems,
      pagination: {
        total: totalCount,
        page,
        limit,
        total_pages: Math.ceil(totalCount / limit) || 1
      }
    };
  }

  /**
   * Get single work item with comments, audit log, and presence
   */
  getWorkItemById(id: string): { 
    item: WorkItemEnriched; 
    auditEvents: AuditEvent[]; 
    comments: Comment[];
    presence: { userId: string; userName: string }[];
  } {
    const itemSql = `
      SELECT 
        w.*,
        t.name as assigned_team_name,
        u_assignee.name as assigned_user_name,
        u_creator.name as created_by_user_name,
        u_approver.name as approved_by_user_name
      FROM work_items w
      JOIN teams t ON w.assigned_team_id = t.id
      LEFT JOIN users u_assignee ON w.assigned_user_id = u_assignee.id
      LEFT JOIN users u_creator ON w.created_by_user_id = u_creator.id
      LEFT JOIN users u_approver ON w.approved_by_user_id = u_approver.id
      WHERE w.id = ? OR w.tracking_num = ?
    `;

    const rawItem = this.db.prepare(itemSql).get(id, id) as any;
    if (!rawItem) {
      throw new NotFoundError(`Work item '${id}' not found`);
    }

    const item: WorkItemEnriched = {
      ...rawItem,
      requires_approval: Boolean(rawItem.requires_approval),
      sla_breached: Boolean(rawItem.sla_breached),
      parsed_metadata: rawItem.metadata_json ? JSON.parse(rawItem.metadata_json) : {}
    };

    const auditSql = `
      SELECT a.*, u.name as actor_name
      FROM audit_events a
      LEFT JOIN users u ON a.actor_user_id = u.id
      WHERE a.work_item_id = ?
      ORDER BY a.created_at DESC
    `;
    const auditEvents = this.db.prepare(auditSql).all(item.id) as AuditEvent[];

    const commentsSql = `
      SELECT c.*, u.name as user_name, u.avatar_url as user_avatar
      FROM comments c
      LEFT JOIN users u ON c.user_id = u.id
      WHERE c.work_item_id = ?
      ORDER BY c.created_at ASC
    `;
    const comments = (this.db.prepare(commentsSql).all(item.id) as any[]).map(c => ({
      ...c,
      is_internal_only: Boolean(c.is_internal_only)
    }));

    const presence = RealtimeEventBus.getPresence(item.id);

    return { item, auditEvents, comments, presence };
  }

  /**
   * Create work item atomically with tracking number, SLA, and outbox event
   */
  createWorkItem(
    data: {
      title: string;
      description: string;
      category: Category;
      priority: Priority;
      assigned_team_id: string;
      assigned_user_id?: string;
      requires_approval?: boolean;
      metadata?: Record<string, any>;
    },
    creator: UserWithTeams
  ): WorkItemEnriched {
    const id = 'wi-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const slaDueAt = WorkItemService.computeSlaDueDate(data.priority);
    const metadataStr = JSON.stringify(data.metadata || {});

    // Compute next tracking number sequentially
    const maxNumRow = this.db.prepare(`
      SELECT tracking_num FROM work_items ORDER BY rowid DESC LIMIT 1
    `).get() as any;
    
    let nextSeq = 1001;
    if (maxNumRow && maxNumRow.tracking_num) {
      const match = maxNumRow.tracking_num.match(/OPS-(\d+)/);
      if (match) nextSeq = parseInt(match[1], 10) + 1;
    }
    const trackingNum = `OPS-${nextSeq}`;

    const requiresApproval = data.requires_approval ? 1 : 0;
    const initialStatus: WorkItemStatus = 'TRIAGE';

    const insertWorkItem = this.db.prepare(`
      INSERT INTO work_items (
        id, tracking_num, title, description, category, priority, status,
        assigned_team_id, assigned_user_id, created_by_user_id,
        requires_approval, approval_status, sla_due_at, sla_breached,
        version, metadata_json, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, 'NONE', ?, 0,
        1, ?, ?, ?
      )
    `);

    const insertAudit = this.db.prepare(`
      INSERT INTO audit_events (
        id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at
      ) VALUES (?, ?, ?, 'CREATED', NULL, ?, 'Work item created', ?)
    `);

    const insertOutbox = this.db.prepare(`
      INSERT INTO outbox_jobs (
        id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at
      ) VALUES (?, 'NOTIFICATION_DISPATCH', ?, 'PENDING', 0, 5, ?, ?, ?)
    `);

    // Execute atomically inside transaction
    const executeTx = this.db.transaction(() => {
      insertWorkItem.run(
        id, trackingNum, data.title, data.description, data.category, data.priority, initialStatus,
        data.assigned_team_id, data.assigned_user_id || null, creator.id,
        requiresApproval, slaDueAt,
        metadataStr, now, now
      );

      const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
      insertAudit.run(
        auditId, id, creator.id,
        JSON.stringify({ status: initialStatus, priority: data.priority }),
        now
      );

      const outboxId = 'out-' + Math.random().toString(36).substring(2, 9);
      const outboxPayload = JSON.stringify({
        workItemId: id,
        trackingNum,
        title: data.title,
        teamId: data.assigned_team_id,
        message: `New operational request created: [${trackingNum}] ${data.title}`
      });
      insertOutbox.run(outboxId, outboxPayload, now, now, now);
    });

    executeTx();

    const created = this.getWorkItemById(id).item;
    RealtimeEventBus.broadcast('WORK_ITEM_CREATED', { item: created });
    return created;
  }

  /**
   * Claim responsibility for a work item using Optimistic Concurrency Control (OCC)
   */
  claimWorkItem(id: string, actor: UserWithTeams, expectedVersion: number): WorkItemEnriched {
    const current = this.getWorkItemById(id).item;

    const claimCheck = StateMachineEngine.canClaim(current, actor);
    if (!claimCheck.allowed) {
      throw new ForbiddenError(claimCheck.reason || 'Not authorized to claim this item');
    }

    const now = new Date().toISOString();
    // Auto-advance TRIAGE or READY to IN_PROGRESS on claim
    const newStatus: WorkItemStatus = (current.status === 'TRIAGE' || current.status === 'READY') 
      ? 'IN_PROGRESS' 
      : current.status;

    // Atomic OCC Update
    const updateStmt = this.db.prepare(`
      UPDATE work_items
      SET assigned_user_id = ?,
          status = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(actor.id, newStatus, now, current.id, expectedVersion);

    if (result.changes === 0) {
      // Version mismatch: someone else changed the item concurrently!
      const fresh = this.getWorkItemById(id).item;
      throw new ConflictError(
        `Conflict detected: This work item has already been updated to version ${fresh.version} by another user.`,
        fresh.version,
        fresh
      );
    }

    // Write audit event
    const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO audit_events (
        id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at
      ) VALUES (?, ?, ?, 'ASSIGNED', ?, ?, ?, ?)
    `).run(
      auditId, current.id, actor.id,
      JSON.stringify({ assigned_user_id: current.assigned_user_id, status: current.status }),
      JSON.stringify({ assigned_user_id: actor.id, status: newStatus }),
      `Claimed ownership of ${current.tracking_num}`,
      now
    );

    const updated = this.getWorkItemById(id).item;
    RealtimeEventBus.broadcast('WORK_ITEM_UPDATED', { item: updated, actorId: actor.id });
    return updated;
  }

  /**
   * Transition work item status with validation and OCC
   */
  transitionStatus(
    id: string,
    targetStatus: WorkItemStatus,
    actor: UserWithTeams,
    expectedVersion: number,
    params?: {
      resolution_summary?: string;
      root_cause_category?: string;
      comment?: string;
    }
  ): WorkItemEnriched {
    const current = this.getWorkItemById(id).item;

    const transitionCheck = StateMachineEngine.canTransition(current, targetStatus, actor, params);
    if (!transitionCheck.allowed) {
      throw new ValidationError(transitionCheck.reason || 'Invalid state transition');
    }

    const now = new Date().toISOString();
    const resolutionSummary = targetStatus === 'RESOLVED' 
      ? (params?.resolution_summary || current.resolution_summary) 
      : current.resolution_summary;

    const rootCause = targetStatus === 'RESOLVED'
      ? (params?.root_cause_category || current.root_cause_category)
      : current.root_cause_category;

    // If moving to PENDING_APPROVAL, mark approval_status = PENDING
    const approvalStatus = targetStatus === 'PENDING_APPROVAL' 
      ? 'PENDING' 
      : current.approval_status;

    const approvalRequestedAt = targetStatus === 'PENDING_APPROVAL'
      ? now
      : current.approval_requested_at;

    // Atomic OCC Update
    const updateStmt = this.db.prepare(`
      UPDATE work_items
      SET status = ?,
          resolution_summary = ?,
          root_cause_category = ?,
          approval_status = ?,
          approval_requested_at = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(
      targetStatus,
      resolutionSummary,
      rootCause,
      approvalStatus,
      approvalRequestedAt,
      now,
      current.id,
      expectedVersion
    );

    if (result.changes === 0) {
      const fresh = this.getWorkItemById(id).item;
      throw new ConflictError(
        `Conflict detected: This work item has already been updated to version ${fresh.version} by another user.`,
        fresh.version,
        fresh
      );
    }

    // Insert Audit Event
    const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO audit_events (
        id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at
      ) VALUES (?, ?, ?, 'STATUS_CHANGED', ?, ?, ?, ?)
    `).run(
      auditId, current.id, actor.id,
      JSON.stringify({ status: current.status }),
      JSON.stringify({ status: targetStatus }),
      params?.comment || `Status changed from ${current.status} to ${targetStatus}`,
      now
    );

    // If resolving, trigger outbox job
    if (targetStatus === 'RESOLVED') {
      const outboxId = 'out-' + Math.random().toString(36).substring(2, 9);
      this.db.prepare(`
        INSERT INTO outbox_jobs (
          id, event_type, payload, status, attempts, max_attempts, next_retry_at, created_at, updated_at
        ) VALUES (?, 'NOTIFICATION_DISPATCH', ?, 'PENDING', 0, 5, ?, ?, ?)
      `).run(
        outboxId,
        JSON.stringify({
          workItemId: current.id,
          message: `Work item ${current.tracking_num} has been resolved.`
        }),
        now, now, now
      );
    }

    const updated = this.getWorkItemById(id).item;
    RealtimeEventBus.broadcast('WORK_ITEM_UPDATED', { item: updated, actorId: actor.id });
    return updated;
  }

  /**
   * Process formal approval or rejection on a work item with OCC
   */
  approveWorkItem(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string,
    actor: UserWithTeams,
    expectedVersion: number
  ): WorkItemEnriched {
    const current = this.getWorkItemById(id).item;

    const approvalCheck = StateMachineEngine.canApprove(current, actor);
    if (!approvalCheck.allowed) {
      throw new ForbiddenError(approvalCheck.reason || 'Not authorized to approve this work item');
    }

    const now = new Date().toISOString();
    // If approved, item is unlocked to proceed to IN_PROGRESS or directly RESOLVED
    const newStatus: WorkItemStatus = decision === 'APPROVED' ? 'IN_PROGRESS' : 'READY';

    const updateStmt = this.db.prepare(`
      UPDATE work_items
      SET approval_status = ?,
          approved_by_user_id = ?,
          approval_note = ?,
          status = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(
      decision,
      actor.id,
      note,
      newStatus,
      now,
      current.id,
      expectedVersion
    );

    if (result.changes === 0) {
      const fresh = this.getWorkItemById(id).item;
      throw new ConflictError(
        `Conflict detected: Item has been modified by another user (current version: ${fresh.version}).`,
        fresh.version,
        fresh
      );
    }

    // Write audit event
    const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO audit_events (
        id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      auditId, current.id, actor.id,
      decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
      JSON.stringify({ approval_status: current.approval_status }),
      JSON.stringify({ approval_status: decision, status: newStatus }),
      note ? `Approval decision: ${decision}. Note: ${note}` : `Approval decision: ${decision}`,
      now
    );

    const updated = this.getWorkItemById(id).item;
    RealtimeEventBus.broadcast('WORK_ITEM_UPDATED', { item: updated, actorId: actor.id });
    return updated;
  }

  /**
   * Update work item details (priority, title, description, metadata) with OCC
   */
  updateDetails(
    id: string,
    updates: {
      title?: string;
      description?: string;
      priority?: Priority;
      category?: Category;
      assigned_team_id?: string;
      assigned_user_id?: string | null;
      requires_approval?: boolean;
      metadata?: Record<string, any>;
    },
    actor: UserWithTeams,
    expectedVersion: number
  ): WorkItemEnriched {
    const current = this.getWorkItemById(id).item;
    const now = new Date().toISOString();

    const title = updates.title ?? current.title;
    const description = updates.description ?? current.description;
    const priority = updates.priority ?? current.priority;
    const category = updates.category ?? current.category;
    const assignedTeamId = updates.assigned_team_id ?? current.assigned_team_id;
    const assignedUserId = updates.assigned_user_id !== undefined ? updates.assigned_user_id : current.assigned_user_id;
    const requiresApproval = updates.requires_approval !== undefined 
      ? (updates.requires_approval ? 1 : 0) 
      : (current.requires_approval ? 1 : 0);

    const metadataStr = updates.metadata ? JSON.stringify(updates.metadata) : current.metadata_json;

    // If priority changed, adjust SLA due date proportionally
    const slaDueAt = updates.priority && updates.priority !== current.priority
      ? WorkItemService.computeSlaDueDate(updates.priority)
      : current.sla_due_at;

    const updateStmt = this.db.prepare(`
      UPDATE work_items
      SET title = ?,
          description = ?,
          priority = ?,
          category = ?,
          assigned_team_id = ?,
          assigned_user_id = ?,
          requires_approval = ?,
          metadata_json = ?,
          sla_due_at = ?,
          version = version + 1,
          updated_at = ?
      WHERE id = ? AND version = ?
    `);

    const result = updateStmt.run(
      title,
      description,
      priority,
      category,
      assignedTeamId,
      assignedUserId,
      requiresApproval,
      metadataStr,
      slaDueAt,
      now,
      current.id,
      expectedVersion
    );

    if (result.changes === 0) {
      const fresh = this.getWorkItemById(id).item;
      throw new ConflictError(
        `Conflict detected: Item has been modified by another user (current version: ${fresh.version}).`,
        fresh.version,
        fresh
      );
    }

    // Write audit event
    const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO audit_events (
        id, work_item_id, actor_user_id, event_type, previous_state, new_state, comment, created_at
      ) VALUES (?, ?, ?, 'DETAILS_UPDATED', ?, ?, 'Work item details updated', ?)
    `).run(
      auditId, current.id, actor.id,
      JSON.stringify({ title: current.title, priority: current.priority, assigned_user_id: current.assigned_user_id }),
      JSON.stringify({ title, priority, assigned_user_id: assignedUserId }),
      now
    );

    const updated = this.getWorkItemById(id).item;
    RealtimeEventBus.broadcast('WORK_ITEM_UPDATED', { item: updated, actorId: actor.id });
    return updated;
  }

  /**
   * Add comment to work item
   */
  addComment(
    id: string,
    content: string,
    isInternal: boolean,
    actor: UserWithTeams
  ): Comment {
    if (!content || content.trim().length === 0) {
      throw new ValidationError('Comment cannot be empty');
    }

    const current = this.getWorkItemById(id).item;
    const commentId = 'com-' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO comments (id, work_item_id, user_id, content, is_internal_only, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(commentId, current.id, actor.id, content.trim(), isInternal ? 1 : 0, now);

    // Audit event
    const auditId = 'aud-' + Math.random().toString(36).substring(2, 9);
    this.db.prepare(`
      INSERT INTO audit_events (id, work_item_id, actor_user_id, event_type, comment, created_at)
      VALUES (?, ?, ?, 'COMMENT_ADDED', ?, ?)
    `).run(auditId, current.id, actor.id, `Added a comment: "${content.substring(0, 50)}..."`, now);

    const newComment: Comment = {
      id: commentId,
      work_item_id: current.id,
      user_id: actor.id,
      user_name: actor.name,
      user_avatar: actor.avatar_url,
      content: content.trim(),
      is_internal_only: isInternal,
      created_at: now
    };

    RealtimeEventBus.broadcast('COMMENT_ADDED', { workItemId: current.id, comment: newComment });
    return newComment;
  }
}
