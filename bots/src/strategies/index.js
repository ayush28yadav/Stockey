/*
    Bot Service — Strategy Factory

    Purpose:
    Maps strategy names (from the `STRATEGY` environment variable) to their
    concrete implementations. This centralises strategy selection so the Bot
    instance and the main entry point don't need to know about individual
    strategy modules.

    Design rationale:
    - A factory pattern keeps the strategy registry in one place, making it
      trivial to add new strategies in the future.
    - The `createStrategy` function returns a fresh strategy instance each
      time it is called, so each bot gets its own independent state (e.g. its
      own price history for trend/mean strategies).
*/
import { createRandomMarketMaker } from './random-market-maker.js';
import { createTrendFollower } from './trend-follower.js';
import { createMeanReverter } from './mean-reverter.js';
import { createVolumeBot } from './volume-bot.js';

// Registry of available strategies, keyed by their config name.
const STRATEGY_REGISTRY = {
    'random-market-maker': createRandomMarketMaker,
    'trend-follower': createTrendFollower,
    'mean-reverter': createMeanReverter,
    'volume-bot': createVolumeBot
};

/**
 * Create a fresh strategy instance by name.
 *
 * @param {string} name - Strategy name (see STRATEGY_REGISTRY keys).
 * @param {object} config - The bot service configuration.
 * @returns {object} A strategy object with a `decide(context)` method.
 * @throws {Error} If the strategy name is unknown.
 */
export function createStrategy(name, config) {
    const factory = STRATEGY_REGISTRY[name];
    if (!factory) {
        throw new Error(`Unknown strategy: ${name}. Available: ${Object.keys(STRATEGY_REGISTRY).join(', ')}`);
    }
    return factory(config);
}

/**
 * List all available strategy names.
 *
 * @returns {string[]} Array of strategy names.
 */
export function listStrategies() {
    return Object.keys(STRATEGY_REGISTRY);
}