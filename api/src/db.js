// Database connection pool
// Purpose: central Postgres connection pool used by controllers and the
// matching engine. Configure modest pooling for concurrency and ensure a
// single source of truth for DB shutdown.
import { Pool } from 'pg';
import { config } from './config.js';

// Configure pool size conservatively. Tune `max` for production under
// load testing to avoid exhausting DB connections.
export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });

export async function closeDatabase() {
    // Ensure all clients are returned and connections closed before exit.
    await pool.end();
}
