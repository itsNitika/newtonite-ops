export type Role = 'ADMIN' | 'LEAD' | 'MEMBER' | 'APPROVER' | 'AUDITOR';

export type Category = 
  | 'ENGINEERING' 
  | 'PAYMENTS' 
  | 'INCIDENT' 
  | 'COMPLIANCE' 
  | 'CUSTOMER_OPS' 
  | 'GENERAL';

export type Priority = 'P0_CRITICAL' | 'P1_HIGH' | 'P2_MEDIUM' | 'P3_LOW';

export type WorkItemStatus = 
  | 'TRIAGE' 
  | 'READY' 
  | 'IN_PROGRESS' 
  | 'PENDING_APPROVAL' 
  | 'RESOLVED' 
  | 'CANCELLED';

export type ApprovalStatus = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface User {
  id: string;
  name: string;
  email: string;
  avatar_url?: string;
  created_at: string;
}

export interface UserWithTeams extends User {
  teams: {
    team_id: string;
    team_name: string;
    role: Role;
  }[];
  is_admin: boolean;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string;
  member_count?: number;
  active_items_count?: number;
}

export interface WorkItem {
  id: string;
  tracking_num: string;
  title: string;
  description: string;
  category: Category;
  priority: Priority;
  status: WorkItemStatus;
  assigned_team_id: string;
  assigned_team_name?: string;
  assigned_user_id: string | null;
  assigned_user_name?: string;
  created_by_user_id: string;
  created_by_user_name?: string;
  requires_approval: boolean;
  approval_status: ApprovalStatus;
  approval_requested_at: string | null;
  approved_by_user_id: string | null;
  approved_by_user_name?: string;
  approval_note: string | null;
  resolution_summary: string | null;
  root_cause_category: string | null;
  sla_due_at: string;
  sla_breached: boolean;
  version: number;
  metadata_json: string;
  parsed_metadata?: Record<string, any>;
  comment_count?: number;
  created_at: string;
  updated_at: string;
}

export interface AuditEvent {
  id: string;
  work_item_id: string;
  actor_user_id: string;
  actor_name?: string;
  event_type: string;
  previous_state: string | null;
  new_state: string | null;
  comment: string | null;
  created_at: string;
}

export interface Comment {
  id: string;
  work_item_id: string;
  user_id: string;
  user_name?: string;
  user_avatar?: string;
  content: string;
  is_internal_only: boolean;
  created_at: string;
}

export interface OutboxJob {
  id: string;
  event_type: string;
  payload: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'DEAD_LETTER';
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  next_retry_at: string;
  created_at: string;
  updated_at: string;
}

export interface OutboxStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  dead_letter: number;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    total_pages: number;
  };
}
