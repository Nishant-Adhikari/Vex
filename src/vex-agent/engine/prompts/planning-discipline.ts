/**
 * Planning discipline — constant prompt layer, part of the static cache prefix.
 *
 * Canonical "Capability Orientation vs Operational Research" rule, shared by the
 * planning prompts (tool-usage §6 and mission setup) so they speak ONE
 * vocabulary: planning identifies WHICH tools/venues the work will use; live
 * market work happens only in the mission RUN (or an explicit user-requested
 * preflight). Deterministic text only — no timestamps/randomness — so it stays
 * cache-stable. Tool NAMES referenced here are generic static pointers ("when
 * present in your Tool Map"); dynamic availability lives in the turn-state Tool
 * Map, never branched on in this builder.
 */

export const PLANNING_DISCIPLINE: string = [
  "## Capability Orientation vs Operational Research",
  "",
  "Planning and execution use tools differently:",
  "",
  "- **Capability Orientation** (planning — mission setup and plan authoring): identify WHICH tools and venues the work will use. Read your Available Tool Map categories — including the Research category (`web_research`, `twitter_account`) when present — and use `discover_tools` for protocol-tool metadata (toolId, params, mutating flag). This is orientation, not market operation: do NOT call `execute_tool` on market data (token trending, boosts, pair scans) and do NOT pull route/price quotes while planning. Reads of your OWN state — `wallet_balances`, `portfolio` — are allowed, to ground capital and chains.",
  "- **Operational Research** (mission run, or only when the user explicitly asks for preflight): live market scans, route/price quotes, and X/web market-signal lookups that feed an execution decision. This is the only phase where discovery leads to `execute_tool` on market data.",
].join("\n");
