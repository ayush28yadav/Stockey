/*
    Scheduler worker

    Responsibilities:
    - Listen to the `scheduled-jobs` BullMQ queue and process:
        • `market-open`  — fired at 9:15 AM IST on weekdays
        • `market-close` — fired at 3:30 PM IST on weekdays
        • `order-expiry` — fired per-limit-order at the next market close
    - Broadcast market state changes to connected clients via Socket.IO so
      the frontend can show an "Exchange Open / Closed" banner.

    Job handlers:
    ┌──────────────┬──────────────────────────────────────────────────────────┐
    │ market-open  │ Logs the event and emits 'market:open' to all sockets.   │
    ├──────────────┼──────────────────────────────────────────────────────────┤
    │ market-close │ 1. Cancels all still-open limit orders in the DB.         │
    │              │ 2. Emits 'market:close' to all connected sockets.         │
    │              │ 3. Enqueues a daily-pnl-summary job for every user.       │
    ├──────────────┼──────────────────────────────────────────────────────────┤
    │ order-expiry │ Cancels a single limit order if it is still open.         │
    └──────────────┴──────────────────────────────────────────────────────────┘

    Socket.IO access:
    The worker needs to emit events to connected clients, but the Socket.IO
    server lives in `server.js`. We pass the `io` instance via the factory
    function `startSchedulerWorker(io)`. This avoids circular imports and
    keeps the worker self-contained.

    Concurrency:
    Scheduled jobs should run one at a time (concurrency: 1) to avoid
    competing market-open or market-close handlers running in parallel.
*/

import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { pool } from '../db.js';
import { enqueueDailyPnlEmail } from './notifications.queue.js';

const require = createRequire(import.meta.url);
const { Worker: WorkerCjs } = require('bullmq/dist/cjs/index.js');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.error('[scheduler-worker] Redis error', err));

let worker = null;

// ─────────────────────────────────────────────────────────────────────────────
// Job handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle `market-open`.
 *
 * Fires at 9:15 AM IST every weekday. Emits a Socket.IO event so the
 * frontend can update the "market status" badge in real time.
 * In a production system this would also: re-enable order submission,
 * clear overnight cancellation flags, and seed the order book for the new
 * session.
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance
 */
async function handleMarketOpen(io) {
    const timestamp = new Date().toISOString();
    console.log(`[scheduler-worker] 🟢 Market opened at ${timestamp}`);

    // Broadcast to all connected clients. The frontend listens for
    // 'market:status' and updates its banner accordingly.
    io.emit('market:status', { status: 'open', timestamp });
}

/**
 * Handle `market-close`.
 *
 * Fires at 3:30 PM IST every weekday. Performs three actions in sequence:
 * 1. Cancel all outstanding open/partially-filled limit orders.
 * 2. Emit 'market:status' close event to all WebSocket clients.
 * 3. Enqueue daily P&L summary emails for all users who have holdings.
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance
 */
async function handleMarketClose(io) {
    const timestamp = new Date().toISOString();
    console.log(`[scheduler-worker] 🔴 Market closing at ${timestamp}. Cancelling open limit orders…`);

    // ── Step 1: Cancel all open limit orders ─────────────────────────────
    // Market orders should never sit in the book (the matching engine either
    // fills or cancels them immediately), so this only targets limit orders.
    // We use `RETURNING` to know how many rows were affected.
    const cancelled = await pool.query(
        `UPDATE orders
         SET status = 'cancelled', updated_at = NOW()
         WHERE status IN ('open', 'partially_filled')
           AND order_type = 'limit'
         RETURNING id, user_id, stock_symbol`
    );
    console.log(`[scheduler-worker] Cancelled ${cancelled.rowCount} open limit order(s) at market close.`);

    // ── Step 2: Broadcast market-close to all WebSocket clients ───────────
    io.emit('market:status', { status: 'closed', timestamp });

    // ── Step 3: Enqueue daily P&L summary for all users with holdings ─────
    // Fetch every user who holds at least one stock and has an email address.
    const usersResult = await pool.query(
        `SELECT DISTINCT u.id, u.email
         FROM users u
         JOIN portfolio_holdings ph ON ph.user_id = u.id
         WHERE ph.quantity > 0
           AND u.email IS NOT NULL`
    );

    // Enqueue one summary job per user. Jobs are deduplicated by date (see
    // `enqueueDailyPnlEmail`), so re-running market-close won't spam users.
    for (const user of usersResult.rows) {
        await enqueueDailyPnlEmail({
            userId: user.id,
            email: user.email,
            date: timestamp   // ISO string used as the "trading date" label
        });
    }
    console.log(`[scheduler-worker] Enqueued daily P&L summaries for ${usersResult.rowCount} user(s).`);
}

/**
 * Handle `order-expiry`.
 *
 * This delayed job fires at the next market close for a specific limit order.
 * If the order is still open at that point, it is cancelled. If it was already
 * filled or cancelled (the common case), the UPDATE affects 0 rows and the
 * function exits silently.
 *
 * @param {object} data      - job.data
 * @param {string} data.orderId - UUID of the limit order to expire.
 */
async function handleOrderExpiry({ orderId }) {
    // The WHERE clause guards against cancelling an order that was already
    // filled by the matching engine between when the job was scheduled and
    // when it fires. Only 'open' and 'partially_filled' orders are changed.
    const result = await pool.query(
        `UPDATE orders
         SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1
           AND status IN ('open', 'partially_filled')
           AND order_type = 'limit'
         RETURNING id, stock_symbol`,
        [orderId]
    );

    if (result.rowCount > 0) {
        console.log(`[scheduler-worker] ⏱ Expired limit order ${orderId} (${result.rows[0].stock_symbol}) at market close.`);
    }
    // If rowCount is 0, the order was already filled — nothing to do.
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the scheduler worker.
 *
 * @param {import('socket.io').Server} io - Socket.IO server instance. Passed
 *   in so the worker can broadcast market-open / market-close events to
 *   connected clients without needing a circular import.
 *
 * @returns {Worker} The BullMQ Worker instance.
 */
export function startSchedulerWorker(io) {
    if (worker) return worker;  // idempotent

    worker = new WorkerCjs('scheduled-jobs', async (job) => {
        console.log(`[scheduler-worker] Processing scheduled job "${job.name}" (id: ${job.id})`);

        switch (job.name) {
            case 'market-open':
                await handleMarketOpen(io);
                break;

            case 'market-close':
                await handleMarketClose(io);
                break;

            case 'order-expiry':
                await handleOrderExpiry(job.data);
                break;

            default:
                // Unrecognised job — log and skip (no retry).
                console.warn(`[scheduler-worker] Unknown scheduled job: "${job.name}". Skipping.`);
        }

    }, {
        connection,
        // Concurrency 1: scheduled jobs should never overlap. A market-open
        // and market-close job should not run in parallel.
        concurrency: 1,
        // 5 minutes lock: market-close scans and cancels all open orders,
        // which could take a few seconds if there are many.
        lockDuration: 5 * 60 * 1000,
        autorun: true
    });

    worker.on('failed', (job, err) => {
        console.error(`[scheduler-worker] Scheduled job "${job?.name}" (id: ${job?.id}) failed:`, err.message);
    });

    worker.on('error', (err) => {
        console.error('[scheduler-worker] Worker error:', err);
    });

    console.log('[scheduler-worker] Started (concurrency: 1).');
    return worker;
}

/**
 * Close the scheduler worker and its Redis connection.
 */
export async function closeSchedulerWorker() {
    if (!worker) return;
    await worker.close();
    await connection.quit();
    worker = null;
    console.log('[scheduler-worker] Closed.');
}
