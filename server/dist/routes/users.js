import { Router } from 'express';
export function createUsersRouter() {
    const router = Router();
    // GET /api/users - List users with their team memberships (used for role switcher and assignments)
    router.get('/', (req, res) => {
        const usersSql = `SELECT * FROM users ORDER BY name ASC`;
        const users = req.db.prepare(usersSql).all();
        const membershipsSql = `
      SELECT tm.user_id, tm.team_id, tm.role, t.name as team_name
      FROM team_memberships tm
      JOIN teams t ON tm.team_id = t.id
    `;
        const allMemberships = req.db.prepare(membershipsSql).all();
        const enriched = users.map(user => {
            const userTeams = allMemberships.filter(m => m.user_id === user.id);
            return {
                ...user,
                teams: userTeams,
                is_admin: userTeams.some(t => t.role === 'ADMIN') || user.email.includes('admin')
            };
        });
        res.json(enriched);
    });
    // GET /api/users/me - Current active user profile
    router.get('/me', (req, res) => {
        res.json(req.user);
    });
    return router;
}
