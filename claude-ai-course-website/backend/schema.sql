-- ==========================================================================
-- backend/schema.sql — Cloudflare D1 (SQLite) schema
-- Run once after creating the database:
--   npx wrangler d1 execute claude_course_db --remote --file=./schema.sql
--   npx wrangler d1 execute claude_course_db --local  --file=./schema.sql   -- for local dev
-- ==========================================================================

-- One row per successful payment. `payment_id` is UNIQUE, which is what makes
-- webhook and verify-payment handling idempotent: a duplicate event cannot
-- create a second order or send a second email.
CREATE TABLE IF NOT EXISTS orders (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT UNIQUE,
  payment_id    TEXT UNIQUE,
  email         TEXT,
  name          TEXT,
  phone         TEXT,
  amount        INTEGER,
  currency      TEXT,
  status        TEXT,        -- created | paid | failed | refunded
  source        TEXT,        -- verify_payment | webhook
  email_status  TEXT,        -- pending | sent | failed | not_configured | no_email
  email_sent_at INTEGER,
  created_at    INTEGER,
  updated_at    INTEGER
);

CREATE INDEX IF NOT EXISTS idx_orders_email      ON orders (email);
CREATE INDEX IF NOT EXISTS idx_orders_order_id   ON orders (order_id);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON orders (created_at);

-- Short-lived, single-use download authorisations.
-- `used_at IS NULL` is the "unused" state, and the UPDATE ... WHERE used_at IS
-- NULL in index.js is the atomic single-use claim.
CREATE TABLE IF NOT EXISTS tokens (
  token      TEXT PRIMARY KEY,
  order_id   TEXT,
  payment_id TEXT,
  kind       TEXT,      -- email | session
  expires_at INTEGER,   -- epoch milliseconds
  used_at    INTEGER,
  created_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tokens_order      ON tokens (order_id);
CREATE INDEX IF NOT EXISTS idx_tokens_expires_at ON tokens (expires_at);

-- Webhook delivery log — also the idempotency guard.
-- Razorpay sends a unique x-razorpay-event-id per event; we insert it here and
-- treat a UNIQUE violation as "already processed".
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT,
  payment_id   TEXT,
  processed_at INTEGER
);

-- Fixed-window rate limiter counters (per bucket + client IP).
CREATE TABLE IF NOT EXISTS rate_limits (
  bucket       TEXT PRIMARY KEY,
  count        INTEGER,
  window_start INTEGER
);

-- Optional housekeeping (run occasionally, or add a Cron Trigger):
-- DELETE FROM tokens         WHERE expires_at < (unixepoch('now')*1000 - 604800000);
-- DELETE FROM webhook_events WHERE processed_at < (unixepoch('now')*1000 - 2592000000);
-- DELETE FROM rate_limits    WHERE window_start < (unixepoch('now')*1000 - 86400000);
