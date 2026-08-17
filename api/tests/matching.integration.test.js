// Integration tests: matching engine
// Purpose: end-to-end tests that exercise order submission, queueing,
// matching and trade settlement using a running API + Redis + Postgres
// stack. These tests are intentionally slow and should be run in CI or
// a local docker environment where services are available.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { pool } from '../src/db.js';

const apiOrigin = process.env.API_BASE_URL ?? 'http://localhost:4000';
const password = 'integration-test-password';

function uniqueSymbol() {
    const id = randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase();
    return `SYM${id}`;
}

function jsonRequest(path, init = {}) {
  return fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

async function waitFor(condition, timeout = 10000, interval = 100) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

async function createUser(email) {
  const response = await jsonRequest('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
  assert.equal(userResult.rowCount, 1);
  return { accessToken: body.accessToken, userId: userResult.rows[0].id };
}

async function placeOrder(token, order) {
  const response = await jsonRequest('/api/orders', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': randomUUID() },
    body: JSON.stringify(order)
  });
  assert.equal(response.status, 201);
  return await response.json();
}

async function orderStatus(orderId) {
  const result = await pool.query('SELECT status FROM orders WHERE id = $1', [orderId]);
  return result.rows[0]?.status ?? null;
}

before(async () => {
  const health = await fetch(`${apiOrigin}/health`);
  assert.equal(health.status, 200, `API unavailable at ${apiOrigin}`);
});

after(async () => {
  await pool.query('DELETE FROM trades WHERE buy_order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)) OR sell_order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))', ['integration-matching-%']);
  await pool.query('DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['integration-matching-%']);
  await pool.query('DELETE FROM portfolio_holdings WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['integration-matching-%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['integration-matching-%']);
  await pool.end();
});

test('matches limit buy and sell orders end to end', async () => {
    const symbol = uniqueSymbol();
    const sellerEmail = `integration-matching-seller-${randomUUID()}@example.test`;
    const buyerEmail = `integration-matching-buyer-${randomUUID()}@example.test`;

  const seller = await createUser(sellerEmail);
  const buyer = await createUser(buyerEmail);

  await pool.query(
    'INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price) VALUES ($1, $2, $3, $4)',
    [seller.userId, symbol, 100, 100]
  );

  const sellOrder = await placeOrder(seller.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'sell',
    price: 100,
    quantity: 10
  });

  const buyOrder = await placeOrder(buyer.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'buy',
    price: 100,
    quantity: 10
  });

  const matched = await waitFor(async () => {
    const sellStatus = await orderStatus(sellOrder.order.id);
    const buyStatus = await orderStatus(buyOrder.order.id);
    return sellStatus === 'filled' && buyStatus === 'filled';
  }, 8000);

  assert(matched, 'Orders did not match within timeout');

  const trades = await pool.query('SELECT * FROM trades WHERE buy_order_id = $1 AND sell_order_id = $2', [buyOrder.order.id, sellOrder.order.id]);
  assert.equal(trades.rowCount, 1);
  assert.equal(trades.rows[0].quantity, 10);
  assert.equal(Number(trades.rows[0].price), 100);
});

test('partially fills a large limit buy order against smaller sell liquidity', async () => {
    const symbol = uniqueSymbol();
    const sellerEmail = `integration-matching-seller-${randomUUID()}@example.test`;
    const buyerEmail = `integration-matching-buyer-${randomUUID()}@example.test`;

  const seller = await createUser(sellerEmail);
  const buyer = await createUser(buyerEmail);

  await pool.query(
    'INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price) VALUES ($1, $2, $3, $4)',
    [seller.userId, symbol, 5, 100]
  );

  const sellOrder = await placeOrder(seller.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'sell',
    price: 100,
    quantity: 5
  });

  const buyOrder = await placeOrder(buyer.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'buy',
    price: 100,
    quantity: 10
  });

  const matched = await waitFor(async () => {
    const sellStatus = await orderStatus(sellOrder.order.id);
    const buyStatus = await orderStatus(buyOrder.order.id);
    return sellStatus === 'filled' && buyStatus === 'partially_filled';
  }, 8000);

  assert(matched, 'Partial match did not complete within timeout');

  const tradeResult = await pool.query('SELECT * FROM trades WHERE buy_order_id = $1 AND sell_order_id = $2', [buyOrder.order.id, sellOrder.order.id]);
  assert.equal(tradeResult.rowCount, 1);
  assert.equal(tradeResult.rows[0].quantity, 5);
});

test('does not match a user against their own orders (no wash trading)', async () => {
    const symbol = uniqueSymbol();
    const traderEmail = `integration-matching-self-${randomUUID()}@example.test`;
    const trader = await createUser(traderEmail);

  await pool.query(
    'INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price) VALUES ($1, $2, $3, $4)',
    [trader.userId, symbol, 100, 100]
  );

  const sellOrder = await placeOrder(trader.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'sell',
    price: 100,
    quantity: 10
  });

  const buyOrder = await placeOrder(trader.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'buy',
    price: 100,
    quantity: 10
  });

  // Give the matching worker time to try (and refuse) to match the pair.
  const processed = await waitFor(async () => {
    const sellStatus = await orderStatus(sellOrder.order.id);
    const buyStatus = await orderStatus(buyOrder.order.id);
    return sellStatus !== null && buyStatus !== null;
  }, 8000);

  assert(processed, 'Orders were not processed within timeout');

  const trades = await pool.query(
    'SELECT * FROM trades WHERE (buy_order_id = $1 AND sell_order_id = $2) OR (buy_order_id = $2 AND sell_order_id = $1)',
    [buyOrder.order.id, sellOrder.order.id]
  );
  assert.equal(trades.rowCount, 0, 'an account must never settle against its own orders');
});

test('cancels market orders when no opposite liquidity exists', async () => {
    const symbol = uniqueSymbol();
    const buyerEmail = `integration-matching-buyer-${randomUUID()}@example.test`;
  const buyer = await createUser(buyerEmail);

  const buyOrder = await placeOrder(buyer.accessToken, {
    stockSymbol: symbol,
    orderType: 'market',
    side: 'buy',
    quantity: 10
  });

  const cancelled = await waitFor(async () => (await orderStatus(buyOrder.order.id)) === 'cancelled', 8000);
  assert(cancelled, 'Market order was not cancelled without liquidity');

  const trades = await pool.query('SELECT * FROM trades WHERE buy_order_id = $1', [buyOrder.order.id]);
  assert.equal(trades.rowCount, 0);
});
