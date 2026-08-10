/*
    Bot Service — Trend Follower Strategy

    Purpose:
    The Trend Follower (whitepaper §10.2) buys when the price is rising and
    sells when it is falling, creating price momentum in the simulated market.

    Behaviour:
    - Maintains a rolling window of recent trade prices (`TREND_WINDOW`).
    - Computes a short moving average (the most recent half of the window)
      and a long moving average (the full window).
    - If the short average is above the long average, the bot perceives an
      uptrend and places a BUY order. If below, it perceives a downtrend and
      places a SELL order.
    - Until enough samples are collected (`TREND_MIN_SAMPLES`), the bot falls
      back to a neutral limit order at fair value so it still contributes
      liquidity while warming up.

    Design rationale:
    - Comparing a short vs long moving average is a classic, simple momentum
      signal that is easy to reason about and produces realistic trending
      behaviour.
    - The rolling window keeps memory bounded and lets the strategy adapt to
      changing market conditions.
*/
import { average, randomInt, roundPrice } from './utils.js';

/**
 * Create a Trend Follower strategy instance.
 *
 * @param {object} config - The bot service configuration (see config.js).
 * @returns {{ decide: (context: object) => object | null }} A strategy object.
 */
export function createTrendFollower(config) {
    // Rolling window of recent trade prices, oldest first.
    const priceHistory = [];

    return {
        /**
         * Produce an order decision for the current tick.
         *
         * @param {object} context - Strategy context.
         * @param {number} context.fairValue - Current fair value for the symbol.
         * @param {number | null} [context.lastPrice] - Last observed trade price.
         * @param {() => number} [context.random] - Random source in [0, 1).
         * @returns {object | null} An order decision `{ side, orderType, price, quantity }`.
         */
        decide({ fairValue, lastPrice = null, random = Math.random }) {
            // Record the latest observed price to feed the moving averages.
            if (lastPrice !== null && Number.isFinite(lastPrice)) {
                priceHistory.push(lastPrice);
                // Keep the window bounded.
                if (priceHistory.length > config.TREND_WINDOW) {
                    priceHistory.shift();
                }
            }

            // Not enough data yet: place a neutral limit order at fair value
            // so the bot still provides liquidity while warming up.
            if (priceHistory.length < config.TREND_MIN_SAMPLES) {
                const side = random() < 0.5 ? 'buy' : 'sell';
                return {
                    side,
                    orderType: 'limit',
                    price: roundPrice(fairValue),
                    quantity: randomInt(config.MIN_ORDER_QUANTITY, config.MAX_ORDER_QUANTITY, random)
                };
            }

            // Compute short (recent half) and long (full window) moving averages.
            const shortWindow = Math.max(1, Math.floor(config.TREND_WINDOW / 2));
            const shortMA = average(priceHistory.slice(-shortWindow));
            const longMA = average(priceHistory);

            // Uptrend -> buy; downtrend -> sell.
            const side = shortMA >= longMA ? 'buy' : 'sell';

            // Price the order slightly in the direction of the trend, within a
            // fraction of the variance, to improve fill probability.
            const direction = side === 'buy' ? -1 : 1;
            const price = roundPrice(fairValue * (1 + direction * config.PRICE_VARIANCE * 0.5));

            const orderType = random() < config.MARKET_ORDER_PROBABILITY ? 'market' : 'limit';
            const quantity = randomInt(config.MIN_ORDER_QUANTITY, config.MAX_ORDER_QUANTITY, random);

            return { side, orderType, price, quantity };
        }
    };
}