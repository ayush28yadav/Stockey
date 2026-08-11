-- Migration 004: Notifications & Scheduled Jobs support
--
-- This migration adds infrastructure needed by Phase 5:
--
--   1. `order_expiry_jobs` — tracks the BullMQ delayed-job ID for each open
--      limit order so that:
--        a) We know whether an expiry job has already been scheduled (to avoid
--           creating duplicates when the same order is re-processed).
--        b) The market-close handler can look up which BullMQ jobs to remove
--           for orders that got filled before market close.
--      The row is deleted automatically (ON DELETE CASCADE) when the parent
--      order is deleted, so no manual cleanup is needed.
--
--   2. `notification_log` — an append-only record of every notification we
--      attempted to send. Useful for debugging, auditing, and building an
--      in-app notification centre in Phase 6.

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: order_expiry_jobs
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_expiry_jobs (
  -- The limit order this job is watching.
  order_id UUID PRIMARY KEY REFERENCES orders(id) ON DELETE CASCADE,

  -- The BullMQ job ID returned when the delayed job was created.
  -- We store this so the scheduler can call queue.remove(bullmq_job_id) if the
  -- order gets filled before market close.
  bullmq_job_id TEXT NOT NULL,

  -- The UTC timestamp at which the BullMQ job is set to fire.
  -- Stored here so the scheduler can skip re-scheduling if the order was placed
  -- after market close (it will already target tomorrow's session).
  scheduled_for TIMESTAMPTZ NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Table: notification_log
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The user who received (or should receive) this notification.
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The type of notification, matching the BullMQ job name.
  -- e.g. 'trade-confirmation', 'otp-email', 'daily-pnl-summary'
  notification_type VARCHAR(64) NOT NULL,

  -- The destination email address at send time (denormalized for the audit
  -- trail — user email may change later).
  recipient_email VARCHAR(320) NOT NULL,

  -- Final status: 'sent' | 'failed'
  status VARCHAR(16) NOT NULL DEFAULT 'pending',

  -- Nodemailer messageId or an error message if sending failed.
  provider_response TEXT,

  -- The full payload passed to the notification worker (for debugging).
  payload JSONB,

  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index: look up all notifications for a user quickly (e.g. in-app notification feed).
CREATE INDEX IF NOT EXISTS notification_log_user_idx
  ON notification_log (user_id, created_at DESC);

-- Index: find failed notifications for retry / alerting dashboards.
CREATE INDEX IF NOT EXISTS notification_log_status_idx
  ON notification_log (status) WHERE status = 'failed';
