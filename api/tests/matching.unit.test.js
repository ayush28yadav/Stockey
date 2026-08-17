// Unit tests: matching engine self-trade prevention
// Purpose: verify that the matching engine never selects a resting order owned
// by the taker's own account (wash trading) and that self-only liquidity
// yields no match. These tests run without Redis/Postgres — the engine is fed
// fake clients.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.API_ORIGIN = 'http://localhost:4000';
process.env.SESSION_SECRET = '01234567890123456789012345678901';
process.env.JWT_PRIVATE_KEY_BASE64 = Buffer.from('private').toString('base64');
process.env.JWT_PUBLIC_KEY_BASE64 = Buffer.from('public').toString('base64');

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MatchingEngine } from '../src/matching/matching-engine.js';

function makeOrder(id, userId, side, price) {
    return {
        id,
        user_id: userId,
        stock_symbol: 'AAPL',
        order_type: 'limit',
        side,
        price,
        quantity: 10,
        filled_quantity: 0,
        status: 'open'
    };
}

function makeRedis(membersByKey) {
    return {
        zrange: async (key, start, stop) => (membersByKey[key] ?? []).slice(start, stop + 1),
        zrem: async () => 1,
        hget: async () => null,
        incr: async () => 1,
        multi: () => ({ hset: () => {}, zadd: () => {}, exec: async () => [] })
    };
}

function makePool(orders) {
    return {
        query: async (_sql, params) => ({ rows: orders.filter((order) => order.id === params[0]) })
    };
}

test('bestOppositeOrder skips the taker\'s own resting orders', async () => {
    const mine = makeOrder('own-ask', 'user-a', 'sell', 100);
    const others = makeOrder('other-ask', 'user-b', 'sell', 100);
    const orders = [mine, others];

    const engine = new MatchingEngine(
        makeRedis({ 'ASKS:AAPL': ['1:own-ask', '2:other-ask'] }),
        makePool(orders)
    );

    const selected = await engine.bestOppositeOrder('AAPL', 'buy', 'user-a');
    assert.ok(selected, 'expected an opposing order to match');
    assert.equal(selected.user_id, 'user-b', 'must not choose the taker\'s own order');
});

test('bestOppositeOrder returns null when only the taker\'s own liquidity exists', async () => {
    const mine = makeOrder('own-ask', 'user-a', 'sell', 100);
    const engine = new MatchingEngine(
        makeRedis({ 'ASKS:AAPL': ['1:own-ask'] }),
        makePool([mine])
    );

    const selected = await engine.bestOppositeOrder('AAPL', 'buy', 'user-a');
    assert.equal(selected, null, 'self-only liquidity must not produce a match');
});

test('bestOppositeOrder returns the best opposite order when no exclusion applies', async () => {
    const first = makeOrder('ask-1', 'user-a', 'sell', 100);
    const second = makeOrder('ask-2', 'user-b', 'sell', 100);
    const engine = new MatchingEngine(
        makeRedis({ 'ASKS:AAPL': ['1:ask-1', '2:ask-2'] }),
        makePool([first, second])
    );

    const selected = await engine.bestOppositeOrder('AAPL', 'buy', 'user-c');
    assert.equal(selected.id, 'ask-1', 'best price-time order should win');
});