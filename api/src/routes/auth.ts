import { Router } from 'express';
import bcrypt from 'bcrypt';
import passport from 'passport';
import { z } from 'zod';
import { authLimiter } from '../rate-limit.js';
import { config } from '../config.js';
import { pool, type User } from '../db.js';
import { clearAuthCookies, issueSession, revokeSession, rotateSession } from '../auth/tokens.js';

const credentialsSchema = z.object({
  email: z.string().trim().email().max(320).transform((email) => email.toLowerCase()),
  password: z.string().min(12).max(72)
});
const publicUser = (user: Pick<User, 'id' | 'email' | 'oauth_provider'>) => ({ id: user.id, email: user.email, oauthProvider: user.oauth_provider });

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (request, response, next) => {
  try {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_CREDENTIALS', details: parsed.error.flatten().fieldErrors });
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    const inserted = await pool.query<User>(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, password_hash, oauth_provider, oauth_id`, [parsed.data.email, passwordHash]
    );
    const session = await issueSession(inserted.rows[0], request, response);
    return response.status(201).json({ user: publicUser(inserted.rows[0]), ...session });
  } catch (error: unknown) {
    if ((error as { code?: string }).code === '23505') return response.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED' });
    return next(error);
  }
});

authRouter.post('/login', authLimiter, async (request, response, next) => {
  try {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: 'INVALID_CREDENTIALS' });
    const result = await pool.query<User>(
      'SELECT id, email, password_hash, oauth_provider, oauth_id FROM users WHERE email = $1', [parsed.data.email]
    );
    const user = result.rows[0];
    const valid = user?.password_hash ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
    if (!valid || !user) return response.status(401).json({ error: 'INVALID_EMAIL_OR_PASSWORD' });
    const session = await issueSession(user, request, response);
    return response.json({ user: publicUser(user), ...session });
  } catch (error) { return next(error); }
});

authRouter.get('/google', (request, response, next) => {
  if (!config.googleConfigured) return response.status(503).json({ error: 'GOOGLE_OAUTH_NOT_CONFIGURED' });
  return passport.authenticate('google', { scope: ['openid', 'profile', 'email'], session: false })(request, response, next);
});

authRouter.get('/google/callback', (request, response, next) => {
  if (!config.googleConfigured) return response.status(503).send('Google OAuth is not configured.');
  return passport.authenticate('google', { session: false }, async (error: Error | null, user: User | false | undefined, info?: { message?: string }) => {
    if (error || !user) {
      console.error('Google OAuth callback failed', { message: error?.message ?? info?.message ?? 'No user returned' });
      return response.redirect(`${config.FRONTEND_ORIGIN}/login?error=oauth_failed`);
    }
    try {
      await issueSession(user, request, response);
      return response.redirect(`${config.FRONTEND_ORIGIN}/auth/callback`);
    } catch (issueError) { return next(issueError); }
  })(request, response, next);
});

authRouter.post('/refresh', async (request, response, next) => {
  try {
    const session = await rotateSession(request, response);
    if (!session) return response.status(401).json({ error: 'INVALID_REFRESH_TOKEN' });
    return response.json(session);
  } catch (error) { return next(error); }
});

authRouter.post('/logout', async (request, response, next) => {
  try {
    await revokeSession(request);
    clearAuthCookies(response);
    return response.status(204).end();
  } catch (error) { return next(error); }
});
