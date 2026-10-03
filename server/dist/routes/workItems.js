import { Router } from 'express';
import { z } from 'zod';
import { WorkItemService, ConflictError, ValidationError, ForbiddenError, NotFoundError } from '../services/workItemService.js';
import { RealtimeEventBus } from '../events/eventBus.js';
export function createWorkItemsRouter() {
    const router = Router();
    // GET /api/work-items - Paginated, filtered list
    router.get('/', (req, res) => {
        const service = new WorkItemService(req.db);
        const filters = {
            search: req.query.search,
            team_id: req.query.team_id,
            user_id: req.query.user_id,
            category: req.query.category,
            priority: req.query.priority,
            unassigned: req.query.unassigned === 'true',
            requires_approval: req.query.requires_approval === 'true',
            sla_breached: req.query.sla_breached === 'true' ? true : req.query.sla_breached === 'false' ? false : undefined,
            page: req.query.page ? parseInt(req.query.page, 10) : 1,
            limit: req.query.limit ? parseInt(req.query.limit, 10) : 20,
            sort_by: req.query.sort_by,
            sort_order: req.query.sort_order,
            status: req.query.status ? (Array.isArray(req.query.status) ? req.query.status : [req.query.status]) : undefined
        };
        const result = service.listWorkItems(filters);
        res.json(result);
    });
    // GET /api/work-items/:id - Details, audit trail, comments, presence
    router.get('/:id', (req, res, next) => {
        try {
            const service = new WorkItemService(req.db);
            const data = service.getWorkItemById(req.params.id);
            res.json(data);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items - Create work item
    const createSchema = z.object({
        title: z.string().min(3),
        description: z.string().min(5),
        category: z.enum(['ENGINEERING', 'PAYMENTS', 'INCIDENT', 'COMPLIANCE', 'CUSTOMER_OPS', 'GENERAL']),
        priority: z.enum(['P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW']),
        assigned_team_id: z.string(),
        assigned_user_id: z.string().optional(),
        requires_approval: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });
    router.post('/', (req, res, next) => {
        try {
            const parsed = createSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const created = service.createWorkItem(parsed, req.user);
            res.status(201).json(created);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items/:id/claim - Claim responsibility with OCC
    const claimSchema = z.object({
        expected_version: z.number().int().positive()
    });
    router.post('/:id/claim', (req, res, next) => {
        try {
            const parsed = claimSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const updated = service.claimWorkItem(req.params.id, req.user, parsed.expected_version);
            res.json(updated);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items/:id/transition - Transition status with state machine & OCC
    const transitionSchema = z.object({
        target_status: z.enum(['TRIAGE', 'READY', 'IN_PROGRESS', 'PENDING_APPROVAL', 'RESOLVED', 'CANCELLED']),
        expected_version: z.number().int().positive(),
        resolution_summary: z.string().optional(),
        root_cause_category: z.string().optional(),
        comment: z.string().optional()
    });
    router.post('/:id/transition', (req, res, next) => {
        try {
            const parsed = transitionSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const updated = service.transitionStatus(req.params.id, parsed.target_status, req.user, parsed.expected_version, {
                resolution_summary: parsed.resolution_summary,
                root_cause_category: parsed.root_cause_category,
                comment: parsed.comment
            });
            res.json(updated);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items/:id/approve - Approve or reject with OCC
    const approveSchema = z.object({
        decision: z.enum(['APPROVED', 'REJECTED']),
        note: z.string().default(''),
        expected_version: z.number().int().positive()
    });
    router.post('/:id/approve', (req, res, next) => {
        try {
            const parsed = approveSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const updated = service.approveWorkItem(req.params.id, parsed.decision, parsed.note, req.user, parsed.expected_version);
            res.json(updated);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // PATCH /api/work-items/:id - Edit details with OCC
    const editSchema = z.object({
        expected_version: z.number().int().positive(),
        title: z.string().min(3).optional(),
        description: z.string().min(5).optional(),
        priority: z.enum(['P0_CRITICAL', 'P1_HIGH', 'P2_MEDIUM', 'P3_LOW']).optional(),
        category: z.enum(['ENGINEERING', 'PAYMENTS', 'INCIDENT', 'COMPLIANCE', 'CUSTOMER_OPS', 'GENERAL']).optional(),
        assigned_team_id: z.string().optional(),
        assigned_user_id: z.string().nullable().optional(),
        requires_approval: z.boolean().optional(),
        metadata: z.record(z.any()).optional()
    });
    router.patch('/:id', (req, res, next) => {
        try {
            const parsed = editSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const updated = service.updateDetails(req.params.id, parsed, req.user, parsed.expected_version);
            res.json(updated);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items/:id/comments - Add discussion comment
    const commentSchema = z.object({
        content: z.string().min(1),
        is_internal_only: z.boolean().optional().default(false)
    });
    router.post('/:id/comments', (req, res, next) => {
        try {
            const parsed = commentSchema.parse(req.body);
            const service = new WorkItemService(req.db);
            const comment = service.addComment(req.params.id, parsed.content, parsed.is_internal_only, req.user);
            res.status(201).json(comment);
        }
        catch (err) {
            handleErrors(err, res, next);
        }
    });
    // POST /api/work-items/:id/presence - Heartbeat from active viewer
    router.post('/:id/presence', (req, res) => {
        const workItemId = req.params.id;
        const user = req.user;
        RealtimeEventBus.recordPresence(workItemId, user.id, user.name);
        res.json({ ok: true, active_viewers: RealtimeEventBus.getPresence(workItemId) });
    });
    return router;
}
function handleErrors(err, res, next) {
    if (err instanceof ConflictError) {
        res.status(409).json({
            error: 'Conflict detected',
            message: err.message,
            current_version: err.currentVersion,
            current_item: err.currentItem
        });
        return;
    }
    if (err instanceof ValidationError || err instanceof z.ZodError) {
        res.status(400).json({
            error: 'Validation error',
            message: err.message
        });
        return;
    }
    if (err instanceof ForbiddenError) {
        res.status(403).json({
            error: 'Forbidden',
            message: err.message
        });
        return;
    }
    if (err instanceof NotFoundError) {
        res.status(404).json({
            error: 'Not found',
            message: err.message
        });
        return;
    }
    next(err);
}
