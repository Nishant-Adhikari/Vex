/**
 * Mission command IPC schemas — barrel re-exporting the three
 * command-group files. Splits the original ~440 LOC monolith into
 * focused sub-files (codex puzzle 04 phase 6 review #2 — file-size
 * budget 350 LOC):
 *
 *   - `contract.ts`      — acceptContract, getDiff, updateDraft, setAutoRetry
 *   - `run-lifecycle.ts` — start, continue, recover, stop
 *   - `transcript.ts`    — renew, getRenewableSource
 */

export * from "./contract.js";
export * from "./run-lifecycle.js";
export * from "./transcript.js";
