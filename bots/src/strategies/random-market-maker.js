/*
    Bot Service — Random Market Maker Strategy

    Purpose:
    The Random Market Maker is the default bot behaviour described in the
    whitepaper (§10.2). It places both bid and ask orders within a spread
    around the current fair value, maintaining a healthy, liquid order book.

    Behaviour:
    - On each tick, randomly chooses to buy or sell.
    - Prices are offset from fair value by a random amount within
      `PRICE_VARIANCE` (e.g. 0.5%). A buy is priced slightly below fair value;
      a sell slightly above, creating a natural bid/ask spread.
    - Order type (market vs limit) is chosen with probability
      `MARKET_ORDER_PROBABILITY`.
    - Quantity is a random integer within `[MIN_ORDER_QUANTITY, MAX_ORDER_QUANTITY]`.

    Design rationale:
    - The symmetric random offset around fair value ensures the bot provides
      liquidity on both sides of the book, which is the defining trait of a
      market maker.
    - Because the offset is bounded by PRICE_VARIANCE, the bot never places
      wildly off-market orders that would distort the book.
*/
import { pickRandom, randomInt, roundPrice } from './utils.js';

/**
 * Create a Random Market Maker strategy instance.
 *
 * @param {object} config - The bot service configuration (see config.js).
 * @returns {{ decide: (context: object) => object | null }} A strategy object.
 */
export function createRandomMarketMaker(config) {
    return {
        /**
         * Produce an order decision for the current tick.
         *
         * @param {object} context - Strategy context.
         * @param {number} context.fairValue - Current fair value for the symbol.
         * @param {() => number} [context.random] - Random source in [0, 1).
         * @returns {object | null} An order decision `{ side, orderType, price, quantity }`.
         */
        decide({ fairValue, random = Math.random }) {
            // Randomly pick a side: buy or sell with equal probability.
            const side = pickRandom(['buy', 'sell'], random);

            // Offset the price from fair value within the configured variance.
            // Buyers bid below fair value; sellers ask above it.
            const offset = (random() * 2 - 1) * config.PRICE_VARIANCE;
            const price = roundPrice(fairValue * (1 + offset));

            // Choose order type based on the market-order probability.
            const orderType = random() < config.MARKET_ORDER_PROBABILITY ? 'market' : 'limit';

            // Random quantity within the configured range.
            const quantity = randomInt(config.MIN_ORDER_QUANTITY, config.MAX_ORDER_QUANTITY, random);

            return { side, orderType, price, quantity };
        }
    };
}