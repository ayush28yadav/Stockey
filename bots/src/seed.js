/*
    Bot Service — Account & Holdings Seeder

    Purpose:
    Before bots can trade, they need:
      1. A user account in PostgreSQL (created via the API's register flow).
      2. A cash balance (to buy shares).
      3. Share holdings (to sell shares).

    The matching engine enforces that a seller must own the shares they are
    selling (checked in `settle()` via `portfolio_holdings`), and that a buyer
    must have sufficient cash. Without seeding, bots would immediately fail
    on their first sell order.

    Design rationale:
    - Seeding is idempotent: it only inserts rows that don't already exist.
      Re-running the bot service (e.g. after a restart) is safe.
    - We seed directly into PostgreSQL (not through the API) because the API
      has no endpoint for granting cash or shares — this is a bootstrap
      concern, not a user-facing feature.
    - The seeder uses `ON CONFLICT DO NOTHING` so it never overwrites
      existing balances or holdings (e.g. if a bot has been trading and
      accumulated a different balance).

    Whitepaper reference: §10.3 — bots submit orders via the same REST API as
    real users. This seeder is the one exception where bots touch the DB
    directly, purely for initial account provisioning.
*/
import { Pool } from 'pg';
import bcrypt from 'bcrypt';
import { config } from './config.js';

/**
 * Seed bot accounts and initial holdings into PostgreSQL.
 *
 * For each bot index in [0, BOT_COUNT):
 *   - Creates a user with email `{BOT_EMAIL_PREFIX}-{index}@stockey.local`
 *     and the configured password (bcrypt-hashed).
 *   - Grants the configured seed balance.
 *   - Grants the configured seed holdings for each enabled symbol.
 *
 * @param {object} logger - Logger with `info`, `warn`, `error`, `debug`.
 * @returns {Promise<Array<{ email: string, password: string }>>} The list of
 *          bot credentials to use for authentication.
 */
export async function seedBotAccounts(logger = console) {
    const pool = new Pool({ connectionString: config.DATABASE_URL, max: 5 });

    // Pre-compute the bcrypt hash once and reuse it for all bots. This is
    // significantly faster than hashing per-bot and is safe because all bots
    // share the same password.
    const passwordHash = await bcrypt.hash(config.BOT_PASSWORD, 12);

    const credentials = [];
    try {
        for (let index = 0; index < config.BOT_COUNT; index += 1) {
            const email = `${config.BOT_EMAIL_PREFIX}-${index}@stockey.local`;

            // Insert the user if it doesn't exist. `ON CONFLICT DO NOTHING`
            // makes this idempotent across restarts.
            const userResult = await pool.query(
                `INSERT INTO users (email, password_hash, balance)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (email) DO NOTHING
                 RETURNING id`,
                [email, passwordHash, config.BOT_SEED_BALANCE]
            );

            // If the user was newly created, seed their holdings.
            if (userResult.rows[0]) {
                const userId = userResult.rows[0].id;
                for (const symbol of config.ENABLED_STOCKS) {
                    await pool.query(
                        `INSERT INTO portfolio_holdings (user_id, stock_symbol, quantity, avg_buy_price)
                         VALUES ($1, $2, $3, $4)
                         ON CONFLICT (user_id, stock_symbol) DO NOTHING`,
                        [userId, symbol, config.BOT_SEED_HOLDINGS, config.BOT_SEED_PRICE]
                    );
                }
                logger.debug(`Seeded bot account ${email} with balance ${config.BOT_SEED_BALANCE} and holdings`);
            }

            credentials.push({ email, password: config.BOT_PASSWORD });
        }
        logger.info(`Seeded ${credentials.length} bot accounts`);
        return credentials;
    }
    finally {
        // Always release the pool, even on error.
        await pool.end();
    }
}