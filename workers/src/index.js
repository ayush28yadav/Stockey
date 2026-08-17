/*
    Stockey Workers Service — Standalone Background Worker Entry Point

    Responsibilities:
    - Initialize Redis Pub/Sub and Postgres connections.
    - Start all background consumer workers (Order Matching, Scheduler, Notifications).
    - Handle SIGINT/SIGTERM gracefully for clean shutdown.
*/

import { config } from '../../api/src/config.js';
import { closeDatabase, pool } from '../../api/src/db.js';
import { connectRedis, connectPubSub, closePubSubClients, redisClient } from '../../api/src/redis.js';
import { startOrderMatchingWorker, closeOrderMatchingWorker } from '../../api/src/queues/order-matching.worker.js';
import { startSchedulerWorker, closeSchedulerWorker } from '../../api/src/queues/scheduler.worker.js';
import { startNotificationsWorker, closeNotificationsWorker } from '../../api/src/queues/notifications.worker.js';
import { closeSchedulerQueue } from '../../api/src/queues/scheduler.js';
import { closeNotificationsQueue } from '../../api/src/queues/notifications.queue.js';

console.log('[workers] Starting Stockey background worker service...');

await connectRedis();
await connectPubSub();
await pool.query('SELECT 1');

const matchingWorker = startOrderMatchingWorker();
const schedulerWorker = startSchedulerWorker();
const notificationsWorker = startNotificationsWorker();

console.log('[workers] All background workers started successfully.');

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;

    console.log(`[workers] ${signal} received; shutting down background workers...`);
    await closeOrderMatchingWorker();
    await closeSchedulerWorker();
    await closeNotificationsWorker();
    await closeSchedulerQueue();
    await closeNotificationsQueue();
    await closePubSubClients();
    await redisClient.quit();
    await closeDatabase();
    console.log('[workers] Worker service shut down cleanly.');
    process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
