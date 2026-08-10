/*
    Bot Service — Environment Configuration & Validation

    Purpose:
    The bot service is a standalone Node.js process that simulates market
    activity by placing realistic buy/sell orders through the same REST API
    that real users use. This module is the single source of truth for all
    runtime configuration.

    Design rationale:
    - We validate and coerce every environment variable through a Zod schema
      so the process fails fast on misconfiguration with clear, actionable
      errors (important for operators and CI).
    - Numeric values are coerced from strings because environment variables
      are always strings; this avoids subtle type bugs at runtime.
    - Sensible defaults are provided so the service runs out-of-the-box in a
      local Docker Compose stack, while still being fully tunable in
      production.

    Configuration surface (mapped to the whitepaper §10.4):
    - BOT_COUNT              -> number of simultaneous bot instances
    - TICK_INTERVAL_MS       -> how often each bot places an order
    - PRICE_VARIANCE         -> how far from fair value a bot will bid/ask
    - MARKET_ORDER_PROBABILITY -> probability of a market order vs limit
    - ENABLED_STOCKS         -> the symbols the bots trade
*/
import 'dotenv/config';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Schema definition
// ---------------------------------------------------------------------------
// Each field documents its purpose and default. Coercion helpers (`z.coerce`)
// convert raw string env values into the expected runtime types.
const schema = z.object({
    // Runtime environment: development / test / production.
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    // Base URL of the Stockey API. Bots submit orders and read market data
    // exclusively through this HTTP endpoint (never directly to the DB for
    // trading operations).
    API_ORIGIN: z.string().url().default('http://localhost:4000'),

    // PostgreSQL connection string. Used ONLY for bootstrapping bot accounts
    // (seeding initial cash balances and share holdings). All trading activity
    // flows through the API to exercise the full system stack.
    DATABASE_URL: z.string().url(),

    // Number of simultaneous bot instances to run. Each instance maintains its
    // own identity, session, and strategy state.
    BOT_COUNT: z.coerce.number().int().positive().default(10),

    // Delay (ms) between each bot's order attempts. Lower values increase
    // market pressure and stress the matching engine.
    TICK_INTERVAL_MS: z.coerce.number().int().positive().default(500),

    // Maximum fractional distance (as a decimal, e.g. 0.005 = 0.5%) that a
    // bot's limit price may deviate from the current fair value. This defines
    // the width of the spread bots maintain around the market.
    PRICE_VARIANCE: z.coerce.number().min(0).max(1).default(0.005),

    // Probability (0..1) that a bot places a market order instead of a limit
    // order. Higher values make the market more aggressive and consume
    // liquidity faster.
    MARKET_ORDER_PROBABILITY: z.coerce.number().min(0).max(1).default(0.2),

    // Comma-separated list of stock symbols the bots are allowed to trade.
    // Parsed and normalised to uppercase for consistency with the API.
    ENABLED_STOCKS: z.string().default('AAPL,RELIANCE,INFY')
        .transform((value) => value.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)),

    // Strategy selection. 'mixed' distributes the available strategies across
    // bot instances round-robin; otherwise all bots use the named strategy.
    STRATEGY: z.enum(['random-market-maker', 'trend-follower', 'mean-reverter', 'volume-bot', 'mixed'])
        .default('mixed'),

    // -----------------------------------------------------------------------
    // Bot account bootstrap
    // -----------------------------------------------------------------------
    // Bots authenticate through the same email/password + JWT flow as real
    // users. These settings control the synthetic identities they use.
    BOT_EMAIL_PREFIX: z.string().default('bot'),
    BOT_PASSWORD: z.string().min(12).default('stockey-bot-password'),

    // Initial cash balance granted to each bot account (seeded directly into
    // PostgreSQL). Generous defaults give bots a long runway before they run
    // out of buying power.
    BOT_SEED_BALANCE: z.coerce.number().positive().default(1_000_000),

    // Initial share holdings granted to each bot account per enabled symbol.
    // Sellers must own shares for the matching engine to accept their sell
    // orders, so this seeding is essential for a liquid market.
    BOT_SEED_HOLDINGS: z.coerce.number().int().positive().default(10_000),

    // Average buy price recorded for seeded holdings. This is informational
    // (used for P&L) and does not affect matching.
    BOT_SEED_PRICE: z.coerce.number().positive().default(100),

    // -----------------------------------------------------------------------
    // Order sizing
    // -----------------------------------------------------------------------
    // Random quantity range for standard (non-volume) bot orders.
    MIN_ORDER_QUANTITY: z.coerce.number().int().positive().default(1),
    MAX_ORDER_QUANTITY: z.coerce.number().int().positive().default(50),

    // Quantity range for the Volume Bot strategy, which places large orders to
    // stress-test the matching engine.
    VOLUME_MIN_QUANTITY: z.coerce.number().int().positive().default(100),
    VOLUME_MAX_QUANTITY: z.coerce.number().int().positive().default(500),

    // Probability (0..1) that the Volume Bot places an order on any given tick.
    VOLUME_ORDER_PROBABILITY: z.coerce.number().min(0).max(1).default(0.3),

    // -----------------------------------------------------------------------
    // Strategy tuning
    // -----------------------------------------------------------------------
    // Fair value random-walk drift per tick (decimal fraction). A small value
    // (0.001 = 0.1%) produces gradual, realistic price movement.
    DRIFT_RATE: z.coerce.number().min(0).max(1).default(0.001),

    // Trend Follower: number of recent prices used to compute moving averages.
    TREND_WINDOW: z.coerce.number().int().positive().default(20),
    // Minimum samples required before the trend follower starts trading.
    TREND_MIN_SAMPLES: z.coerce.number().int().positive().default(5),

    // Mean Reverter: window for the moving average and the deviation threshold
    // (as a decimal fraction) that triggers a reversion trade.
    MEAN_WINDOW: z.coerce.number().int().positive().default(30),
    MEAN_MIN_SAMPLES: z.coerce.number().int().positive().default(5),
    MEAN_THRESHOLD: z.coerce.number().min(0).max(1).default(0.01),

    // How often (in ticks) each bot refreshes market data (order book + trade
    // tape) from the API. Refreshing too often adds API load; too rarely makes
    // bots trade on stale prices.
    MARKET_DATA_REFRESH_TICKS: z.coerce.number().int().positive().default(10),

    // Logging verbosity.
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info')
});

// ---------------------------------------------------------------------------
// Parse & validate
// ---------------------------------------------------------------------------
const parsed = schema.safeParse(process.env);
if (!parsed.success) {
    console.error('Invalid bot environment configuration:', parsed.error.flatten().fieldErrors);
    process.exit(1);
}

// Cross-field validation: ensure the quantity ranges are internally consistent.
const env = parsed.data;
if (env.MIN_ORDER_QUANTITY > env.MAX_ORDER_QUANTITY) {
    console.error('MIN_ORDER_QUANTITY must be <= MAX_ORDER_QUANTITY');
    process.exit(1);
}
if (env.VOLUME_MIN_QUANTITY > env.VOLUME_MAX_QUANTITY) {
    console.error('VOLUME_MIN_QUANTITY must be <= VOLUME_MAX_QUANTITY');
    process.exit(1);
}

// Default fair value per symbol, used only when no market data is available
// yet (e.g. on a cold start with an empty order book). These are reasonable
// starting points for the demo symbols.
const DEFAULT_PRICES = {
    AAPL: 150,
    RELIANCE: 2500,
    INFY: 1500
};

export const config = {
    ...env,
    // Resolve a sensible initial price for a symbol, falling back to a generic
    // value if the symbol is not in the known map.
    defaultPriceFor: (symbol) => DEFAULT_PRICES[symbol] ?? 100
};