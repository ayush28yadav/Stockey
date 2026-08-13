// Orders controller
// Purpose: validate and persist incoming orders and enqueue them for
// matching. This controller is intentionally small: validation is done
// with `zod`, persistence is a single DB insert (with idempotency), and
// the matching work is delegated to the background queue.
import { z } from 'zod';
import { pool } from '../db.js';
import { enqueueOrderForMatching } from '../queues/order-matching.queue.js';
import { cancelOrderExpiryJob, scheduleOrderExpiry } from '../queues/scheduler.js';
import { MatchingEngine } from '../matching/matching-engine.js';
import { redisClient } from '../redis.js';
const symbol = z.string().trim().toUpperCase().regex(/^[A-Z][A-Z0-9.]{0,15}$/, 'Invalid stock symbol');
const baseOrder = z.object({
    stockSymbol: symbol,
    side: z.enum(['buy', 'sell']),
    quantity: z.number().int().positive().max(1_000_000)
});
const orderSchema = z.discriminatedUnion('orderType', [
    baseOrder.extend({ orderType: z.literal('market') }),
    baseOrder.extend({ orderType: z.literal('limit'), price: z.number().positive().max(10_000_000) })
]);
function presentOrder(order) {
    return {
        id: order.id,
        userId: order.user_id,
        stockSymbol: order.stock_symbol,
        orderType: order.order_type,
        side: order.side,
        price: order.price === null ? null : Number(order.price),
        quantity: order.quantity,
        filledQuantity: order.filled_quantity,
        status: order.status,
        idempotencyKey: order.idempotency_key,
        createdAt: order.created_at,
        updatedAt: order.updated_at
    };
}

const openStatuses = ['open', 'partially_filled'];

function orderQuery(filters = '') {
    return `SELECT * FROM orders ${filters} ORDER BY created_at DESC`;
}

export async function listOrders(request, response, next) {
    const status = request.query.status?.toString();
    const stockSymbol = request.query.symbol?.toString().trim().toUpperCase();
    if (status && !['open', 'partially_filled', 'filled', 'cancelled'].includes(status))
        return response.status(400).json({ error: 'INVALID_STATUS' });
    if (stockSymbol && !symbol.safeParse(stockSymbol).success)
        return response.status(400).json({ error: 'INVALID_SYMBOL' });

    try {
        const clauses = ['user_id = $1'];
        const values = [request.auth.userId];
        if (status) {
            values.push(status);
            clauses.push(`status = $${values.length}`);
        }
        if (stockSymbol) {
            values.push(stockSymbol);
            clauses.push(`stock_symbol = $${values.length}`);
        }
        const result = await pool.query(orderQuery(`WHERE ${clauses.join(' AND ')}`), values);
        return response.json({ orders: result.rows.map(presentOrder) });
    }
    catch (error) {
        return next(error);
    }
}

export async function getOrder(request, response, next) {
    try {
        const result = await pool.query(
            'SELECT * FROM orders WHERE id = $1 AND user_id = $2',
            [request.params.id, request.auth.userId]
        );
        if (!result.rows[0])
            return response.status(404).json({ error: 'ORDER_NOT_FOUND' });
        return response.json({ order: presentOrder(result.rows[0]) });
    }
    catch (error) {
        return next(error);
    }
}

export async function cancelOrder(request, response, next) {
    try {
        const result = await pool.query(`UPDATE orders
            SET status = 'cancelled', updated_at = NOW()
            WHERE id = $1 AND user_id = $2 AND status = ANY($3::varchar[])
            RETURNING *`, [request.params.id, request.auth.userId, openStatuses]);
        const order = result.rows[0];
        if (!order)
            return response.status(409).json({ error: 'ORDER_NOT_CANCELLABLE' });

        // Keep the Redis order book in sync immediately so cancelled orders
        // disappear from every connected dashboard without waiting for expiry.
        await new MatchingEngine(redisClient, pool).syncOrderBook(order);
        await cancelOrderExpiryJob(order.id).catch(() => undefined);
        return response.json({ order: presentOrder(order) });
    }
    catch (error) {
        return next(error);
    }
}
export async function submitOrder(request, response, next) {
    const idempotencyKey = request.get('idempotency-key');
    if (!idempotencyKey || !z.string().uuid().safeParse(idempotencyKey).success) {
        return response.status(400).json({ error: 'INVALID_IDEMPOTENCY_KEY', message: 'Idempotency-Key must be a UUID.' });
    }
    const parsed = orderSchema.safeParse(request.body);
    if (!parsed.success)
        return response.status(400).json({ error: 'INVALID_ORDER', details: parsed.error.flatten().fieldErrors });
    try {
        const order = parsed.data;
        const price = order.orderType === 'limit' ? order.price : null;
        const inserted = await pool.query(`INSERT INTO orders (user_id, stock_symbol, order_type, side, price, quantity, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, idempotency_key) DO NOTHING
       RETURNING *`, [request.auth.userId, order.stockSymbol, order.orderType, order.side, price, order.quantity, idempotencyKey]);
        if (inserted.rows[0]) {
            const order = inserted.rows[0];
            await enqueueOrderForMatching(order.id);
            if (order.order_type === 'limit')
                await scheduleOrderExpiry(order.id);
            return response.status(201).json({ order: presentOrder(order) });
        }
        const existing = await pool.query('SELECT * FROM orders WHERE user_id = $1 AND idempotency_key = $2', [request.auth.userId, idempotencyKey]);
        if (!existing.rows[0])
            return response.status(409).json({ error: 'IDEMPOTENCY_CONFLICT' });
        return response.status(200).set('Idempotency-Replayed', 'true').json({ order: presentOrder(existing.rows[0]) });
    }
    catch (error) {
        return next(error);
    }
}
