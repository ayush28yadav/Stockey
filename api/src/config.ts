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
  COOKIE_SECURE: z.enum(['true', 'false']).default('false')
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
} as const;
