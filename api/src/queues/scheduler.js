/*
    Job scheduler

    Responsibilities:
    - Define and register all BullMQ repeatable (cron) jobs and per-order
      delayed jobs.
    - Export the `scheduled-jobs` queue so the worker can attach to the same
      queue name.
    - Export `scheduleOrderExpiry()` so the orders controller can create a
      delayed expiry job when a limit order is placed.
    - Export `cancelOrderExpiryJob()` so the matching engine can remove the
      delayed job when a limit order is filled before market close.

    Market hours (IST = UTC+5:30):
    ┌─────────────────────┬──────────────┬──────────────┐
    │ Event               │ IST          │ UTC (cron)   │
    ├─────────────────────┼──────────────┼──────────────┤
    │ Market open         │  9:15 AM     │  3:45 AM     │
    │ Market close        │  3:30 PM     │ 10:00 AM     │
    └─────────────────────┴──────────────┴──────────────┘
    Cron fields: minute hour day-of-month month day-of-week
    Mon–Fri = 1-5 in cron notation.

    Repeatable job key scheme:
    BullMQ uses an internal key to deduplicate repeatable jobs. We pass
    `{ repeat: { pattern, jobId } }` — the jobId acts as a stable name so
    calling `registerScheduledJobs()` on every server restart does NOT create
    duplicate jobs; BullMQ silently ignores a repeat registration with the
    same key.

    Delayed jobs (order expiry):
    When a limit order is placed, `scheduleOrderExpiry(orderId)` computes the
    delay (ms until next market close) and adds a single delayed job to the
    `scheduled-jobs` queue. The job ID is `order-expiry:{orderId}`, which is
    unique per order. If the order gets filled before market close, the
    matching engine calls `cancelOrderExpiryJob(orderId)` to remove the job.
*/

import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { pool } from '../db.js';

const require = createRequire(import.meta.url);
const { Queue: QueueCjs } = require('bullmq/dist/cjs/index.js');

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.error('[scheduler] Redis error', err));

// ─────────────────────────────────────────────────────────────────────────────
// Queue definition
// ─────────────────────────────────────────────────────────────────────────────

// The `scheduled-jobs` queue handles both repeatable (cron) jobs and
// delayed (one-shot) jobs. A single queue keeps the Bull Board dashboard
// tidy and reduces the number of Redis connections.
export const schedulerQueue = new QueueCjs('scheduled-jobs', {
    connection,
    defaultJobOptions: {
        // Scheduled jobs rarely fail, but if they do, retry 3 times.
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: 100,
        removeOnFail: 500
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Market hours helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if the given Date falls on a weekday (Mon–Fri) in IST.
 *
 * @param {Date} date
 * @returns {boolean}
 */
function isWeekdayIST(date) {
    // Convert to IST by adding 5h 30m, then check the day-of-week.
    const istOffsetMs = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(date.getTime() + istOffsetMs);
    const day = istDate.getUTCDay();   // 0=Sun, 1=Mon, …, 5=Fri, 6=Sat
    return day >= 1 && day <= 5;
}

/**
 * Compute the UTC timestamp for the next market close (3:30 PM IST = 10:00 AM UTC).
 *
 * If today's market close is in the future → return today's close.
 * If today's market close has already passed OR today is a weekend → return
 * the next weekday's close.
 *
 * This is used to calculate the delay for order expiry jobs.
 *
 * @returns {Date} UTC Date of the next market close.
 */
export function nextMarketCloseUTC() {
    const now = new Date();

    // Build today's market close in UTC (10:00 AM UTC = 3:30 PM IST).
    const todayClose = new Date(now);
    todayClose.setUTCHours(10, 0, 0, 0);

    // Walk forward until we find a weekday close that is in the future.
    let candidate = new Date(todayClose);
    while (candidate <= now || !isWeekdayIST(candidate)) {
        // Advance by one calendar day.
        candidate = new Date(candidate.getTime() + 24 * 60 * 60 * 1000);
        // Reset to 10:00 AM UTC on the new day.
        candidate.setUTCHours(10, 0, 0, 0);
    }
    return candidate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Repeatable job registration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Register all repeatable (cron) jobs.
 *
 * This function is idempotent: BullMQ uses the job's repeat key to detect
 * duplicates, so calling this on every server start is safe — it will not
 * create additional job instances if they already exist.
 *
 * Call this once from `server.js` after the queue connection is ready.
 */
export async function registerScheduledJobs() {
    // ── Market open: 9:15 AM IST Mon–Fri (3:45 AM UTC) ───────────────────
    await schedulerQueue.add(
        'market-open',
        { event: 'market-open' },   // payload passed to the worker
        {
            repeat: {
                pattern: '45 3 * * 1-5',  // cron: 3:45 AM UTC, weekdays only
                // Stable key prevents duplicate registrations on restart.
                jobId: 'market-open-daily'
            },
            // Give market-open the highest priority among scheduled jobs
            // so it fires promptly if the scheduler is under load.
            priority: 1
        }
    );

    // ── Market close: 3:30 PM IST Mon–Fri (10:00 AM UTC) ─────────────────
    await schedulerQueue.add(
        'market-close',
        { event: 'market-close' },
        {
            repeat: {
                pattern: '0 10 * * 1-5',  // cron: 10:00 AM UTC, weekdays only
                jobId: 'market-close-daily'
            },
            priority: 1
        }
    );

    console.log('[scheduler] Repeatable jobs registered: market-open (9:15 AM IST), market-close (3:30 PM IST)');
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-order delayed expiry jobs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Schedule a delayed job that will expire a limit order at the next market
 * close if it hasn't been filled by then.
 *
 * Workflow:
 * 1. Orders controller calls this immediately after inserting a limit order.
 * 2. This function computes the delay to next market close and adds a delayed
 *    job to BullMQ.
 * 3. The BullMQ job ID (returned by `add()`) is stored in `order_expiry_jobs`
 *    so the matching engine can cancel it if the order gets filled.
 * 4. When the job fires, the scheduler worker cancels the order in the DB if
 *    it is still open.
 *
 * @param {string} orderId  - UUID of the limit order to expire.
 * @returns {Promise<string>} The BullMQ job ID (stored in order_expiry_jobs).
 */
export async function scheduleOrderExpiry(orderId) {
    const closeTime = nextMarketCloseUTC();
    const delayMs = closeTime.getTime() - Date.now();

    // A unique, predictable job ID prevents duplicates if this function is
    // accidentally called twice for the same order (e.g. retry from the
    // orders controller).
    const jobId = `order-expiry:${orderId}`;

    const job = await schedulerQueue.add(
        'order-expiry',
        { orderId },
        {
            delay: delayMs,     // fire after `delayMs` milliseconds
            jobId,
            // Expiry jobs don't need retries: if the order is still open
            // after the delay, cancel it once. If the DB is down, the job
            // will be retried by the default `attempts: 3` config above.
        }
    );

    // Persist the job ID and scheduled time so the matching engine can look it
    // up and remove the BullMQ job if the order is filled before close.
    await pool.query(
        `INSERT INTO order_expiry_jobs (order_id, bullmq_job_id, scheduled_for)
         VALUES ($1, $2, $3)
         ON CONFLICT (order_id) DO NOTHING`,  // safe to call twice
        [orderId, job.id, closeTime.toISOString()]
    );

    console.log(`[scheduler] Order expiry scheduled for ${orderId} at ${closeTime.toISOString()}`);
    return job.id;
}

/**
 * Remove the BullMQ delayed expiry job for an order that has been filled or
 * cancelled before market close.
 *
 * Called by the matching engine's `settle()` function after a successful trade.
 *
 * This is a best-effort cleanup. If the job has already fired (unlikely, since
 * the order just got filled) or if the job ID no longer exists, `remove` is a
 * no-op in BullMQ.
 *
 * @param {string} orderId  - UUID of the filled/cancelled order.
 */
export async function cancelOrderExpiryJob(orderId) {
    // Look up the BullMQ job ID from our tracking table.
    const result = await pool.query(
        'SELECT bullmq_job_id FROM order_expiry_jobs WHERE order_id = $1',
        [orderId]
    );
    const row = result.rows[0];
    if (!row) return;  // no expiry job was ever scheduled for this order

    try {
        // `getJob` returns null if the job no longer exists (already fired or
        // was manually removed). `remove()` throws if the job is not in a
        // removable state (e.g. already completed).
        const job = await schedulerQueue.getJob(row.bullmq_job_id);
        if (job) await job.remove();
    } catch (err) {
        // Non-fatal: log and continue. The order is already filled; the expiry
        // job would just find it non-open and do nothing anyway.
        console.warn(`[scheduler] Could not remove expiry job for order ${orderId}:`, err.message);
    }

    // Remove the tracking row — no longer needed.
    await pool.query('DELETE FROM order_expiry_jobs WHERE order_id = $1', [orderId]);
}

/**
 * Close the scheduler queue and its Redis connection.
 * Called during graceful shutdown.
 */
export async function closeSchedulerQueue() {
    await schedulerQueue.close();
    await connection.quit();
}
