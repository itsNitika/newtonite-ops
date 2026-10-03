import { Response } from 'express';

export interface SSEClient {
  id: string;
  userId: string;
  res: Response;
  activeWorkItemId?: string;
}

export class RealtimeEventBus {
  private static clients: Map<string, SSEClient> = new Map();
  private static presenceMap: Map<string, Set<{ userId: string; userName: string; timestamp: number }>> = new Map();

  static registerClient(client: SSEClient): void {
    this.clients.set(client.id, client);

    // Initial connection comment
    client.res.write(`data: ${JSON.stringify({ type: 'CONNECTED', clientId: client.id })}\n\n`);

    // Periodic heartbeat to prevent connection dropouts
    const timer = setInterval(() => {
      if (!this.clients.has(client.id)) {
        clearInterval(timer);
        return;
      }
      try {
        client.res.write(': keep-alive\n\n');
      } catch {
        clearInterval(timer);
        this.removeClient(client.id);
      }
    }, 15000);
  }

  static removeClient(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client && client.activeWorkItemId) {
      this.clearPresence(client.activeWorkItemId, client.userId);
    }
    this.clients.delete(clientId);
  }

  static broadcast(eventType: string, data: any): void {
    const payload = `data: ${JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() })}\n\n`;
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.res.write(payload);
      } catch (err) {
        this.clients.delete(clientId);
      }
    }
  }

  /**
   * Register that a user is actively viewing/editing a specific work item
   */
  static recordPresence(workItemId: string, userId: string, userName: string): void {
    if (!this.presenceMap.has(workItemId)) {
      this.presenceMap.set(workItemId, new Set());
    }
    const viewers = this.presenceMap.get(workItemId)!;
    
    // Remove existing entry for this user
    for (const v of viewers) {
      if (v.userId === userId) {
        viewers.delete(v);
      }
    }

    viewers.add({ userId, userName, timestamp: Date.now() });

    // Clean expired presence (> 30s)
    const now = Date.now();
    for (const v of viewers) {
      if (now - v.timestamp > 30000) {
        viewers.delete(v);
      }
    }

    this.broadcast('PRESENCE_UPDATED', {
      workItemId,
      viewers: Array.from(viewers).map(v => ({ userId: v.userId, userName: v.userName }))
    });
  }

  static clearPresence(workItemId: string, userId: string): void {
    const viewers = this.presenceMap.get(workItemId);
    if (!viewers) return;

    for (const v of viewers) {
      if (v.userId === userId) {
        viewers.delete(v);
      }
    }

    this.broadcast('PRESENCE_UPDATED', {
      workItemId,
      viewers: Array.from(viewers).map(v => ({ userId: v.userId, userName: v.userName }))
    });
  }

  static getPresence(workItemId: string): { userId: string; userName: string }[] {
    const viewers = this.presenceMap.get(workItemId);
    if (!viewers) return [];
    
    const now = Date.now();
    const active = [];
    for (const v of viewers) {
      if (now - v.timestamp <= 30000) {
        active.push({ userId: v.userId, userName: v.userName });
      }
    }
    return active;
  }
}
