import { Pool } from 'pg';
import { config } from './config.js';

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 20 });

export type User = {
  id: string;
  email: string;
  password_hash: string | null;
  oauth_provider: string | null;
  oauth_id: string | null;
};

export async function closeDatabase() {
  await pool.end();
}
