import type { User as DatabaseUser } from '../db.js';

declare global {
  namespace Express {
    interface User extends Omit<DatabaseUser, 'password_hash'> {}
    interface Request { auth?: { userId: string; email: string }; }
  }
}

export {};
