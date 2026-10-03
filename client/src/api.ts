import { 
  WorkItem, 
  UserWithTeams, 
  Team, 
  PaginatedResult, 
  AuditEvent, 
  Comment,
  OutboxJob,
  OutboxStats,
  WorkItemStatus,
  Priority,
  Category
} from './types';

export class ApiError extends Error {
  public status: number;
  public data: any;
  constructor(message: string, status: number, data?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

let activeUserId: string = 'usr-alex-lead';

export function setActiveUser(userId: string): void {
  activeUserId = userId;
  localStorage.setItem('newtonite_user_id', userId);
}

export function getActiveUser(): string {
  const stored = localStorage.getItem('newtonite_user_id');
  return stored || activeUserId;
}

function generateIdempotencyKey(): string {
  return 'idem-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now();
}

async function request<T>(
  url: string, 
  options: RequestInit & { idempotencyKey?: string } = {}
): Promise<{ data: T; isIdempotentReplay: boolean }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-user-id': getActiveUser(),
    ...(options.headers as Record<string, string> || {})
  };

  // Add Idempotency-Key on mutating methods if not present
  if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(options.method?.toUpperCase() || '')) {
    if (!headers['idempotency-key']) {
      headers['idempotency-key'] = options.idempotencyKey || generateIdempotencyKey();
    }
  }

  const res = await fetch(url, {
    ...options,
    headers
  });

  const isIdempotentReplay = res.headers.get('x-idempotent-replay') === 'true';

  let body: any;
  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    body = await res.json();
  } else {
    body = await res.text();
  }

  if (!res.ok) {
    throw new ApiError(
      body?.message || body?.error || `Request failed with status ${res.status}`,
      res.status,
      body
    );
  }

  return { data: body as T, isIdempotentReplay };
}

export const api = {
  // Users & Teams
  async getUsers(): Promise<UserWithTeams[]> {
    const { data } = await request<UserWithTeams[]>('/api/users');
    return data;
  },

  async getCurrentUser(): Promise<UserWithTeams> {
    const { data } = await request<UserWithTeams>('/api/users/me');
    return data;
  },

  async getTeams(): Promise<Team[]> {
    const { data } = await request<Team[]>('/api/teams');
    return data;
  },

  // Work Items
  async getWorkItems(params: Record<string, any> = {}): Promise<PaginatedResult<WorkItem>> {
    const query = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') {
        if (Array.isArray(v)) {
          v.forEach(val => query.append(k, val));
        } else {
          query.set(k, String(v));
        }
      }
    }
    const { data } = await request<PaginatedResult<WorkItem>>(`/api/work-items?${query.toString()}`);
    return data;
  },

  async getWorkItemById(id: string): Promise<{ 
    item: WorkItem; 
    auditEvents: AuditEvent[]; 
    comments: Comment[];
    presence: { userId: string; userName: string }[];
  }> {
    const { data } = await request<{
      item: WorkItem; 
      auditEvents: AuditEvent[]; 
      comments: Comment[];
      presence: { userId: string; userName: string }[];
    }>(`/api/work-items/${id}`);
    return data;
  },

  async createWorkItem(
    payload: {
      title: string;
      description: string;
      category: Category;
      priority: Priority;
      assigned_team_id: string;
      assigned_user_id?: string;
      requires_approval?: boolean;
      metadata?: Record<string, any>;
    },
    customIdempotencyKey?: string
  ): Promise<{ item: WorkItem; isIdempotentReplay: boolean }> {
    const { data, isIdempotentReplay } = await request<WorkItem>('/api/work-items', {
      method: 'POST',
      body: JSON.stringify(payload),
      idempotencyKey: customIdempotencyKey
    });
    return { item: data, isIdempotentReplay };
  },

  async claimWorkItem(
    id: string, 
    expectedVersion: number,
    customIdempotencyKey?: string
  ): Promise<{ item: WorkItem; isIdempotentReplay: boolean }> {
    const { data, isIdempotentReplay } = await request<WorkItem>(`/api/work-items/${id}/claim`, {
      method: 'POST',
      body: JSON.stringify({ expected_version: expectedVersion }),
      idempotencyKey: customIdempotencyKey
    });
    return { item: data, isIdempotentReplay };
  },

  async transitionStatus(
    id: string,
    targetStatus: WorkItemStatus,
    expectedVersion: number,
    params?: {
      resolution_summary?: string;
      root_cause_category?: string;
      comment?: string;
    },
    customIdempotencyKey?: string
  ): Promise<{ item: WorkItem; isIdempotentReplay: boolean }> {
    const { data, isIdempotentReplay } = await request<WorkItem>(`/api/work-items/${id}/transition`, {
      method: 'POST',
      body: JSON.stringify({
        target_status: targetStatus,
        expected_version: expectedVersion,
        ...params
      }),
      idempotencyKey: customIdempotencyKey
    });
    return { item: data, isIdempotentReplay };
  },

  async approveWorkItem(
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    note: string,
    expectedVersion: number,
    customIdempotencyKey?: string
  ): Promise<{ item: WorkItem; isIdempotentReplay: boolean }> {
    const { data, isIdempotentReplay } = await request<WorkItem>(`/api/work-items/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({
        decision,
        note,
        expected_version: expectedVersion
      }),
      idempotencyKey: customIdempotencyKey
    });
    return { item: data, isIdempotentReplay };
  },

  async updateWorkItem(
    id: string,
    updates: Partial<WorkItem>,
    expectedVersion: number
  ): Promise<WorkItem> {
    const { data } = await request<WorkItem>(`/api/work-items/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ...updates,
        expected_version: expectedVersion
      })
    });
    return data;
  },

  async addComment(id: string, content: string, isInternal: boolean = false): Promise<Comment> {
    const { data } = await request<Comment>(`/api/work-items/${id}/comments`, {
      method: 'POST',
      body: JSON.stringify({ content, is_internal_only: isInternal })
    });
    return data;
  },

  async sendPresence(id: string): Promise<{ ok: boolean; active_viewers: { userId: string; userName: string }[] }> {
    const { data } = await request<{ ok: boolean; active_viewers: { userId: string; userName: string }[] }>(`/api/work-items/${id}/presence`, {
      method: 'POST'
    });
    return data;
  },

  // Outbox & Monitoring
  async getOutboxJobs(status?: string): Promise<{ jobs: OutboxJob[]; stats: OutboxStats }> {
    const query = status ? `?status=${status}` : '';
    const { data } = await request<{ jobs: OutboxJob[]; stats: OutboxStats }>(`/api/outbox/jobs${query}`);
    return data;
  },

  async retryOutboxJob(id: string): Promise<void> {
    await request(`/api/outbox/jobs/${id}/retry`, { method: 'POST' });
  },

  async triggerSlaCheck(): Promise<{ ok: boolean; breached_detected: number }> {
    const { data } = await request<{ ok: boolean; breached_detected: number }>('/api/outbox/trigger-sla-check', { method: 'POST' });
    return data;
  }
};
