/*
    Environment configuration and validation

    Purpose: validate, coerce and document runtime environment variables.
    Using a schema ensures the process fails fast on misconfiguration
    and produces clear errors for operators and CI.
*/
import 'dotenv/config';
import { z } from 'zod';
const optionalUrl = z.string().url().optional().or(z.literal(''));
const schema = z.object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
    FRONTEND_ORIGIN: z.string().url(),
    API_ORIGIN: z.string().url(),
    SESSION_SECRET: z.string().min(32),
    JWT_PRIVATE_KEY_BASE64: z.string().min(1),
    JWT_PUBLIC_KEY_BASE64: z.string().min(1),
    GOOGLE_CLIENT_ID: z.string().optional().default(''),
    GOOGLE_CLIENT_SECRET: z.string().optional().default(''),
    GOOGLE_CALLBACK_URL: optionalUrl,
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),

    // ── Email / SMTP ──────────────────────────────────────────────────────────
    // All SMTP fields are optional. When they are absent (or empty), the
    // `mailer.js` module automatically falls back to an Ethereal test account
    // so developers see emails in the console without a real mail server.
    // In production, set all four to a real SMTP provider (SendGrid, SES, etc.)
    SMTP_HOST: z.string().optional().default(''),
    SMTP_PORT: z.coerce.number().int().positive().optional().default(587),
    SMTP_USER: z.string().optional().default(''),
    SMTP_PASS: z.string().optional().default(''),
    // The "From" address shown in the email client.
    SMTP_FROM: z.string().optional().default('Stockey <noreply@stockey.dev>')
});
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}
const env = parsed.data;
const googleConfigured = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_CALLBACK_URL);
if ((env.GOOGLE_CLIENT_ID || env.GOOGLE_CLIENT_SECRET) && !googleConfigured) {
    throw new Error('Google OAuth requires GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL together.');
}
if (env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'true') {
    throw new Error('COOKIE_SECURE must be true in production.');
}
export const config = {
    ...env,
    googleConfigured,
    cookieSecure: env.COOKIE_SECURE === 'true',
    jwtPrivateKey: Buffer.from(env.JWT_PRIVATE_KEY_BASE64, 'base64').toString('utf8'),
    jwtPublicKey: Buffer.from(env.JWT_PUBLIC_KEY_BASE64, 'base64').toString('utf8')
};
