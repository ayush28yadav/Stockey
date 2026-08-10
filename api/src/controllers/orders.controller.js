// Orders controller
// Purpose: validate and persist incoming orders and enqueue them for
// matching. This controller is intentionally small: validation is done
// with `zod`, persistence is a single DB insert (with idempotency), and
// the matching work is delegated to the background queue.
import { z } from 'zod';
import { pool } from '../db.js';
import { enqueueOrderForMatching } from '../queues/order-matching.queue.js';
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
