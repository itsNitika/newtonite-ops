import { Request, Response, NextFunction } from 'express';
import Database from 'better-sqlite3';
import { UserWithTeams, Role } from '../types.js';

// Extend Express Request
declare global {
  namespace Express {
    interface Request {
      user?: UserWithTeams;
      db: Database.Database;
    }
  }
}

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Support both header and query param for SSE or API calls
  const userId = (req.headers['x-user-id'] as string) || (req.query.user_id as string) || 'usr-alex-lead';

  const userStmt = req.db.prepare('SELECT * FROM users WHERE id = ?');
  const user = userStmt.get(userId) as any;

  if (!user) {
    // If not found, fallback to first user in system
    const fallback = req.db.prepare('SELECT * FROM users LIMIT 1').get() as any;
    if (!fallback) {
      res.status(401).json({ error: 'No users found in system' });
      return;
    }
    attachUser(req, fallback);
    next();
    return;
  }

  attachUser(req, user);
  next();
}

function attachUser(req: Request, user: any): void {
  const membershipsStmt = req.db.prepare(`
    SELECT tm.team_id, tm.role, t.name as team_name
    FROM team_memberships tm
    JOIN teams t ON tm.team_id = t.id
    WHERE tm.user_id = ?
  `);
  const memberships = membershipsStmt.all(user.id) as { team_id: string; role: Role; team_name: string }[];

  const isAdmin = memberships.some(m => m.role === 'ADMIN') || user.email.includes('admin');

  req.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    avatar_url: user.avatar_url,
    created_at: user.created_at,
    teams: memberships,
    is_admin: isAdmin
  };
}

export function requireRole(allowedRoles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (req.user.is_admin) {
      next();
      return;
    }

    const hasRole = req.user.teams.some(t => allowedRoles.includes(t.role));
    if (!hasRole) {
      res.status(403).json({
        error: `Forbidden: requires one of the following roles: ${allowedRoles.join(', ')}`
      });
      return;
    }

    next();
  };
}
