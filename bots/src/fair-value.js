/*
    Bot Service — Fair Value Tracker

    Purpose:
    The FairValueTracker maintains a synthetic 'fair value' price for each
    stock symbol that the bots trade. Rather than trying to predict real
    market prices (which is impossible without actual market data), the
    tracker uses a simple random-walk model:

        new_fair_value = old_fair_value * (1 + Normal(0, drift_rate))

    Each tick, the fair value drifts up or down by a small random amount.
    This produces realistic-looking price movements over time without any
    external data feed.

    Design rationale:
    - Bots need a price reference to decide whether to bid above or below the
      market. The fair value provides this anchor.
    - The random walk is seeded with initial prices from the config
      (`DEFAULT_PRICES`) so the same config produces deterministic behaviour
      that can be reasoned about during development.
    - Individual bot instances track their own fair value per symbol so that
      different bots don't all converge to the same price, creating a
      realistic spread.

    Whitepaper reference: §10.2 — bots place orders "within a spread around
    the last trade price". Since we may not have a last trade on cold start,
    fair value serves as the initial reference.
*/
export class FairValueTracker {
    /**
     * @param {number} driftRate - The fractional drift per tick (e.g. 0.001 = 0.1%).
     * @param {function(string): number} defaultPriceFn - Function that returns
     *        a starting price for a given symbol.
     */
    constructor(driftRate, defaultPriceFn) {
        this.driftRate = driftRate;
        this.defaultPriceFn = defaultPriceFn;

        // Map<symbol, number> — the current fair value for each symbol.
        this.prices = new Map();
    }

    /**
     * Ensure a symbol has a fair value. If the symbol has never been seen
     * before, initialises it to the default price from config.
     *
     * @param {string} symbol
     * @returns {number} The current fair value for the symbol.
     */
    initSymbol(symbol) {
        if (!this.prices.has(symbol)) {
            this.prices.set(symbol, this.defaultPriceFn(symbol));
        }
        return this.prices.get(symbol);
    }

    /**
     * Get the current fair value for a symbol.
     *
     * @param {string} symbol
     * @returns {number | undefined} The fair value, or undefined if unknown.
     */
    get(symbol) {
        return this.prices.get(symbol);
    }

    /**
     * Update the fair value for a symbol using a random-walk drift.
     * Called once per tick to evolve prices over time.
     *
     * The formula:
     *   drift = Normal(0, driftRate)
     *   newPrice = oldPrice * (1 + drift)
     *
     * We clamp the result to 1 cent minimum to prevent pathological zero/negative prices.
     *
     * @param {string} symbol
     */
    tick(symbol) {
        const current = this.initSymbol(symbol);
        // Box-Muller transform: generate a normally-distributed random number
        // with mean 0 and standard deviation = drift_rate.
        const u1 = Math.random();
        const u2 = Math.random();
        // If either number is exactly 0, Box-Muller diverges; skip this tick.
        if (u1 === 0 || u2 === 0) return current;
        const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const drift = normal * this.driftRate;
        const newPrice = current * (1 + drift);
        this.prices.set(symbol, Math.max(0.01, newPrice));
        return this.prices.get(symbol);
    }

    /**
     * Set the fair value for a symbol from an external source (e.g. the
     * last trade price observed from the API). The random-walk will continue
     * from this new base on the next tick.
     *
     * @param {string} symbol
     * @param {number} price
     */
    set(symbol, price) {
        if (Number.isFinite(price) && price > 0) {
            this.prices.set(symbol, price);
        }
    }
}