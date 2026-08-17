// Phase 5 integration tests: Notifications & Scheduled Jobs
// Purpose: verify OTP flow, trade confirmation emails, order expiry
// scheduling, scheduler registration, and portfolio endpoint.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, test } from 'node:test';
import { createClient } from 'redis';
import { pool } from '../src/db.js';
import { config } from '../src/config.js';

const apiOrigin = process.env.API_BASE_URL ?? 'http://localhost:4000';

function jsonRequest(path, init = {}) {
  return fetch(`${apiOrigin}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init.headers }
  });
}

async function waitFor(condition, timeout = 10000, interval = 200) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await condition()) return true;
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return false;
}

function uniqueSymbol() {
  return `TST${randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase()}`;
}

const redis = createClient({ url: config.REDIS_URL });
await redis.connect();

before(async () => {
  const health = await fetch(`${apiOrigin}/health`);
  assert.equal(health.status, 200, `API unavailable at ${apiOrigin}`);
});

after(async () => {
  await pool.query('DELETE FROM notification_log WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['phase5-%']);
  await pool.query('DELETE FROM order_expiry_jobs WHERE order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))', ['phase5-%']);
  await pool.query('DELETE FROM trades WHERE buy_order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)) OR sell_order_id IN (SELECT id FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1))', ['phase5-%']);
  await pool.query('DELETE FROM orders WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['phase5-%']);
  await pool.query('DELETE FROM portfolio_holdings WHERE user_id IN (SELECT id FROM users WHERE email LIKE $1)', ['phase5-%']);
  await pool.query('DELETE FROM users WHERE email LIKE $1', ['phase5-%']);
  await pool.end();
  await redis.quit();
});

async function createUser(email, password = 'phase5-test-password') {
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

test('OTP: sends a 6-digit code and verifies it successfully', async () => {
  const email = `phase5-otp-${randomUUID()}@example.test`;
  const user = await createUser(email);

  const sendResponse = await jsonRequest('/api/auth/otp/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${user.accessToken}` },
    body: JSON.stringify({ action: 'withdraw funds' })
  });
  assert.equal(sendResponse.status, 204);

  const storedPayload = await redis.get(`OTP:${user.userId}`);
  assert.ok(storedPayload, 'OTP should be stored in Redis');
  const storedOtp = JSON.parse(storedPayload).otp;
  assert.match(storedOtp, /^\d{6}$/, 'OTP should be 6 digits');
  // The stored record is action-bound so a code minted for one operation
  // cannot be replayed against another.
  assert.equal(JSON.parse(storedPayload).action, 'withdraw funds');

  const verifyResponse = await jsonRequest('/api/auth/otp/verify', {
    method: 'POST',
    headers: { authorization: `Bearer ${user.accessToken}` },
    body: JSON.stringify({ otp: storedOtp })
  });
  assert.equal(verifyResponse.status, 200);
  const verifyBody = await verifyResponse.json();
  assert.equal(verifyBody.success, true);

  const deletedOtp = await redis.get(`OTP:${user.userId}`);
  assert.equal(deletedOtp, null, 'OTP should be deleted after successful verification');
});

test('OTP: rejects an invalid OTP code', async () => {
  const email = `phase5-otp-invalid-${randomUUID()}@example.test`;
  const user = await createUser(email);

  await jsonRequest('/api/auth/otp/send', {
    method: 'POST',
    headers: { authorization: `Bearer ${user.accessToken}` },
    body: JSON.stringify({ action: 'test' })
  });

  const response = await jsonRequest('/api/auth/otp/verify', {
    method: 'POST',
    headers: { authorization: `Bearer ${user.accessToken}` },
    body: JSON.stringify({ otp: '000000' })
  });
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'OTP_INVALID');
});

test('Trade confirmation: logs a notification after a matched trade', async () => {
  const symbol = uniqueSymbol();
  const sellerEmail = `phase5-trade-seller-${randomUUID()}@example.test`;
  const buyerEmail = `phase5-trade-buyer-${randomUUID()}@example.test`;

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
  }, 10000);

  assert.ok(matched, 'Orders did not match within timeout');

  const sellerLogged = await waitFor(async () => {
    const result = await pool.query(
      'SELECT * FROM notification_log WHERE user_id = $1 AND notification_type = $2',
      [seller.userId, 'trade-confirmation']
    );
    return result.rowCount >= 1;
  }, 10000);
  assert.ok(sellerLogged, 'Seller should have a trade-confirmation log entry');

  const buyerLogged = await waitFor(async () => {
    const result = await pool.query(
      'SELECT * FROM notification_log WHERE user_id = $1 AND notification_type = $2',
      [buyer.userId, 'trade-confirmation']
    );
    return result.rowCount >= 1;
  }, 10000);
  assert.ok(buyerLogged, 'Buyer should have a trade-confirmation log entry');
});

test('Order expiry: schedules a delayed job for a limit order', async () => {
  const symbol = uniqueSymbol();
  const userEmail = `phase5-expiry-${randomUUID()}@example.test`;
  const user = await createUser(userEmail);

  const order = await placeOrder(user.accessToken, {
    stockSymbol: symbol,
    orderType: 'limit',
    side: 'buy',
    price: 100,
    quantity: 10
  });

  const jobs = await pool.query(
    'SELECT * FROM order_expiry_jobs WHERE order_id = $1',
    [order.order.id]
  );
  assert.equal(jobs.rowCount, 1, 'order_expiry_jobs should have one row for the new limit order');
  assert.ok(jobs.rows[0].bullmq_job_id.startsWith('order-expiry:'), 'bullmq_job_id should follow the expected pattern');
  assert.ok(new Date(jobs.rows[0].scheduled_for).getTime() > Date.now(), 'scheduled_for should be in the future');
});

test('Scheduler: registers repeatable jobs in BullMQ', async () => {
  const type = await redis.type('bull:scheduled-jobs:repeat');
  assert.ok(type === 'hash' || type === 'zset', 'scheduled-jobs repeat key should exist as a BullMQ data structure');

  const keys = await redis.keys('bull:scheduled-jobs:repeat:*');
  assert.ok(keys.length >= 2, 'should have at least 2 repeatable job keys (market-open and market-close)');
});

test('Portfolio: getPortfolio returns holdings and cash balance', async () => {
  const symbol = uniqueSymbol();
  const userEmail = `phase5-portfolio-${randomUUID()}@example.test`;
  const user = await createUser(userEmail);

  await pool.query(
    'INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price) VALUES ($1, $2, $3, $4)',
    [user.userId, symbol, 50, 200]
  );

  const response = await jsonRequest('/api/users/portfolio', {
    headers: { authorization: `Bearer ${user.accessToken}` }
  });
  assert.equal(response.status, 200);
  const body = await response.json();

  assert.ok(Array.isArray(body.holdings), 'holdings should be an array');
  assert.equal(body.holdings.length, 1, 'should have one holding');
  assert.equal(body.holdings[0].stockSymbol, symbol);
  assert.equal(body.holdings[0].quantity, 50);
  assert.ok(typeof body.cashBalance === 'number', 'cashBalance should be a number');
});
