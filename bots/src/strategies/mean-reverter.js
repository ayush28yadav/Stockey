/*
    Bot Service — Mean Reverter Strategy

    Purpose:
    The Mean Reverter (whitepaper §10.2) buys when the price dips below its
    recent average and sells when it rises above, stabilising extreme price
    swings in the simulated market.

    Behaviour:
    - Maintains a rolling window of recent trade prices (`MEAN_WINDOW`).
    - Computes the mean of that window.
    - Measures the deviation of the current fair value from the mean:
          deviation = (fairValue - mean) / mean
    - If deviation < -MEAN_THRESHOLD  -> price is below average -> BUY.
    - If deviation >  MEAN_THRESHOLD  -> price is above average -> SELL.
    - Otherwise the price is within the normal band; the bot does nothing
      this tick (returns null).
    - Until enough samples are collected (`MEAN_MIN_SAMPLES`), the bot places
      a neutral limit order at fair value to contribute liquidity.

    Design rationale:
    - Mean reversion is the natural counterpart to trend following; together
      they create a balanced market that neither trends away uncontrollably
      nor stays perfectly flat.
    - The threshold prevents the bot from overtrading on tiny deviations.
*/
import { average, randomInt, roundPrice } from './utils.js';

/**
 * Create a Mean Reverter strategy instance.
 *
 * @param {object} config - The bot service configuration (see config.js).
 * @returns {{ decide: (context: object) => object | null }} A strategy object.
 */
export function createMeanReverter(config) {
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
         * @returns {object | null} An order decision, or null to skip this tick.
         */
        decide({ fairValue, lastPrice = null, random = Math.random }) {
            // Record the latest observed price to feed the moving average.
            if (lastPrice !== null && Number.isFinite(lastPrice)) {
                priceHistory.push(lastPrice);
                // Keep the window bounded.
                if (priceHistory.length > config.MEAN_WINDOW) {
                    priceHistory.shift();
                }
            }

            // Not enough data yet: place a neutral limit order at fair value.
            if (priceHistory.length < config.MEAN_MIN_SAMPLES) {
                const side = random() < 0.5 ? 'buy' : 'sell';
                return {
                    side,
                    orderType: 'limit',
                    price: roundPrice(fairValue),
                    quantity: randomInt(config.MIN_ORDER_QUANTITY, config.MAX_ORDER_QUANTITY, random)
                };
            }

            // Compute the mean of the recent price window.
            const mean = average(priceHistory);
            if (mean === 0) return null;

            // Deviation of fair value from the mean, as a fraction.
            const deviation = (fairValue - mean) / mean;

            // Determine the reversion side based on the deviation threshold.
            let side = null;
            if (deviation < -config.MEAN_THRESHOLD) {
                side = 'buy';   // Price below average -> expect reversion up.
            }
            else if (deviation > config.MEAN_THRESHOLD) {
                side = 'sell';  // Price above average -> expect reversion down.
            }

            // Within the normal band: no trade this tick.
            if (!side) return null;

            // Price the order slightly in the direction of the reversion.
            const direction = side === 'buy' ? -1 : 1;
            const price = roundPrice(fairValue * (1 + direction * config.PRICE_VARIANCE * 0.5));

            const orderType = random() < config.MARKET_ORDER_PROBABILITY ? 'market' : 'limit';
            const quantity = randomInt(config.MIN_ORDER_QUANTITY, config.MAX_ORDER_QUANTITY, random);

            return { side, orderType, price, quantity };
        }
    };
}