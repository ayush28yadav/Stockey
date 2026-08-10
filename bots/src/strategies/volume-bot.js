/*
    Bot Service — Volume Bot Strategy

    Purpose:
    The Volume Bot (whitepaper §10.2) places large orders at random intervals
    to stress-test the matching engine and create realistic bursts of market
    activity.

    Behaviour:
    - On each tick, with probability `VOLUME_ORDER_PROBABILITY`, places a
      large order (quantity in `[VOLUME_MIN_QUANTITY, VOLUME_MAX_QUANTITY]`).
    - Randomly chooses buy or sell.
    - Prices are offset from fair value within `PRICE_VARIANCE` (same as the
      market maker) so the large orders are still reasonably priced.
    - Order type is chosen with `MARKET_ORDER_PROBABILITY`; market orders
      from a volume bot are especially effective at consuming liquidity.

    Design rationale:
    - Large orders create temporary imbalances in the order book, which the
      matching engine must handle correctly (partial fills, multiple matches
      against smaller resting orders). This exercises the engine's edge cases.
    - The probabilistic firing means volume bursts are irregular, mimicking
      real institutional trading patterns.
*/
import { pickRandom, randomInt, roundPrice } from './utils.js';

/**
 * Create a Volume Bot strategy instance.
 *
 * @param {object} config - The bot service configuration (see config.js).
 * @returns {{ decide: (context: object) => object | null }} A strategy object.
 */
export function createVolumeBot(config) {
    return {
        /**
         * Produce an order decision for the current tick.
         *
         * @param {object} context - Strategy context.
         * @param {number} context.fairValue - Current fair value for the symbol.
         * @param {() => number} [context.random] - Random source in [0, 1).
         * @returns {object | null} An order decision, or null to skip this tick.
         */
        decide({ fairValue, random = Math.random }) {
            // Only fire with the configured probability; otherwise stay quiet.
            if (random() >= config.VOLUME_ORDER_PROBABILITY) {
                return null;
            }

            // Randomly pick a side.
            const side = pickRandom(['buy', 'sell'], random);

            // Offset the price from fair value within the configured variance.
            const offset = (random() * 2 - 1) * config.PRICE_VARIANCE;
            const price = roundPrice(fairValue * (1 + offset));

            // Choose order type based on the market-order probability.
            const orderType = random() < config.MARKET_ORDER_PROBABILITY ? 'market' : 'limit';

            // Large quantity within the volume range.
            const quantity = randomInt(config.VOLUME_MIN_QUANTITY, config.VOLUME_MAX_QUANTITY, random);

            return { side, orderType, price, quantity };
        }
    };
}