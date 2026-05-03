-- Khalani uses non-EVM chain identifiers that can exceed PostgreSQL INTEGER.
-- Solana is currently 20011000000, so projected balance chain ids must be BIGINT.

ALTER TABLE proj_balances
  ALTER COLUMN chain_id TYPE BIGINT;
