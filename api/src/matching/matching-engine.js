/*
    Matching engine

    Responsibilities:
    - Maintain a light-weight order book in Redis for fast best-price
        discovery (sorted sets for bids/asks, per-order metadata in hashes).
    - Execute price-time priority matching between incoming taker orders
        and resting maker orders stored in Postgres/Redis.
    - Perform trade settlement inside a DB transaction with row-level
        `FOR UPDATE` locking to ensure consistency.

    Concurrency and locking:
    - Matching is guarded by a Redis key `MATCH_LOCK:<symbol>` to serialize
        work per-symbol. The worker runs with concurrency=1 to reduce
        contention in the demo environment. Consider per-symbol worker
        sharding or finer-grained locks for high throughput.
*/
import { randomUUID } from 'node:crypto';
import { pubClient } from '../redis.js';
// Phase 5 additions: fire trade-confirmation emails and clean up order-expiry
// jobs after every successful trade settlement.
import { enqueueTradeConfirmation } from '../queues/notifications.queue.js';
import { cancelOrderExpiryJob } from '../queues/scheduler.js';

const OPEN_STATUSES = ['open', 'partially_filled'];
const lockReleaseScript = `
    if redis.call('GET', KEYS[1]) == ARGV[1] then
        return redis.call('DEL', KEYS[1])
    end
    return 0
`;
// Helper: remaining quantity on an order
function remaining(order) {
    return order.quantity - order.filled_quantity;
}

// Helper: whether an order should still be considered in the book
function isOpen(order) {
    return OPEN_STATUSES.includes(order.status) && remaining(order) > 0;
}

// Money helpers: convert numbers to integer cents to avoid FP issues
function cents(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed))
        throw new Error(`Invalid money value: ${value}`);
    return Math.round(parsed * 100);
}

// Strip internal user identity from orders broadcast to public channels.
// The order book and live trade tape are unauthenticated, so internal
// user IDs must never be exposed to other traders.
function toPublicOrder(order) {
    return {
        id: order.id,
        stockSymbol: order.stock_symbol,
        orderType: order.order_type,
        side: order.side,
        price: order.price === null ? null : Number(order.price),
        quantity: order.quantity,
        filledQuantity: order.filled_quantity,
        status: order.status
    };
}

// Determine next order status after executing `executedQuantity`.
// If `cancelRemainder` is true then any remaining quantity is
// immediately cancelled instead of staying open.
function statusAfterFill(order, executedQuantity, cancelRemainder) {
    const nextFilled = order.filled_quantity + executedQuantity;
    if (nextFilled >= order.quantity)
        return 'filled';
    if (cancelRemainder)
        return 'cancelled';
    return nextFilled > 0 ? 'partially_filled' : 'open';
}
// Matching engine instance: holds Redis and Postgres clients and exposes
// `matchOrder` which is the entrypoint invoked by the job worker.
export class MatchingEngine {
    redis;
    pool;
    constructor(redis, pool) {
        this.redis = redis;
        this.pool = pool;
    }
    async matchOrder(orderId) {
        const initialOrder = await this.getOrder(orderId);
        if (!initialOrder || !isOpen(initialOrder))
            return;
        const lockToken = await this.acquireStockLock(initialOrder.stock_symbol, 5000);
        if (!lockToken)
            throw new Error(`Stock book is busy for ${initialOrder.stock_symbol}`);
        try {
            let incoming = await this.getOrder(orderId);
            if (!incoming || !isOpen(incoming))
                return;
            while (incoming && isOpen(incoming)) {
                const resting = await this.bestOppositeOrder(incoming.stock_symbol, incoming.side, incoming.user_id);
                if (!resting)
                    break;
                if (!this.canMatch(incoming, resting))
                    break;
                const settlement = await this.settle(incoming.id, resting.id);
                for (const changedOrder of settlement.orders)
                    await this.syncOrderBook(changedOrder);
                incoming = await this.getOrder(orderId);
                if (settlement.executedQuantity === 0 && settlement.orders.length === 0) {
                    // A stale Redis entry that no longer corresponds to an order.
                    await this.removeBookEntry(resting);
                }
            }
            if (!incoming || !isOpen(incoming))
                return;
            if (incoming.order_type === 'market') {
                const cancelled = await this.cancelOrder(incoming.id);
                if (cancelled)
                    await this.syncOrderBook(cancelled);
                return;
            }
            await this.syncOrderBook(incoming);
        }
        finally {
            await this.releaseStockLock(initialOrder.stock_symbol, lockToken);
        }
    }
    async getOrder(id, client = this.pool) {
        const result = await client.query('SELECT id, user_id, stock_symbol, order_type, side, price, quantity, filled_quantity, status FROM orders WHERE id = $1', [id]);
        return result.rows[0] ?? null;
    }
    bookKey(symbol, side) {
        return `${side === 'buy' ? 'BIDS' : 'ASKS'}:${symbol}`;
    }
    orderKey(orderId) {
        return `ORDER:${orderId}`;
    }
    async bestOppositeOrder(symbol, incomingSide, excludeUserId = null) {
        const restingSide = incomingSide === 'buy' ? 'sell' : 'buy';
        // Scan the first 100 price levels (mirrors the public order-book depth).
        // We skip past stale/self-owned entries so the taker always executes
        // against the best *other-user* liquidity (prevents wash trading).
        const members = await this.redis.zrange(this.bookKey(symbol, restingSide), 0, 99);
        for (const member of members) {
            const separator = member.indexOf(':');
            if (separator === -1)
                continue;
            const orderId = member.slice(separator + 1);
            const order = await this.getOrder(orderId);
            if (!order) {
                await this.redis.zrem(this.bookKey(symbol, restingSide), member);
                continue;
            }
            if (!isOpen(order)) {
                await this.syncOrderBook(order);
                continue;
            }
            if (excludeUserId && order.user_id === excludeUserId)
                continue; // self-match — never trade with yourself
            return order;
        }
        return null;
    }
    canMatch(incoming, resting) {
        if (incoming.stock_symbol !== resting.stock_symbol || incoming.side === resting.side)
            return false;
        if (incoming.order_type === 'market')
            return true;
        if (resting.price === null || incoming.price === null)
            return false;
        return incoming.side === 'buy'
            ? cents(resting.price) <= cents(incoming.price)
            : cents(resting.price) >= cents(incoming.price);
    }
    async settle(incomingId, restingId) {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const locked = await client.query(`SELECT id, user_id, stock_symbol, order_type, side, price, quantity, filled_quantity, status
         FROM orders WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`, [[incomingId, restingId]]);
            if (locked.rows.length !== 2) {
                await client.query('COMMIT');
                return { executedQuantity: 0, orders: [] };
            }
            const incoming = locked.rows.find((order) => order.id === incomingId);
            const resting = locked.rows.find((order) => order.id === restingId);
            if (!isOpen(incoming) || !isOpen(resting) || !this.canMatch(incoming, resting)) {
                await client.query('COMMIT');
                return { executedQuantity: 0, orders: [incoming, resting] };
            }
            // Wash-trading guard (defense in depth): never settle two orders
            // owned by the same user, even if a self-owned entry reaches
            // settlement. bestOppositeOrder normally filters these out, so in
            // practice the loop will simply move on to the next match.
            if (incoming.user_id === resting.user_id) {
                await client.query('COMMIT');
                return { executedQuantity: 0, orders: [incoming] };
            }
            const buyOrder = incoming.side === 'buy' ? incoming : resting;
            const sellOrder = incoming.side === 'sell' ? incoming : resting;
            // The resting order is the maker, so its limit price is the execution price.
            const executionPrice = resting.price;
            if (executionPrice === null)
                throw new Error('A resting market order cannot exist in the order book');
            const priceCents = cents(executionPrice);
            // Select id, balance AND email. The email is used by Phase 5 to
            // send trade confirmation notifications without an extra DB query.
            const users = await client.query('SELECT id, balance, email FROM users WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE', [[buyOrder.user_id, sellOrder.user_id]]);
            const buyer = users.rows.find((user) => user.id === buyOrder.user_id);
            if (!buyer || users.rows.length !== 2)
                throw new Error('Trade users no longer exist');
            const holding = await client.query('SELECT quantity FROM portfolio_holdings WHERE user_id = $1 AND stock_symbol = $2 FOR UPDATE', [sellOrder.user_id, sellOrder.stock_symbol]);
            const sellerAvailable = holding.rows[0]?.quantity ?? 0;
            const buyerAffordable = Math.floor(cents(buyer.balance) / priceCents);
            const requestedQuantity = Math.min(remaining(buyOrder), remaining(sellOrder));
            const quantity = Math.min(requestedQuantity, sellerAvailable, buyerAffordable);
            if (quantity <= 0) {
                const unfillable = sellerAvailable <= 0 ? sellOrder : buyOrder;
                const cancelled = await this.setOrderState(client, unfillable, 0, true);
                await client.query('COMMIT');
                return { executedQuantity: 0, orders: [cancelled, unfillable.id === incoming.id ? resting : incoming] };
            }
            const total = (quantity * priceCents / 100).toFixed(2);
            await client.query('UPDATE users SET balance = balance - $1::numeric WHERE id = $2', [total, buyOrder.user_id]);
            await client.query('UPDATE users SET balance = balance + $1::numeric WHERE id = $2', [total, sellOrder.user_id]);
            await client.query(`INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price)
         VALUES ($1, $2, $3, $4::numeric)
         ON CONFLICT (user_id, stock_symbol) DO UPDATE
         SET avg_buy_price = ((portfolio_holdings.quantity * portfolio_holdings.avg_buy_price) +
             (EXCLUDED.quantity * EXCLUDED.avg_buy_price)) / (portfolio_holdings.quantity + EXCLUDED.quantity),
             quantity = portfolio_holdings.quantity + EXCLUDED.quantity,
             updated_at = NOW()`, [buyOrder.user_id, buyOrder.stock_symbol, quantity, executionPrice]);
            if (sellerAvailable === quantity) {
                await client.query('UPDATE portfolio_holdings SET quantity = 0, avg_buy_price = 0, updated_at = NOW() WHERE user_id = $1 AND stock_symbol = $2', [sellOrder.user_id, sellOrder.stock_symbol]);
            }
            else {
                await client.query('UPDATE portfolio_holdings SET quantity = quantity - $1, updated_at = NOW() WHERE user_id = $2 AND stock_symbol = $3', [quantity, sellOrder.user_id, sellOrder.stock_symbol]);
            }
            const cancelBuyRemainder = quantity < requestedQuantity && buyerAffordable <= quantity;
            const cancelSellRemainder = quantity < requestedQuantity && sellerAvailable <= quantity;
            const updatedBuy = await this.setOrderState(client, buyOrder, quantity, cancelBuyRemainder);
            const updatedSell = await this.setOrderState(client, sellOrder, quantity, cancelSellRemainder);
            await client.query(`INSERT INTO trades (buy_order_id, sell_order_id, stock_symbol, price, quantity)
         VALUES ($1, $2, $3, $4::numeric, $5)`, [buyOrder.id, sellOrder.id, buyOrder.stock_symbol, executionPrice, quantity]);
            await client.query('COMMIT');
            const bookUpdate = {
                symbol: buyOrder.stock_symbol,
                buyOrder: toPublicOrder(updatedBuy),
                sellOrder: toPublicOrder(updatedSell),
                executedQuantity: quantity,
                price: executionPrice,
                timestamp: new Date().toISOString()
            };
            await pubClient.publish(`orderbook:${buyOrder.stock_symbol}`, JSON.stringify(bookUpdate));

            // ── Phase 5: Send trade confirmation emails ────────────────────────────
            // Both buyer and seller receive a confirmation. We fetch their emails
            // from the DB inside the already-open connection (buyer and seller rows
            // are in `users.rows` from the earlier FOR UPDATE select).
            const seller = users.rows.find((u) => u.id === sellOrder.user_id);
            const totalForEmail = quantity * priceCents / 100;

            // Enqueue confirmation for the buyer.
            if (buyer?.email) {
                await enqueueTradeConfirmation({
                    userId: buyOrder.user_id,
                    email:  buyer.email,
                    side:   'buy',
                    stockSymbol: buyOrder.stock_symbol,
                    quantity,
                    price:  Number(executionPrice),
                    total: totalForEmail,
                    orderId: buyOrder.id,
                    executedAt: bookUpdate.timestamp
                }).catch((err) =>
                    // Non-fatal: don't let a queue error roll back a completed trade.
                    console.error('[matching-engine] Failed to enqueue buyer notification:', err.message)
                );
            }

            // Enqueue confirmation for the seller.
            if (seller?.email) {
                await enqueueTradeConfirmation({
                    userId: sellOrder.user_id,
                    email:  seller.email,
                    side:   'sell',
                    stockSymbol: sellOrder.stock_symbol,
                    quantity,
                    price:  Number(executionPrice),
                    total: totalForEmail,
                    orderId: sellOrder.id,
                    executedAt: bookUpdate.timestamp
                }).catch((err) =>
                    console.error('[matching-engine] Failed to enqueue seller notification:', err.message)
                );
            }

            // ── Phase 5: Cancel pending order-expiry delayed jobs ─────────────────
            // If either order is now fully filled, its BullMQ delayed expiry job
            // (scheduled for market close) is no longer needed. Cancel it so we
            // don't try to cancel an already-filled order at close.
            // We fire-and-forget with .catch to keep the hot path clean.
            if (updatedBuy.status === 'filled' || updatedBuy.status === 'cancelled') {
                cancelOrderExpiryJob(updatedBuy.id).catch((err) =>
                    console.error('[matching-engine] Failed to cancel buy order expiry job:', err.message)
                );
            }
            if (updatedSell.status === 'filled' || updatedSell.status === 'cancelled') {
                cancelOrderExpiryJob(updatedSell.id).catch((err) =>
                    console.error('[matching-engine] Failed to cancel sell order expiry job:', err.message)
                );
            }

            // Return the settlement result to the caller (matchOrder loop).
            return { executedQuantity: quantity, orders: [updatedBuy, updatedSell] };
        }

        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
    async setOrderState(client, order, executedQuantity, cancelRemainder) {
        const status = statusAfterFill(order, executedQuantity, cancelRemainder);
        const result = await client.query(`UPDATE orders
       SET filled_quantity = filled_quantity + $1, status = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING id, user_id, stock_symbol, order_type, side, price, quantity, filled_quantity, status`, [executedQuantity, status, order.id]);
        return result.rows[0];
    }
    async cancelOrder(orderId) {
        const result = await this.pool.query(`UPDATE orders SET status = 'cancelled', updated_at = NOW()
       WHERE id = $1 AND status = ANY($2::varchar[])
       RETURNING id, user_id, stock_symbol, order_type, side, price, quantity, filled_quantity, status`, [orderId, OPEN_STATUSES]);
        return result.rows[0] ?? null;
    }
    async syncOrderBook(order) {
        if (!isOpen(order) || order.order_type === 'market' || order.price === null) {
            await this.removeBookEntry(order);
            return;
        }
        const key = this.orderKey(order.id);
        let member = await this.redis.hget(key, 'bookMember');
        if (!member) {
            const sequence = await this.redis.incr(`ORDER_SEQUENCE:${order.stock_symbol}`);
            member = `${String(sequence).padStart(20, '0')}:${order.id}`;
        }
        const price = cents(order.price);
        await this.redis.multi()
            .hset(key, {
            id: order.id,
            userId: order.user_id,
            symbol: order.stock_symbol,
            side: order.side,
            price: order.price,
            quantity: String(order.quantity),
            filledQuantity: String(order.filled_quantity),
            remaining: String(remaining(order)),
            status: order.status,
            bookMember: member
        })
            // Bids use an inverted score so ZRANGE returns the highest price first;
            // zero-padded sequence members preserve FIFO at an equal price.
            .zadd(this.bookKey(order.stock_symbol, order.side), order.side === 'buy' ? -price : price, member)
            .exec();
    }
    async removeBookEntry(order) {
        const key = this.orderKey(order.id);
        const member = await this.redis.hget(key, 'bookMember');
        const pipeline = this.redis.multi();
        if (member)
            pipeline.zrem(this.bookKey(order.stock_symbol, order.side), member);
        pipeline.del(key);
        await pipeline.exec();
    }
    async acquireStockLock(symbol, timeoutMs = 5000) {
        const token = randomUUID();
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const result = await this.redis.set(`MATCH_LOCK:${symbol}`, token, 'PX', 30_000, 'NX');
            if (result === 'OK')
                return token;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }
    async releaseStockLock(symbol, token) {
        await this.redis.eval(lockReleaseScript, 1, `MATCH_LOCK:${symbol}`, token);
    }
}
