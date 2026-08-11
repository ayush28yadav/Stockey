/*
    Notifications worker

    Responsibilities:
    - Listen to the `notifications` BullMQ queue and process email jobs.
    - Route each job to the appropriate email template based on `job.name`.
    - Send the rendered email via Nodemailer (real SMTP or Ethereal in dev).
    - Write an audit record to the `notification_log` table after every
      attempt, regardless of success or failure.

    Job routing:
    ┌─────────────────────────┬───────────────────────────────┐
    │ job.name                │ Handler function              │
    ├─────────────────────────┼───────────────────────────────┤
    │ trade-confirmation      │ handleTradeConfirmation        │
    │ otp-email               │ handleOtpEmail                 │
    │ daily-pnl-summary       │ handleDailyPnlSummary          │
    └─────────────────────────┴───────────────────────────────┘

    Retry behaviour:
    - The queue is configured with 5 attempts and exponential backoff.
    - If all retries are exhausted, BullMQ moves the job to the failed set
      and emits a `failed` event (logged below). A human can then inspect
      the job and retry manually via a Bull Board UI (Phase 7).

    Concurrency:
    - Email sending is network-bound (SMTP round trip). Concurrency 5 means
      up to 5 emails are in-flight simultaneously, keeping throughput high
      without overloading the SMTP provider.
*/

import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { pool } from '../db.js';
import { sendMail } from '../email/mailer.js';
import {
    tradeConfirmationEmail,
    otpEmail,
    dailyPnlEmail
} from '../email/templates.js';

const require = createRequire(import.meta.url);
const { Worker: WorkerCjs } = require('bullmq/dist/cjs/index.js');

// Separate ioredis connection for the worker (BullMQ uses blocking commands
// internally that must not share a connection with the queue producer).
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (err) => console.error('[notifications-worker] Redis error', err));

// Module-level reference so we can close cleanly on SIGTERM.
let worker = null;

// ─────────────────────────────────────────────────────────────────────────────
// Job handlers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Handle a `trade-confirmation` job.
 *
 * Generates a trade confirmation email using the template and sends it.
 * The payload comes directly from `enqueueTradeConfirmation()` in the
 * notifications queue module.
 *
 * @param {object} data - job.data
 */
async function handleTradeConfirmation(data) {
    const { email, side, stockSymbol, quantity, price, total, orderId, executedAt, userId } = data;

    const { subject, html, text } = tradeConfirmationEmail({
        side, stockSymbol, quantity, price, total, orderId, executedAt
    });

    let result;
    try {
        result = await sendMail({ to: email, subject, html, text });
    } catch (err) {
        await logNotification({
            userId,
            notificationType: 'trade-confirmation',
            recipientEmail: email,
            status: 'failed',
            providerResponse: err.message,
            payload: data
        });
        throw err;
    }

    await logNotification({
        userId,
        notificationType: 'trade-confirmation',
        recipientEmail: email,
        status: 'sent',
        providerResponse: result.messageId,
        payload: data
    });

    console.log(`[notifications-worker] Trade confirmation sent to ${email} (order ${orderId})`);
}

/**
 * Handle an `otp-email` job.
 *
 * Sends the OTP code that was generated and stored in Redis by the OTP
 * controller. This worker just emails it — it does not touch Redis.
 *
 * @param {object} data - job.data
 */
async function handleOtpEmail(data) {
    const { email, otp, action, userId } = data;

    const { subject, html, text } = otpEmail({ otp, action });

    let result;
    try {
        result = await sendMail({ to: email, subject, html, text });
    } catch (err) {
        await logNotification({
            userId,
            notificationType: 'otp-email',
            recipientEmail: email,
            status: 'failed',
            providerResponse: err.message,
            payload: { action, userId }
        });
        throw err;
    }

    await logNotification({
        userId,
        notificationType: 'otp-email',
        recipientEmail: email,
        status: 'sent',
        providerResponse: result.messageId,
        payload: { action, userId }
    });

    console.log(`[notifications-worker] OTP email sent to ${email}`);
}

/**
 * Handle a `daily-pnl-summary` job.
 *
 * Fetches the user's current portfolio and the last traded price for each
 * stock, calculates per-holding and total P&L, then emails the summary.
 *
 * Note: "current price" here is the last execution price recorded in the
 * `trades` table for each symbol. A production system would use a dedicated
 * market-data feed; for the demo this is a good approximation.
 *
 * @param {object} data - job.data
 */
async function handleDailyPnlSummary(data) {
    const { userId, email, date } = data;

    // ── Step 1: Fetch the user's cash balance ──────────────────────────────
    const userResult = await pool.query(
        'SELECT balance FROM users WHERE id = $1',
        [userId]
    );
    const cashBalance = Number(userResult.rows[0]?.balance ?? 0);

    // ── Step 2: Fetch holdings with latest traded price in a single query ────
    // A LATERAL join pulls the most recent execution price per symbol without
    // N round-trips. If no trade exists for a symbol, we fall back to avg_buy_price.
    const holdingsResult = await pool.query(
        `SELECT ph.stock_symbol, ph.quantity, ph.avg_buy_price, t.price AS current_price
         FROM portfolio_holdings ph
         LEFT JOIN LATERAL (
             SELECT price FROM trades
             WHERE stock_symbol = ph.stock_symbol
             ORDER BY executed_at DESC
             LIMIT 1
         ) t ON true
         WHERE ph.user_id = $1 AND ph.quantity > 0`,
        [userId]
    );

    const holdings = holdingsResult.rows.map((h) => {
        const currentPrice = Number(h.current_price ?? h.avg_buy_price);
        const pnl = (currentPrice - Number(h.avg_buy_price)) * Number(h.quantity);

        return {
            stock_symbol: h.stock_symbol,
            quantity: Number(h.quantity),
            avg_buy_price: Number(h.avg_buy_price),
            current_price: currentPrice,
            pnl
        };
    });

    // ── Step 4: Calculate total P&L ───────────────────────────────────────
    const totalPnl = holdings.reduce((sum, h) => sum + h.pnl, 0);

    // ── Step 5: Render template and send ──────────────────────────────────
    const { subject, html, text } = dailyPnlEmail({
        email, cashBalance, holdings, totalPnl, date
    });

    let result;
    try {
        result = await sendMail({ to: email, subject, html, text });
    } catch (err) {
        await logNotification({
            userId,
            notificationType: 'daily-pnl-summary',
            recipientEmail: email,
            status: 'failed',
            providerResponse: err.message,
            payload: { date, totalPnl, holdingCount: holdings.length }
        });
        throw err;
    }

    await logNotification({
        userId,
        notificationType: 'daily-pnl-summary',
        recipientEmail: email,
        status: 'sent',
        providerResponse: result.messageId,
        payload: { date, totalPnl, holdingCount: holdings.length }
    });

    console.log(`[notifications-worker] Daily P&L summary sent to ${email} (P&L: ${totalPnl.toFixed(2)})`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit logging helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Write a record to `notification_log`.
 *
 * This is a best-effort operation: if the DB write fails we log the error
 * but do not rethrow, because the email was already sent successfully and
 * we don't want to trigger a retry for a logging failure.
 *
 * @param {object} params
 */
async function logNotification({ userId, notificationType, recipientEmail, status, providerResponse, payload }) {
    try {
        await pool.query(
            `INSERT INTO notification_log
               (user_id, notification_type, recipient_email, status, provider_response, payload, sent_at)
            VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [userId, notificationType, recipientEmail, status, providerResponse, JSON.stringify(payload)]
        );
    } catch (err) {
        if (err.code === '23503') {
            return;
        }
        console.error('[notifications-worker] Failed to write notification log:', err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker factory
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Start the notifications worker.
 *
 * The main job processor uses a switch on `job.name` to route to the correct
 * handler. Any unknown job name is logged and skipped — this is safer than
 * throwing, which would trigger retries for a developer mistake.
 *
 * @returns {Worker} The BullMQ Worker instance.
 */
export function startNotificationsWorker() {
    if (worker) return worker;   // idempotent — only one worker per process

    worker = new WorkerCjs('notifications', async (job) => {

        // Log every job start so you can trace the email pipeline in terminal.
        console.log(`[notifications-worker] Processing job "${job.name}" (id: ${job.id})`);

        switch (job.name) {
            case 'trade-confirmation':
                await handleTradeConfirmation(job.data);
                break;

            case 'otp-email':
                await handleOtpEmail(job.data);
                break;

            case 'daily-pnl-summary':
                await handleDailyPnlSummary(job.data);
                break;

            default:
                // Unknown job type — log it. Do NOT throw so BullMQ doesn't
                // retry infinitely. This acts as a safeguard against accidental
                // job name typos during development.
                console.warn(`[notifications-worker] Unknown job name: "${job.name}". Skipping.`);
        }

    }, {
        connection,
        // Up to 5 email jobs run concurrently. Email sending is I/O-bound
        // (waiting for SMTP), so concurrency > 1 improves throughput.
        concurrency: 5,
        // Allow up to 60 s per job (some SMTP servers are slow to respond).
        lockDuration: 60_000,
        autorun: true
    });

    // Log failed jobs so they appear in the terminal. The job will stay in
    // the BullMQ "failed" set for manual inspection.
    worker.on('failed', (job, err) => {
        console.error(`[notifications-worker] Job "${job?.name}" (id: ${job?.id}) failed:`, err.message);
    });

    worker.on('error', (err) => {
        console.error('[notifications-worker] Worker error:', err);
    });

    console.log('[notifications-worker] Started (concurrency: 5)');
    return worker;
}

/**
 * Gracefully shut down the notifications worker.
 *
 * Waits for any in-progress email jobs to finish (up to the default BullMQ
 * close timeout) before closing the Redis connection.
 */
export async function closeNotificationsWorker() {
    if (!worker) return;
    await worker.close();
    await connection.quit();
    worker = null;
    console.log('[notifications-worker] Closed.');
}
