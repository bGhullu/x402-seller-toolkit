-- Ledger schema expected by tools/funnel-report.mjs and ref/buyer-ref.mjs.
-- SQLite (node:sqlite, Node >= 22). Keep the ledger OUTSIDE any build output directory:
-- `forge clean`-style tooling and Docker builds will happily delete it.
--
-- Design notes
--   calls.status    '402-challenge' | 'settled' | 'error'
--                   Record challenges in a middleware placed BEFORE the payment middleware: the paid
--                   handler never sees unpaid requests, so the challenges-vs-settles funnel is
--                   invisible without a separate hook.
--   calls.endpoint  store the PATH, not the full URL. Hostnames rotate (tunnels, domains) and would
--                   otherwise fragment your per-endpoint statistics.
--   settlements     one row per settled payment. amount_usdc comes from the matched requirements
--                   (ctx.requirements.amount) — v2 settle receipts do not always echo it.
--   buyer_spend     what the buyer agent spent, derived from the settlement tx's USDC Transfer logs.

CREATE TABLE IF NOT EXISTS calls (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint  TEXT    NOT NULL,
  status    TEXT    NOT NULL,
  ts        INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_calls_endpoint_ts ON calls (endpoint, ts);
CREATE INDEX IF NOT EXISTS idx_calls_status_ts   ON calls (status, ts);

CREATE TABLE IF NOT EXISTS settlements (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash      TEXT    NOT NULL,
  endpoint     TEXT    NOT NULL,
  payer        TEXT    NOT NULL,
  amount_usdc  REAL    NOT NULL,
  network      TEXT,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_settlements_payer ON settlements (payer);
CREATE INDEX IF NOT EXISTS idx_settlements_ts    ON settlements (ts);

CREATE TABLE IF NOT EXISTS buyer_spend (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash      TEXT    NOT NULL,
  url          TEXT    NOT NULL,
  endpoint     TEXT    NOT NULL,
  amount_usdc  REAL    NOT NULL,
  ts           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_buyer_spend_ts ON buyer_spend (ts);

-- Housekeeping: run the funnel report with --ours <your wallets>. Without that, your own listing
-- triggers and sweeps are reported as revenue, and the number is fiction.
