-- Mission results: record the wallet's non-ETH holdings at run START.
--
-- open_positions_json captures the non-ETH bags held at CLOSE, but that includes
-- leftover dust from PRIOR missions — so a mission that ended flat still showed
-- "N bags". Recording the start holdings lets the read count only NEW positions
-- (end bags whose token address is absent at start), making the held-bag count
-- MISSION-ATTRIBUTABLE. Same JSONB array shape as open_positions_json
-- ({symbol,address,amount,valueUsd}); nullable for rows opened before this column.

ALTER TABLE mission_results ADD COLUMN start_positions_json JSONB;
