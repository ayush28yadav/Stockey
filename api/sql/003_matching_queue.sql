ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS matching_enqueued_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS orders_pending_matching_idx
  ON orders (matching_enqueued_at, created_at)
  WHERE status IN ('open', 'partially_filled');
