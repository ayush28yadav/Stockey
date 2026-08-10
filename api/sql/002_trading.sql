CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  stock_symbol VARCHAR(16) NOT NULL,
  order_type VARCHAR(10) NOT NULL,
  side VARCHAR(4) NOT NULL,
  price NUMERIC(15, 2),
  quantity INTEGER NOT NULL,
  filled_quantity INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  idempotency_key UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT orders_symbol_check CHECK (stock_symbol = UPPER(stock_symbol) AND stock_symbol ~ '^[A-Z][A-Z0-9.]{0,15}$'),
  CONSTRAINT orders_type_check CHECK (order_type IN ('market', 'limit')),
  CONSTRAINT orders_side_check CHECK (side IN ('buy', 'sell')),
  CONSTRAINT orders_price_check CHECK (
    (order_type = 'market' AND price IS NULL) OR
    (order_type = 'limit' AND price IS NOT NULL AND price > 0)
  ),
  CONSTRAINT orders_quantity_check CHECK (quantity > 0 AND filled_quantity >= 0 AND filled_quantity <= quantity),
  CONSTRAINT orders_status_check CHECK (status IN ('open', 'partially_filled', 'filled', 'cancelled')),
  CONSTRAINT orders_user_idempotency_unique UNIQUE (user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS orders_user_status_idx ON orders (user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_matching_idx ON orders (stock_symbol, side, price, created_at) WHERE status IN ('open', 'partially_filled');

CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buy_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  sell_order_id UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  stock_symbol VARCHAR(16) NOT NULL,
  price NUMERIC(15, 2) NOT NULL CHECK (price > 0),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trades_distinct_orders_check CHECK (buy_order_id <> sell_order_id),
  CONSTRAINT trades_symbol_check CHECK (stock_symbol = UPPER(stock_symbol) AND stock_symbol ~ '^[A-Z][A-Z0-9.]{0,15}$')
);

CREATE INDEX IF NOT EXISTS trades_symbol_executed_idx ON trades (stock_symbol, executed_at DESC);
CREATE INDEX IF NOT EXISTS trades_buy_order_idx ON trades (buy_order_id);
CREATE INDEX IF NOT EXISTS trades_sell_order_idx ON trades (sell_order_id);

CREATE TABLE IF NOT EXISTS portfolio_holdings (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stock_symbol VARCHAR(16) NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0,
  avg_buy_price NUMERIC(15, 2) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, stock_symbol),
  CONSTRAINT portfolio_symbol_check CHECK (stock_symbol = UPPER(stock_symbol) AND stock_symbol ~ '^[A-Z][A-Z0-9.]{0,15}$'),
  CONSTRAINT portfolio_quantity_check CHECK (quantity >= 0),
  CONSTRAINT portfolio_average_price_check CHECK (avg_buy_price >= 0)
);
