/*
    Session and token utilities

    Responsibilities:
    - Create and verify short-lived access tokens (JWTs).
    - Issue and rotate refresh tokens stored server-side; only a
        hashed value is kept in Postgres while the plaintext token is set
        in an HttpOnly cookie. This reduces the risk of token replay.

    Notes:
    - Access tokens are intentionally short (15 minutes) to limit the
        impact if leaked. Refresh tokens enable long-lived sessions while
        allowing server-side revocation.
*/
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool } from '../db.js';
import { config } from '../config.js';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
const refreshCookieName = 'refresh_token';
const accessCookieName = 'access_token';
function hash(token) {
        return createHash('sha256').update(token).digest('hex');
}
export function createAccessToken(user) {
    return jwt.sign({ email: user.email, type: 'access' }, config.jwtPrivateKey, { algorithm: 'RS256', subject: user.id, expiresIn: ACCESS_TTL_SECONDS, jwtid: randomUUID(), issuer: 'stockey-api', audience: 'stockey-client' });
}
export function verifyAccessToken(token) {
    const decoded = jwt.verify(token, config.jwtPublicKey, {
        algorithms: ['RS256'], issuer: 'stockey-api', audience: 'stockey-client'
    });
    if (typeof decoded === 'string' || decoded.type !== 'access' || typeof decoded.sub !== 'string' || typeof decoded.email !== 'string') {
        throw new Error('Invalid access token claims');
    }
    return { sub: decoded.sub, email: decoded.email, type: 'access' };
}
function cookieOptions(maxAge) {
    return {
        httpOnly: true,
        secure: config.cookieSecure,
        sameSite: 'lax',
        maxAge
    };
}
export function clearAuthCookies(response) {
    response.clearCookie(refreshCookieName, { ...cookieOptions(0), path: '/api/auth' });
    response.clearCookie(accessCookieName, { ...cookieOptions(0), path: '/' });
}
async function storeRefreshToken(userId, request, client = pool) {
    const plaintext = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);
    await client.query(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip)
     VALUES ($1, $2, $3, $4, $5)`, [userId, hash(plaintext), expiresAt, request.get('user-agent') ?? null, request.ip || null]);
    return plaintext;
}
export async function issueSession(user, request, response) {
    const accessToken = createAccessToken(user);
    const refreshToken = await storeRefreshToken(user.id, request);
    response.cookie(accessCookieName, accessToken, { ...cookieOptions(ACCESS_TTL_SECONDS * 1000), path: '/' });
    response.cookie(refreshCookieName, refreshToken, { ...cookieOptions(REFRESH_TTL_SECONDS * 1000), path: '/api/auth' });
    return { accessToken, expiresIn: ACCESS_TTL_SECONDS };
}
export async function rotateSession(request, response) {
    const oldToken = request.cookies?.[refreshCookieName];
    if (!oldToken)
        return null;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`SELECT u.id, u.email, rt.id AS token_id, rt.revoked_at, rt.expires_at
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 FOR UPDATE`, [hash(oldToken)]);
        const record = result.rows[0];
        if (!record || record.revoked_at || record.expires_at <= new Date()) {
            if (record)
                await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [record.id]);
            await client.query('COMMIT');
            clearAuthCookies(response);
            return null;
        }
        const newToken = await storeRefreshToken(record.id, request, client);
        const replacement = await client.query('SELECT id FROM refresh_tokens WHERE token_hash = $1', [hash(newToken)]);
        await client.query('UPDATE refresh_tokens SET revoked_at = NOW(), replaced_by = $2 WHERE id = $1', [record.token_id, replacement.rows[0].id]);
        await client.query('COMMIT');
        const accessToken = createAccessToken(record);
        response.cookie(accessCookieName, accessToken, { ...cookieOptions(ACCESS_TTL_SECONDS * 1000), path: '/' });
        response.cookie(refreshCookieName, newToken, { ...cookieOptions(REFRESH_TTL_SECONDS * 1000), path: '/api/auth' });
        return { accessToken, expiresIn: ACCESS_TTL_SECONDS };
    }
    catch (error) {
        await client.query('ROLLBACK');
        throw error;
    }
    finally {
        client.release();
    }
}
export async function revokeSession(request) {
    const token = request.cookies?.[refreshCookieName];
    if (token)
        await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [hash(token)]);
}
