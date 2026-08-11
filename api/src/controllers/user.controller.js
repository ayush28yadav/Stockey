/*
    Controller: User

    Purpose: user-facing endpoints for profile, portfolio holdings, and
    trade history. Keep controllers focused on shaping responses and
    delegating DB access to `pool`.

    Phase 5 additions:
    - `getPortfolio` — returns holdings enriched with last-traded price and
       live unrealised P&L. This is the same calculation the daily-pnl-summary
       email job performs internally, exposed as a REST endpoint so the Phase 6
       frontend can display live portfolio values.
    - `getTradeHistory` — returns the user's own executed trades (buy + sell
       sides) ordered by most recent first.
*/
import { pool } from '../db.js';

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/me
// ─────────────────────────────────────────────────────────────────────────────

export async function getCurrentUser(request, response, next) {
    try {
        // Retrieve minimal user fields. Never expose password_hash or oauth_id.
        const result = await pool.query(
            'SELECT id, email, oauth_provider, balance, created_at FROM users WHERE id = $1',
            [request.auth.userId]
        );
        if (!result.rows[0])
            return response.status(404).json({ error: 'USER_NOT_FOUND' });
        return response.json({ user: { ...result.rows[0], oauthProvider: result.rows[0].oauth_provider } });
    }
    catch (error) {
        return next(error);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/portfolio
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the authenticated user's portfolio: cash balance + all holdings with
 * live unrealised P&L.
 *
 * For each holding we join against the `trades` table to find the most recent
 * execution price for that stock (used as the "current price" for P&L
 * calculation). In a production system this would come from a dedicated market
 * data service; for the demo, last-traded price is a good approximation.
 *
 * Response shape:
 * {
 *   cashBalance: number,
 *   totalPnl: number,
 *   holdings: [
 *     {
 *       stockSymbol: string,
 *       quantity: number,
 *       avgBuyPrice: number,
 *       currentPrice: number,   // last traded price
 *       marketValue: number,    // currentPrice × quantity
 *       pnl: number             // (currentPrice − avgBuyPrice) × quantity
 *     }
 *   ]
 * }
 */
export async function getPortfolio(request, response, next) {
    try {
        const userId = request.auth.userId;

        // ── 1. Fetch user's cash balance ───────────────────────────────────
        const userResult = await pool.query(
            'SELECT balance FROM users WHERE id = $1',
            [userId]
        );
        if (!userResult.rows[0])
            return response.status(404).json({ error: 'USER_NOT_FOUND' });
        const cashBalance = Number(userResult.rows[0].balance);

        // ── 2. Fetch all holdings where quantity > 0 ───────────────────────
        const holdingsResult = await pool.query(
            `SELECT stock_symbol, quantity, avg_buy_price
             FROM portfolio_holdings
             WHERE user_id = $1 AND quantity > 0
             ORDER BY stock_symbol`,
            [userId]
        );

        // ── 3. Enrich each holding with last-traded price and P&L ─────────
        // We run one query per holding (small N). A LATERAL JOIN or a single
        // DISTINCT ON query would be more efficient for large portfolios.
        const holdings = await Promise.all(holdingsResult.rows.map(async (h) => {
            const priceResult = await pool.query(
                `SELECT price FROM trades
                 WHERE stock_symbol = $1
                 ORDER BY executed_at DESC
                 LIMIT 1`,
                [h.stock_symbol]
            );

            // Fall back to average buy price if no trades exist yet for this stock.
            const currentPrice = Number(priceResult.rows[0]?.price ?? h.avg_buy_price);
            const qty = Number(h.quantity);
            const avgBuyPrice = Number(h.avg_buy_price);

            // Unrealised P&L: how much you would gain/lose if you sold now.
            const pnl = (currentPrice - avgBuyPrice) * qty;
            const marketValue = currentPrice * qty;

            return {
                stockSymbol: h.stock_symbol,
                quantity: qty,
                avgBuyPrice,
                currentPrice,
                marketValue,
                pnl
            };
        }));

        // ── 4. Total unrealised P&L across all holdings ───────────────────
        const totalPnl = holdings.reduce((sum, h) => sum + h.pnl, 0);

        return response.json({ cashBalance, totalPnl, holdings });
    }
    catch (error) {
        return next(error);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/users/portfolio/history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return the authenticated user's trade history — every trade where they were
 * either the buyer or the seller, most recent first.
 *
 * We join the orders table twice (aliased as buy_orders and sell_orders) to
 * determine which side the authenticated user was on.
 *
 * Response shape:
 * {
 *   trades: [
 *     {
 *       id, stockSymbol, side, price, quantity, total, executedAt
 *     }
 *   ]
 * }
 */
export async function getTradeHistory(request, response, next) {
    try {
        const userId = request.auth.userId;

        const result = await pool.query(
            `SELECT
               t.id,
               t.stock_symbol     AS "stockSymbol",
               t.price,
               t.quantity,
               -- Determine which side the requesting user was on.
               -- If their user_id matches the buy order's user_id → 'buy', else 'sell'.
               CASE WHEN bo.user_id = $1 THEN 'buy' ELSE 'sell' END AS side,
               -- Total value of this trade from the user's perspective.
               (t.price * t.quantity)::NUMERIC(15,2)                 AS total,
               t.executed_at      AS "executedAt"
             FROM trades t
             JOIN orders bo ON bo.id = t.buy_order_id
             JOIN orders so ON so.id = t.sell_order_id
             -- Only return trades the requesting user participated in.
             WHERE bo.user_id = $1 OR so.user_id = $1
             ORDER BY t.executed_at DESC
             LIMIT 200`,
            [userId]
        );

        return response.json({
            trades: result.rows.map((r) => ({
                id: r.id,
                stockSymbol: r.stockSymbol,
                side: r.side,
                price: Number(r.price),
                quantity: Number(r.quantity),
                total: Number(r.total),
                executedAt: r.executedAt
            }))
        });
    }
    catch (error) {
        return next(error);
    }
}

