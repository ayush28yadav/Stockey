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
import { randomInt } from 'node:crypto'; // used to generate cryptographically random OTPs
import { z } from 'zod';
import { config } from '../config.js';
import { pool } from '../db.js';
import { redisClient } from '../redis.js';           // for storing OTPs with TTL
import { clearAuthCookies, issueSession, revokeSession, rotateSession } from '../auth/tokens.js';
import { enqueueOtpEmail } from '../queues/notifications.queue.js'; // Phase 5

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

// ─────────────────────────────────────────────────────────────────────────────
// Phase 5: OTP endpoints
// ─────────────────────────────────────────────────────────────────────────────

// Zod schema for the OTP send request.
// `action` is a short description shown in the email, e.g. "withdraw funds".
const otpSendSchema = z.object({
    action: z.string().trim().min(3).max(80).default('confirm this action')
});

// Zod schema for the OTP verify request.
const otpVerifySchema = z.object({
    otp: z.string().length(6).regex(/^\d{6}$/, 'OTP must be exactly 6 digits')
});

// Redis key pattern for OTPs. TTL is 10 minutes (600 seconds).
// Using the user ID as the key means only one OTP is valid per user at a time;
// requesting a new OTP invalidates the previous one automatically.
const OTP_TTL_SECONDS = 600;
const otpKey = (userId) => `OTP:${userId}`;

/**
 * POST /api/auth/otp/send
 *
 * Generates a 6-digit OTP, stores it in Redis with a 10-minute TTL, and
 * enqueues an email job to deliver it to the authenticated user.
 *
 * The endpoint requires a valid access token (the `requireAuth` middleware
 * is applied in the router). This prevents unauthenticated actors from
 * triggering OTP emails.
 *
 * Response: 204 No Content on success (no body — don't leak the OTP).
 */
export async function sendOtp(request, response, next) {
    try {
        const parsed = otpSendSchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.flatten().fieldErrors });

        const { userId, email } = request.auth;  // injected by requireAuth middleware
        const { action } = parsed.data;

        // Generate a cryptographically random 6-digit OTP.
        // `randomInt(0, 999999)` returns a value in [0, 999_999). We then
        // zero-pad it to 6 characters so short codes (e.g. 42) become "000042".
        const otp = String(randomInt(0, 1_000_000)).padStart(6, '0');

        // Store the OTP in Redis with a 10-minute TTL.
        // `SET key value EX seconds` atomically creates the key and sets the TTL.
        // If the user requests a new OTP before the old one expires, this
        // overwrites the old one — effectively invalidating it.
        await redisClient.set(otpKey(userId), otp, { EX: OTP_TTL_SECONDS });

        // Enqueue the email asynchronously. The user gets the 204 response
        // immediately without waiting for SMTP.
        await enqueueOtpEmail({ userId, email, otp, action });

        // Return 204: no body, don't echo the OTP back.
        return response.status(204).end();
    }
    catch (error) {
        return next(error);
    }
}

/**
 * POST /api/auth/otp/verify
 *
 * Validates the OTP submitted by the user against the value stored in Redis.
 * On success: deletes the Redis key (one-time use) and returns { success: true }.
 * On failure: returns 401 with OTP_INVALID or OTP_EXPIRED.
 *
 * Security notes:
 * - The Redis key is deleted on first successful verification (single-use).
 * - An expired OTP key no longer exists in Redis, so the response is the same
 *   as an invalid OTP (OTP_INVALID). This is intentional to avoid leaking
 *   timing information about when the OTP was issued.
 * - This does not implement brute-force rate limiting on OTP attempts — that
 *   should be added via a per-user attempt counter in Redis for production.
 */
export async function verifyOtp(request, response, next) {
    try {
        const parsed = otpVerifySchema.safeParse(request.body);
        if (!parsed.success)
            return response.status(400).json({ error: 'INVALID_REQUEST', details: parsed.error.flatten().fieldErrors });

        const { userId } = request.auth;
        const { otp } = parsed.data;

        // Retrieve the stored OTP from Redis.
        const stored = await redisClient.get(otpKey(userId));

        if (!stored) {
            // Key doesn't exist: OTP never generated or it expired.
            return response.status(401).json({ error: 'OTP_INVALID' });
        }

        // Compare the submitted OTP with the stored one.
        // Both values are plain strings of equal length so a direct equality
        // check is safe here. For TOTP or longer secrets, use timingSafeEqual.
        if (otp !== stored) {
            return response.status(401).json({ error: 'OTP_INVALID' });
        }

        // ✅ OTP matched — delete it immediately so it cannot be reused.
        await redisClient.del(otpKey(userId));

        return response.json({ success: true });
    }
    catch (error) {
        return next(error);
    }
}

