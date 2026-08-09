CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(320) NOT NULL UNIQUE,
  password_hash TEXT,
  oauth_provider VARCHAR(32),
  oauth_id VARCHAR(255),
  balance NUMERIC(15, 2) NOT NULL DEFAULT 100000.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT users_oauth_identity_unique UNIQUE (oauth_provider, oauth_id),
  CONSTRAINT users_auth_method_check CHECK (password_hash IS NOT NULL OR oauth_provider IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash CHAR(64) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  replaced_by UUID REFERENCES refresh_tokens(id),
  user_agent TEXT,
  ip INET
);

CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx ON refresh_tokens(user_id) WHERE revoked_at IS NULL;
