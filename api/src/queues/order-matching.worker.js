// Order matching worker
// Purpose: run background jobs to match and settle orders. For the
// demo the worker runs in-process, with concurrency=1 to limit Redis
// lock contention while the matching engine uses a per-symbol lock.
import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { MatchingEngine } from '../matching/matching-engine.js';
import { pool } from '../db.js';
const require = createRequire(import.meta.url);
const { Worker: WorkerCjs } = require('bullmq/dist/cjs/index.js');
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (error) => console.error('Order worker Redis error', error));
let worker = null;

export function startOrderMatchingWorker() {
    if (worker)
        return worker;
    const engine = new MatchingEngine(connection, pool);

    // Concurrency and lock settings are conservative for demo
    // reproducibility. Increase concurrency only after evaluating
    // lock contention under load and implementing finer-grained locks.
    worker = new WorkerCjs('order-matching', async (job) => {
        await engine.matchOrder(job.data.orderId);
    }, {
        connection,
        concurrency: 1,
        lockDuration: 60_000,
        autorun: true
    });

    worker.on('failed', (job, err) => {
        console.error('Order matching job failed', job?.id, err);
    });
    worker.on('error', (error) => {
        console.error('Order matching worker error', error);
    });
    return worker;
}

export async function closeOrderMatchingWorker() {
    if (!worker)
        return;
    await worker.close();
    await connection.quit();
    worker = null;
}
