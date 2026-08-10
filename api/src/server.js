/*
  API server bootstrap

  Responsibilities:
  - Initialize Redis and Postgres connections and run DB migrations.
  - Configure middleware: security headers, CORS, JSON parsing,
    cookie and session handling.
  - Wire authentication, user and order routes.
  - Start a background order-matching worker and manage graceful
    shutdown to ensure workers and DB connections close cleanly.

  Notes:
  - Session cookies are stored in Redis using `connect-redis`.
  - `helmet` is used with a relaxed policy to avoid blocking the
    simple frontend during development; review in production.
*/
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import { RedisStore } from 'connect-redis';
import { createClient } from 'redis';
import helmet from 'helmet';
import { config } from './config.js';
import { closeDatabase, pool } from './db.js';
import { configurePassport } from './auth/passport.js';
import { authRouter } from './routes/auth.js';
import { userRouter } from './routes/user.js';
import { ordersRouter } from './routes/orders.js';
import { startOrderMatchingWorker, closeOrderMatchingWorker } from './queues/order-matching.worker.js';
import { runMigrations } from './migrations.js';

// Initialize Redis and ensure connectivity before continuing.
const redis = createClient({ url: config.REDIS_URL });
redis.on('error', (error) => console.error('Redis client error', error));
await redis.connect();

// Verify DB connectivity and apply migrations.
await pool.query('SELECT 1');
await runMigrations();

const app = express();
if (config.cookieSecure)
    app.set('trust proxy', 1);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: config.FRONTEND_ORIGIN, credentials: true, methods: ['GET', 'POST', 'OPTIONS'] }));
app.use(express.json({ limit: '32kb' }));
app.use(cookieParser());

// User session configuration. Sessions are short-lived and stored in
// Redis. `SESSION_SECRET` must be strong in production.
app.use(session({
    name: 'oauth_state',
    store: new RedisStore({ client: redis, prefix: 'stockey:sessions:' }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, secure: config.cookieSecure, sameSite: 'lax', maxAge: 10 * 60 * 1000 }
}));

app.use(configurePassport().initialize());

// Health + API routes
app.get('/health', (_request, response) => response.json({ status: 'ok' }));
app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/orders', ordersRouter);

// 404 and error handlers: keep responses simple and machine-parsable.
app.use((_request, response) => response.status(404).json({ error: 'NOT_FOUND' }));
app.use((error, _request, response, _next) => {
    console.error(error);
    return response.status(500).json({ error: 'INTERNAL_SERVER_ERROR' });
});

const server = app.listen(config.PORT, () => console.log(`API listening on ${config.API_ORIGIN}`));

// Start the order-matching worker. The worker is intentionally
// started in-process for the small demo environment; a production
// deployment would run workers separately and scale independently.
const matchingWorker = startOrderMatchingWorker();

async function shutdown(signal) {
    console.log(`${signal} received; shutting down.`);
    server.close(async () => {
        await closeOrderMatchingWorker();
        await redis.quit();
        await closeDatabase();
        process.exit(0);
    });
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
