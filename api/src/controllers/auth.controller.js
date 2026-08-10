/*
    Authentication controllers

    Responsibilities:
    - Validate incoming credentials and delegate credential checks to
        bcrypt and the database.
    - Issue access and refresh sessions using secure cookies.
    - Support Google OAuth flows using Passport where configured.

    Security notes:
    - Passwords are hashed with bcrypt before storage.
    - Refresh tokens are stored server-side as hashed values, while
        plaintext refresh tokens are set in an HttpOnly cookie.
*/
import bcrypt from 'bcrypt';
import passport from 'passport';
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db.js';
import { clearAuthCookies, issueSession, revokeSession, rotateSession } from '../auth/tokens.js';
const credentialsSchema = z.object({
    email: z.string().trim().email().max(320).transform((email) => email.toLowerCase()),
    password: z.string().min(12).max(72)
});
const publicUser = (user) => ({
    id: user.id,
    email: user.email,
    oauthProvider: user.oauth_provider
});
export async function register(request, response, next) {
    try {
        const parsed = credentialsSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ error: 'INVALID_CREDENTIALS', details: parsed.error.flatten().fieldErrors });
        const passwordHash = await bcrypt.hash(parsed.data.password, 12);
        const inserted = await pool.query(`INSERT INTO users (email, password_hash) VALUES ($1, $2)
       RETURNING id, email, password_hash, oauth_provider, oauth_id`, [parsed.data.email, passwordHash]);
        const session = await issueSession(inserted.rows[0], request, response);
        return response.status(201).json({ user: publicUser(inserted.rows[0]), ...session });
    }
    catch (error) {
        if (error.code === '23505')
            return response.status(409).json({ error: 'EMAIL_ALREADY_REGISTERED' });
        return next(error);
    }
}
export async function login(request, response, next) {
    try {
        const parsed = credentialsSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ error: 'INVALID_CREDENTIALS' });
        const result = await pool.query('SELECT id, email, password_hash, oauth_provider, oauth_id FROM users WHERE email = $1', [parsed.data.email]);
        const user = result.rows[0];
        const valid = user?.password_hash ? await bcrypt.compare(parsed.data.password, user.password_hash) : false;
        if (!valid || !user)
            return response.status(401).json({ error: 'INVALID_EMAIL_OR_PASSWORD' });
        const session = await issueSession(user, request, response);
        return response.json({ user: publicUser(user), ...session });
    }
    catch (error) {
        return next(error);
    }
}
export function startGoogleOAuth(request, response, next) {
    if (!config.googleConfigured)
        return response.status(503).json({ error: 'GOOGLE_OAUTH_NOT_CONFIGURED' });
    return passport.authenticate('google', { scope: ['openid', 'profile', 'email'], session: false })(request, response, next);
}
export function completeGoogleOAuth(request, response, next) {
    if (!config.googleConfigured)
        return response.status(503).send('Google OAuth is not configured.');
    return passport.authenticate('google', { session: false }, async (error, user, info) => {
        if (error || !user) {
            console.error('Google OAuth callback failed', { message: error?.message ?? info?.message ?? 'No user returned' });
            return response.redirect(`${config.FRONTEND_ORIGIN}/login?error=oauth_failed`);
        }
        try {
            await issueSession(user, request, response);
            return response.redirect(`${config.FRONTEND_ORIGIN}/auth/callback`);
        }
        catch (issueError) {
            return next(issueError);
        }
    })(request, response, next);
}
export async function refreshSession(request, response, next) {
    try {
        const session = await rotateSession(request, response);
        if (!session)
            return response.status(401).json({ error: 'INVALID_REFRESH_TOKEN' });
        return response.json(session);
    }
    catch (error) {
        return next(error);
    }
}
export async function logout(request, response, next) {
    try {
        await revokeSession(request);
        clearAuthCookies(response);
        return response.status(204).end();
    }
    catch (error) {
        return next(error);
    }
}
