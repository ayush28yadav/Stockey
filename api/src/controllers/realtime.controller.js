import { pool } from '../db.js';
import { redisClient } from '../redis.js';

// Mirrors the DB symbol constraint. Keeps arbitrary strings from reaching
// Redis key lookups (resource exhaustion / cache poisoning resistance).
const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.]{0,15}$/;

function parseSymbol(raw) {
    const symbol = String(raw ?? '').trim().toUpperCase();
    return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

function parseRedisBookMember(member) {
  const separator = member.indexOf(':');
  const score = Number(member.slice(0, separator));
  const orderId = member.slice(separator + 1);
  return { orderId, score };
}

function orderBookEntry(orderHash, side, score) {
  return {
    id: orderHash.id,
    stockSymbol: orderHash.symbol,
    side,
    price: Number(orderHash.price),
    remaining: Number(orderHash.remaining),
    status: orderHash.status,
    score
  };
}

export async function getOrderBookSnapshot(request, response, next) {
  try {
    const symbol = parseSymbol(request.params.symbol);
    if (!symbol)
      return response.status(400).json({ error: 'INVALID_SYMBOL' });
    const bidsKey = `BIDS:${symbol}`;
    const asksKey = `ASKS:${symbol}`;
    const bidMembers = await redisClient.zRange(bidsKey, 0, 99);
    const askMembers = await redisClient.zRange(asksKey, 0, 99);

    const bids = (await Promise.all(bidMembers.map(async (member) => {
      const { orderId, score } = parseRedisBookMember(member);
      const orderHash = await redisClient.hGetAll(`ORDER:${orderId}`);
      if (!orderHash?.id)
        return null;
      return orderBookEntry(orderHash, 'buy', score);
    }))).filter(Boolean);

    const asks = (await Promise.all(askMembers.map(async (member) => {
      const { orderId, score } = parseRedisBookMember(member);
      const orderHash = await redisClient.hGetAll(`ORDER:${orderId}`);
      if (!orderHash?.id)
        return null;
      return orderBookEntry(orderHash, 'sell', score);
    }))).filter(Boolean);

    return response.json({ symbol, bids, asks });
  }
  catch (error) {
    return next(error);
  }
}

export async function getTradeTape(request, response, next) {
  try {
    const symbol = parseSymbol(request.params.symbol);
    if (!symbol)
      return response.status(400).json({ error: 'INVALID_SYMBOL' });
    const result = await pool.query(`SELECT id, buy_order_id, sell_order_id, stock_symbol, price, quantity, executed_at AS created_at
      FROM trades WHERE stock_symbol = $1 ORDER BY executed_at DESC LIMIT 50`, [symbol]);
    return response.json({ symbol, trades: result.rows });
  }
  catch (error) {
    return next(error);
  }
}

// A compact market watch endpoint. Trades are the source of truth for the
// current price in this simulated exchange; symbols with resting orders are
// included too, even before their first execution.
export async function getStocks(_request, response, next) {
  try {
    const result = await pool.query(`
      WITH symbols AS (
        SELECT stock_symbol FROM orders
        UNION
        SELECT stock_symbol FROM trades
      )
      SELECT
        s.stock_symbol AS symbol,
        latest.price AS "lastPrice",
        latest.executed_at AS "updatedAt"
      FROM symbols s
      LEFT JOIN LATERAL (
        SELECT price, executed_at
        FROM trades
        WHERE stock_symbol = s.stock_symbol
        ORDER BY executed_at DESC
        LIMIT 1
      ) latest ON true
      ORDER BY s.stock_symbol
    `);

    return response.json({
      stocks: result.rows.map((row) => ({
        symbol: row.symbol,
        lastPrice: row.lastPrice === null ? null : Number(row.lastPrice),
        updatedAt: row.updatedAt
      }))
    });
  }
  catch (error) {
    return next(error);
  }
}

export { pool, redisClient };
