-- 010: Auto-top-up monitor — funding baseline + audit trail

CREATE TABLE IF NOT EXISTS funding_baseline (
  id INTEGER PRIMARY KEY DEFAULT 1,
  baseline_locked_og NUMERIC NOT NULL DEFAULT 0,
  baseline_total_og NUMERIC NOT NULL DEFAULT 0,
  last_topup_at TIMESTAMPTZ,
  last_topup_amount_og NUMERIC,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO funding_baseline (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS topup_history (
  id SERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  action TEXT,
  amount_og NUMERIC,
  balance_before_og NUMERIC,
  balance_after_og NUMERIC,
  source TEXT DEFAULT 'auto',
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_topup_history_created ON topup_history(created_at DESC);
