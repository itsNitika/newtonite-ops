import { WorkItem, WorkItemStatus, UserWithTeams, Role } from '../types.js';

export interface StateTransitionResult {
  allowed: boolean;
  reason?: string;
  nextStatus?: WorkItemStatus;
}

// Valid status transitions map
const VALID_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  TRIAGE: ['READY', 'CANCELLED'],
  READY: ['IN_PROGRESS', 'TRIAGE', 'CANCELLED'],
  IN_PROGRESS: ['PENDING_APPROVAL', 'RESOLVED', 'READY', 'CANCELLED'],
  PENDING_APPROVAL: ['IN_PROGRESS', 'RESOLVED', 'CANCELLED'],
  RESOLVED: ['READY', 'CANCELLED'],
  CANCELLED: ['TRIAGE']
};

export class StateMachineEngine {
  /**
   * Validate if a status transition is permitted given current item state, user roles, and parameters
   */
  static canTransition(
    item: WorkItem,
    targetStatus: WorkItemStatus,
    actor: UserWithTeams,
    params?: {
      resolution_summary?: string;
      root_cause_category?: string;
    }
  ): StateTransitionResult {
    // 1. Transition graph check
    const allowedTargets = VALID_TRANSITIONS[item.status] || [];
    if (!allowedTargets.includes(targetStatus)) {
      return {
        allowed: false,
        reason: `Cannot transition work item from '${item.status}' to '${targetStatus}'. Allowed: ${allowedTargets.join(', ')}`
      };
    }

    // 2. Approval Gate Check: If item requires approval, cannot jump directly to RESOLVED without approval
    if (targetStatus === 'RESOLVED' && item.requires_approval) {
      if (item.status !== 'PENDING_APPROVAL' && item.approval_status !== 'APPROVED') {
        return {
          allowed: false,
          reason: `This work item requires formal approval before it can be resolved. Please transition to PENDING_APPROVAL first.`
        };
      }
      if (item.approval_status !== 'APPROVED') {
        return {
          allowed: false,
          reason: `Work item is pending approval. An authorized approver must approve it before resolution.`
        };
      }
    }

    // 3. Resolution completeness check
    if (targetStatus === 'RESOLVED') {
      const summary = params?.resolution_summary || item.resolution_summary;
      if (!summary || summary.trim().length < 5) {
        return {
          allowed: false,
          reason: `Resolution requires a detailed resolution summary (minimum 5 characters).`
        };
      }
    }

    // 4. Role and Team authorization check
    const isTeamMember = actor.teams.some(t => t.team_id === item.assigned_team_id);
    const isLeadOrAdmin = actor.is_admin || actor.teams.some(t => t.team_id === item.assigned_team_id && t.role === 'LEAD');

    // Only team members, leads or admins can transition work items
    if (!actor.is_admin && !isTeamMember) {
      return {
        allowed: false,
        reason: `User is not a member of the assigned team (${item.assigned_team_id}). Permission denied.`
      };
    }

    // Reopening resolved or cancelled items requires LEAD or ADMIN privileges
    if ((item.status === 'RESOLVED' || item.status === 'CANCELLED') && !isLeadOrAdmin) {
      return {
        allowed: false,
        reason: `Reopening resolved or cancelled items requires Team Lead or Admin authorization.`
      };
    }

    return { allowed: true, nextStatus: targetStatus };
  }

  /**
   * Validate if an actor can approve/reject an item in PENDING_APPROVAL
   */
  static canApprove(
    item: WorkItem,
    actor: UserWithTeams
  ): { allowed: boolean; reason?: string } {
    if (item.status !== 'PENDING_APPROVAL') {
      return {
        allowed: false,
        reason: `Item is currently in '${item.status}' state, not awaiting approval.`
      };
    }

    // Check if actor has APPROVER, LEAD, or ADMIN role for the assigned team
    const teamRole = actor.teams.find(t => t.team_id === item.assigned_team_id)?.role;
    const hasApproverAuthority = actor.is_admin || teamRole === 'APPROVER' || teamRole === 'LEAD';

    if (!hasApproverAuthority) {
      return {
        allowed: false,
        reason: `Actor lacks approval authority. Requires APPROVER, LEAD, or ADMIN role.`
      };
    }

    // Segregation of Duties: Approver cannot be the same user who created or claimed the item
    // (unless global ADMIN is explicitly overriding)
    if (!actor.is_admin) {
      if (item.created_by_user_id === actor.id) {
        return {
          allowed: false,
          reason: `Segregation of duties violation: The creator of a work item cannot approve their own item.`
        };
      }
      if (item.assigned_user_id === actor.id) {
        return {
          allowed: false,
          reason: `Segregation of duties violation: The assigned owner of a work item cannot approve their own work.`
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Validate if an actor can claim or take ownership of an item
   */
  static canClaim(
    item: WorkItem,
    actor: UserWithTeams
  ): { allowed: boolean; reason?: string } {
    const isTeamMember = actor.teams.some(t => t.team_id === item.assigned_team_id);
    const isLeadOrAdmin = actor.is_admin || actor.teams.some(t => t.team_id === item.assigned_team_id && t.role === 'LEAD');

    if (!actor.is_admin && !isTeamMember) {
      return {
        allowed: false,
        reason: `Cannot claim an item assigned to another team. You must belong to the item's team.`
      };
    }

    // If already assigned to another user, normal members cannot snatch it without lead intervention
    if (item.assigned_user_id && item.assigned_user_id !== actor.id && !isLeadOrAdmin) {
      return {
        allowed: false,
        reason: `Item is already claimed by another user. Only a Team Lead or Admin can reassign it.`
      };
    }

    return { allowed: true };
  }
}
