/*
    Bot Service — Bot Instance

    Purpose:
    The Bot class encapsulates the full lifecycle of a single simulated
    trader. Each bot instance:
      1. Authenticates with the Stockey API (register or login).
      2. Runs a tick loop at a configurable interval.
      3. On each tick, refreshes market data (order book + trade tape),
         evolves its fair value, asks its strategy for an order decision,
         and submits the order through the public API.
      4. Handles transient failures (rate limits, network errors) gracefully
         and recovers on the next tick.

    Design rationale:
    - Each bot is an independent async loop, so `BOT_COUNT` bots run
      concurrently without blocking each other.
    - Bots use the same REST API as real users, exercising the full system
      stack (auth, rate limiting, matching, WebSocket broadcasts, settlement).
    - Access tokens expire after 15 minutes; the bot transparently refreshes
      its session when it receives a 401.
    - Errors are logged and swallowed (not thrown) so one bot's failure does
      not crash the entire service.
*/
import { randomUUID } from 'node:crypto';
import { ApiClient } from './api-client.js';
import { FairValueTracker } from './fair-value.js';
import { createStrategy } from './strategies/index.js';

export class Bot {
    /**
     * @param {object} options - Bot construction options.
     * @param {number} options.index - Zero-based bot index (used for naming).
     * @param {string} options.email - Bot email address.
     * @param {string} options.password - Bot password.
     * @param {string} options.strategyName - Strategy name for this bot.
     * @param {object} options.config - The bot service configuration.
     * @param {object} [options.logger] - Logger with `info`, `warn`, `error`, `debug`.
     */
    constructor({ index, email, password, strategyName, config, logger = console }) {
        this.index = index;
        this.email = email;
        this.password = password;
        this.strategyName = strategyName;
        this.config = config;
        this.logger = logger;

        // API client for this bot's authenticated session.
        this.api = new ApiClient(config.API_ORIGIN);

        // Fair value tracker for this bot's price reference.
        this.fairValue = new FairValueTracker(config.DRIFT_RATE, config.defaultPriceFor);

        // Strategy instance (fresh per bot so state is independent).
        this.strategy = createStrategy(strategyName, config);

        // Per-symbol market data cache: { symbol: { lastPrice, orderBook, lastRefreshTick } }.
        this.marketData = new Map();

        // Tick counter for periodic market-data refreshes.
        this.tickCount = 0;

        // Whether the bot is currently running.
        this.running = false;

        // Handle to the interval timer (for graceful shutdown).
        this.timer = null;
    }

    /**
     * Start the bot's tick loop. The first tick runs immediately, then every
     * `TICK_INTERVAL_MS` milliseconds thereafter.
     */
    start() {
        if (this.running) return;
        this.running = true;
        this.logger.info(`[bot-${this.index}] Starting with strategy '${this.strategyName}' (${this.email})`);
        // Run the first tick immediately so the market warms up fast.
        void this.tick();
        this.timer = setInterval(() => void this.tick(), this.config.TICK_INTERVAL_MS);
    }

    /**
     * Stop the bot's tick loop and clear the timer.
     */
    stop() {
        this.running = false;
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }
        this.logger.info(`[bot-${this.index}] Stopped`);
    }

    /**
     * Authenticate with the Stockey API. Tries to log in first; if the
     * account does not exist yet, registers it.
     */
    async authenticate() {
        try {
            await this.api.login(this.email, this.password);
            this.logger.debug(`[bot-${this.index}] Logged in as ${this.email}`);
        }
        catch (error) {
            // Login failed — likely the account doesn't exist yet. Register it.
            this.logger.debug(`[bot-${this.index}] Login failed (${error.message}); registering`);
            await this.api.register(this.email, this.password);
            this.logger.debug(`[bot-${this.index}] Registered as ${this.email}`);
        }
    }

    /**
     * Ensure the access token is valid. If the API returns 401, attempt a
     * session refresh (rotates the refresh token) and retry once.
     *
     * @param {() => Promise<object>} action - The API call to execute.
     * @returns {Promise<object>} The API response body.
     */
    async withAuthRetry(action) {
        try {
            return await action();
        }
        catch (error) {
            // Only retry on authentication failures.
            if (error.status !== 401) throw error;
            this.logger.debug(`[bot-${this.index}] Access token expired; refreshing session`);
            await this.api.refresh();
            return action();
        }
    }

    /**
     * Refresh market data for a symbol: fetch the order book and trade tape,
     * update the fair value from the last trade price, and cache the results.
     *
     * @param {string} symbol - Stock symbol.
     */
    async refreshMarketData(symbol) {
        try {
            const [orderBook, tradeTape] = await Promise.all([
                this.api.getOrderBook(symbol),
                this.api.getTradeTape(symbol)
            ]);

            // Update fair value from the most recent trade price if available.
            const lastTrade = tradeTape.trades?.[0];
            if (lastTrade?.price) {
                this.fairValue.set(symbol, Number(lastTrade.price));
            }

            this.marketData.set(symbol, {
                orderBook,
                lastPrice: lastTrade ? Number(lastTrade.price) : null,
                lastRefreshTick: this.tickCount
            });
        }
        catch (error) {
            this.logger.warn(`[bot-${this.index}] Market data refresh failed for ${symbol}: ${error.message}`);
        }
    }

    /**
     * Execute a single tick: refresh market data (periodically), evolve fair
     * value, ask the strategy for a decision, and submit the order.
     */
    async tick() {
        if (!this.running) return;
        this.tickCount += 1;

        // Pick a random symbol to trade this tick.
        const symbol = this.config.ENABLED_STOCKS[Math.floor(Math.random() * this.config.ENABLED_STOCKS.length)];
        if (!symbol) return;

        // Refresh market data periodically (not every tick) to reduce API load.
        const cached = this.marketData.get(symbol);
        if (!cached || this.tickCount - cached.lastRefreshTick >= this.config.MARKET_DATA_REFRESH_TICKS) {
            await this.refreshMarketData(symbol);
        }

        // Evolve the fair value with a random walk.
        const fairValue = this.fairValue.tick(symbol);

        // Ask the strategy for an order decision.
        const decision = this.strategy.decide({
            fairValue,
            lastPrice: this.marketData.get(symbol)?.lastPrice ?? null
        });

        // Strategy may decide to skip this tick (e.g. mean reverter in band).
        if (!decision) return;

        // Build the order payload for the API.
        const order = {
            stockSymbol: symbol,
            orderType: decision.orderType,
            side: decision.side,
            quantity: decision.quantity
        };
        // Limit orders require a price; market orders must not include one.
        if (decision.orderType === 'limit') {
            order.price = decision.price;
        }

        try {
            // Submit the order with a unique idempotency key.
            const result = await this.withAuthRetry(() =>
                this.api.placeOrder(this.api.accessToken, order, randomUUID())
            );
            this.logger.debug(
                `[bot-${this.index}] Placed ${decision.orderType} ${decision.side} ${decision.quantity} ${symbol} ` +
                `${decision.orderType === 'limit' ? `@ ${decision.price}` : '(market)'} -> ${result.order.status}`
            );
        }
        catch (error) {
            // Log but do not crash. Common causes: insufficient balance,
            // insufficient holdings, rate limiting, or transient network errors.
            this.logger.warn(`[bot-${this.index}] Order failed for ${symbol}: ${error.message}`);
        }
    }
}