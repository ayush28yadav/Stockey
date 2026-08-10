/*
    Database migrations runner

    Responsibilities:
    - Discover SQL migration files in `api/sql/` using a timestamped naming
        convention (e.g. `001_init.sql`).
    - Execute migrations inside a transaction and record applied filenames
        in `schema_migrations` to guarantee idempotence.
    - Fail fast and roll back on any SQL error.

    Notes for maintainers:
    - Migration SQL should be written to be safe to re-run but the runner
        already ensures each file is only applied once by tracking filenames.
    - Keep migrations small and focused to simplify review and rollback.
*/
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';
const migrationsDirectory = fileURLToPath(new URL('../sql/', import.meta.url));
export async function runMigrations() {
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
    const files = (await readdir(migrationsDirectory)).filter((file) => /^\d+_.+\.sql$/.test(file)).sort();
    for (const filename of files) {
        const alreadyApplied = await pool.query('SELECT 1 FROM schema_migrations WHERE filename = $1', [filename]);
        if (alreadyApplied.rowCount)
            continue;
        const sql = await readFile(new URL(`../sql/${filename}`, import.meta.url), 'utf8');
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
            await client.query('COMMIT');
            console.log(`Applied database migration ${filename}`);
        }
        catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
        finally {
            client.release();
        }
    }
}
