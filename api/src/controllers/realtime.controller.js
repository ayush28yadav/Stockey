import { pool } from '../db.js';
import { redisClient } from '../redis.js';

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
    userId: orderHash.userId,
    score
  };
}

export async function getOrderBookSnapshot(request, response, next) {
  try {
    const symbol = request.params.symbol.toUpperCase();
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
    const symbol = request.params.symbol.toUpperCase();
    const result = await pool.query(`SELECT id, buy_order_id, sell_order_id, stock_symbol, price, quantity, executed_at AS created_at
      FROM trades WHERE stock_symbol = $1 ORDER BY executed_at DESC LIMIT 50`, [symbol]);
    return response.json({ symbol, trades: result.rows });
  }
  catch (error) {
    return next(error);
  }
}

export { pool, redisClient };
