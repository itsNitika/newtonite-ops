import { Router } from 'express';
export function createTeamsRouter() {
    const router = Router();
    // GET /api/teams - List all operational teams with member count
    router.get('/', (req, res) => {
        const sql = `
      SELECT t.*, 
        COUNT(DISTINCT tm.user_id) as member_count,
        (SELECT COUNT(*) FROM work_items w WHERE w.assigned_team_id = t.id AND w.status NOT IN ('RESOLVED', 'CANCELLED')) as active_items_count
      FROM teams t
      LEFT JOIN team_memberships tm ON t.id = tm.team_id
      GROUP BY t.id
      ORDER BY t.name ASC
    `;
        const teams = req.db.prepare(sql).all();
        res.json(teams);
    });
    // GET /api/teams/:id/members - List members and their specific team roles
    router.get('/:id/members', (req, res) => {
        const sql = `
      SELECT u.id, u.name, u.email, u.avatar_url, tm.role
      FROM team_memberships tm
      JOIN users u ON tm.user_id = u.id
      WHERE tm.team_id = ?
      ORDER BY tm.role DESC, u.name ASC
    `;
        const members = req.db.prepare(sql).all(req.params.id);
        res.json(members);
    });
    return router;
}
