// Controller: User
// Purpose: small helpers for user-facing endpoints. Keep controllers
// focused on shaping responses and delegating DB access to `pool`.
import { pool } from '../db.js';
export async function getCurrentUser(request, response, next) {
    try {
        // Retrieve minimal user fields to avoid exposing secrets.
        const result = await pool.query('SELECT id, email, oauth_provider, balance, created_at FROM users WHERE id = $1', [request.auth.userId]);
        if (!result.rows[0])
            return response.status(404).json({ error: 'USER_NOT_FOUND' });
        return response.json({ user: { ...result.rows[0], oauthProvider: result.rows[0].oauth_provider } });
    }
    catch (error) {
        return next(error);
    }
}
