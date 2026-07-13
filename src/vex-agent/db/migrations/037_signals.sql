-- Signal ingestion — TrendRadar crypto-alpha signals persisted in Vex's own DB.
--
-- The `signals-ingest` worker polls TrendRadar's published feed hourly and
-- UPSERTS one row per (source, chain, contract). Keeping the LATEST row per
-- token (not a per-poll history) means:
--   - Vex owns the data it trades on (local-first, no external store at run time),
--   - the "rolling window / overall alpha" is a plain query over `ingested_at`
--     (WHERE ingested_at > now() - interval), and
--   - it is offline-resilient: if TrendRadar misses an hour, the last-known rows
--     persist and simply age out of the window.
--
-- The feed is already windowed (today+yesterday mention counts, deduped by
-- contract), so a row carries the aggregated alpha, not a single mention.
--
-- Signals are DISCOVERY only. They never authorise a trade — a mission still
-- runs the exit-safety scan and the human approval gate over any candidate.

CREATE TABLE IF NOT EXISTS signals (
  id                  BIGSERIAL PRIMARY KEY,
  source              TEXT NOT NULL DEFAULT 'trendradar',
  chain               TEXT NOT NULL,
  contract            TEXT NOT NULL,
  symbol              TEXT,
  action              TEXT,
  score               INTEGER,
  today_mentions      INTEGER,
  yesterday_mentions  INTEGER,
  velocity_pct        INTEGER,
  liquidity_usd       DOUBLE PRECISION,
  volume_24h_usd      DOUBLE PRECISION,
  price_usd           DOUBLE PRECISION,
  narratives          JSONB NOT NULL DEFAULT '[]',
  risk_flags          JSONB NOT NULL DEFAULT '[]',
  raw                 JSONB,
  first_seen_at       TIMESTAMPTZ,
  last_seen_at        TIMESTAMPTZ,
  feed_generated_at   TIMESTAMPTZ,
  ingested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One row per (source, chain, contract) — hex contracts dedupe case-insensitively.
CREATE UNIQUE INDEX IF NOT EXISTS idx_signals_identity
  ON signals (source, chain, LOWER(contract));

-- The rolling-window query orders/filters by freshness.
CREATE INDEX IF NOT EXISTS idx_signals_ingested_at
  ON signals (ingested_at DESC);
