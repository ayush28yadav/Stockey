// Order matching queue
// Purpose: provide a durable job queue for order matching. The queue
// uses BullMQ but loads the CJS build via `createRequire` to avoid ESM
// interop issues in the current toolchain.
import { createRequire } from 'node:module';
import { Redis } from 'ioredis';
import { config } from '../config.js';
const require = createRequire(import.meta.url);
const { Queue: QueueCjs } = require('bullmq/dist/cjs/index.js');
const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
connection.on('error', (error) => console.error('Order queue Redis error', error));

// Queue configuration: attempts + exponential backoff to handle
// transient failures. `removeOnComplete`/`removeOnFail` keep Redis
// storage bounded in a demo environment.
export const orderMatchingQueue = new QueueCjs('order-matching', {
    connection,
    defaultJobOptions: {
        attempts: 8,
        backoff: { type: 'exponential', delay: 250 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000
    }
});

// Enqueue an order for matching. `jobId` uses the order id so retries
// for the same order are deduplicated by BullMQ.
export async function enqueueOrderForMatching(orderId) {
    return orderMatchingQueue.add('match-order', { orderId }, { jobId: `match-${orderId}` });
}

export async function closeOrderMatchingQueue() {
    await orderMatchingQueue.close();
    await connection.quit();
}
