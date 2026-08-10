/*
    Bot Service — Main Entry Point

    Purpose:
    Bootstraps and runs the automated market simulation described in the
    whitepaper Phase 4 (§10). The service:

      1. Loads and validates configuration.
      2. Seeds bot accounts and initial holdings in PostgreSQL.
      3. Creates `BOT_COUNT` bot instances, each with its own strategy.
      4. Authenticates each bot with the Stockey API.
      5. Starts each bot's tick loop.
      6. Handles graceful shutdown on SIGINT/SIGTERM.

    Strategy distribution:
    - If `STRATEGY=mixed`, strategies are assigned round-robin across bots so
      the market contains a healthy mix of market makers, trend followers,
      mean reverters, and volume bots.
    - Otherwise, all bots use the named strategy.

    Whitepaper reference: §10.3 — "The Bot Service is a standalone Node.js
    process (separate from the API server)."
*/
import { config } from './config.js';
import { seedBotAccounts } from './seed.js';
import { Bot } from './bot.js';
import { listStrategies } from './strategies/index.js';

// ---------------------------------------------------------------------------
// Simple level-based logger
// ---------------------------------------------------------------------------
// Maps LOG_LEVEL to a threshold; only messages at or above the threshold are
// printed. This keeps the console clean in production while allowing verbose
// debugging in development.
const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const threshold = LOG_LEVELS[config.LOG_LEVEL] ?? LOG_LEVELS.info;

const logger = {
    debug: (...args) => { if (threshold <= LOG_LEVELS.debug) console.debug(...args); },
    info: (...args) => { if (threshold <= LOG_LEVELS.info) console.info(...args); },
    warn: (...args) => { if (threshold <= LOG_LEVELS.warn) console.warn(...args); },
    error: (...args) => { if (threshold <= LOG_LEVELS.error) console.error(...args); }
};

// ---------------------------------------------------------------------------
// Strategy assignment
// ---------------------------------------------------------------------------
/**
 * Determine the strategy name for a given bot index.
 *
 * @param {number} index - Zero-based bot index.
 * @returns {string} The strategy name to use.
 */
function strategyForIndex(index) {
    if (config.STRATEGY === 'mixed') {
        // Round-robin across all available strategies.
        const strategies = listStrategies();
        return strategies[index % strategies.length];
    }
    return config.STRATEGY;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
    logger.info('Stockey Bot Service starting');
    logger.info(`Configuration: ${config.BOT_COUNT} bots, tick=${config.TICK_INTERVAL_MS}ms, ` +
        `stocks=[${config.ENABLED_STOCKS.join(', ')}], strategy=${config.STRATEGY}`);

    // 1. Seed bot accounts and holdings (idempotent).
    const credentials = await seedBotAccounts(logger);

    // 2. Create bot instances.
    const bots = credentials.map((credential, index) => {
        const strategyName = strategyForIndex(index);
        return new Bot({
            index,
            email: credential.email,
            password: credential.password,
            strategyName,
            config,
            logger
        });
    });

    // 3. Authenticate all bots with the API (register or login).
    logger.info(`Authenticating ${bots.length} bots with the API...`);
    await Promise.all(bots.map((bot) => bot.authenticate()));

    // 4. Start all bots.
    logger.info('Starting bot tick loops...');
    bots.forEach((bot) => bot.start());

    // 5. Graceful shutdown.
    let shuttingDown = false;
    async function shutdown(signal) {
        if (shuttingDown) return;
        shuttingDown = true;
        logger.info(`${signal} received; stopping bots...`);
        bots.forEach((bot) => bot.stop());
        logger.info('Bot service stopped cleanly');
        process.exit(0);
    }

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));

    logger.info('Bot service is running. Press Ctrl+C to stop.');
}

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
main().catch((error) => {
    console.error('Fatal error in bot service:', error);
    process.exit(1);
});