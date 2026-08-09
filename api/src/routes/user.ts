import { Router } from 'express';
import { pool } from '../db.js';
import { requireAuth } from '../middleware/authenticate.js';

export const userRouter = Router();
userRouter.get('/me', requireAuth, async (request, response, next) => {
  try {
    const result = await pool.query('SELECT id, email, oauth_provider, balance, created_at FROM users WHERE id = $1', [request.auth!.userId]);
    if (!result.rows[0]) return response.status(404).json({ error: 'USER_NOT_FOUND' });
    return response.json({ user: { ...result.rows[0], oauthProvider: result.rows[0].oauth_provider } });
  } catch (error) { return next(error); }
});
