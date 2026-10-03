export function authMiddleware(req, res, next) {
    // Support both header and query param for SSE or API calls
    const userId = req.headers['x-user-id'] || req.query.user_id || 'usr-alex-lead';
    const userStmt = req.db.prepare('SELECT * FROM users WHERE id = ?');
    const user = userStmt.get(userId);
    if (!user) {
        // If not found, fallback to first user in system
        const fallback = req.db.prepare('SELECT * FROM users LIMIT 1').get();
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
function attachUser(req, user) {
    const membershipsStmt = req.db.prepare(`
    SELECT tm.team_id, tm.role, t.name as team_name
    FROM team_memberships tm
    JOIN teams t ON tm.team_id = t.id
    WHERE tm.user_id = ?
  `);
    const memberships = membershipsStmt.all(user.id);
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
export function requireRole(allowedRoles) {
    return (req, res, next) => {
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
