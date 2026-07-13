-- Allow 'discovery' as a tracked-token provenance.
--
-- The local-chain balance sync now asks the chain's Blockscout explorer which
-- ERC-20s a wallet actually holds and pins them, so pre-existing holdings that
-- were never seeded or traded through Vex still get scanned. Those pins carry
-- source='discovery' to distinguish them from agent/swap/bridge provenance.

ALTER TABLE tracked_tokens DROP CONSTRAINT IF EXISTS tracked_tokens_source_check;
ALTER TABLE tracked_tokens ADD CONSTRAINT tracked_tokens_source_check
  CHECK (source IN ('agent', 'swap', 'bridge', 'discovery'));
