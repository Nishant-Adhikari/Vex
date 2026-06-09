/**
 * Regime worker policy — named constants for the daily market-regime classifier
 * (S6b). No DB, no I/O — plain unit-testable constants, ALL of them "tune
 * empirically, do not freeze" (D-CONST). The decay-side regime tunables
 * (dwell gap, snapshot max age, half-life factors) live in
 * `memory/manager/maturity-policy.ts` — the single owner of decay tunables;
 * this module owns only the WORKER's cadence, timeouts, and evidence knobs.
 */

// ── Cadence ─────────────────────────────────────────────────────────

/**
 * Worker tick interval. The tick itself is cheap (env gates + one snapshot
 * read); the 20h cadence gate below makes the effective rhythm daily. Hourly
 * ticks give a natural retry after a failed day (Tavily down, LLM timeout) and
 * a fast pickup after vault unlock injects the source keys.
 */
export const REGIME_TICK_INTERVAL_MS = 60 * 60_000; // 1h

/**
 * Minimum age (HOURS) of the latest snapshot before a new classification runs.
 * 20h (not 24h) so a day whose tick lands slightly early still classifies —
 * effectively once per day, and it doubles as the dwell pair's lower gap bound
 * (two snapshots are always two distinct days).
 */
export const REGIME_MIN_INTERVAL_HOURS = 20;

// ── Timeouts ────────────────────────────────────────────────────────

/** Per-classification LLM timeout (mirrors the judge's discipline). */
export const REGIME_LLM_TIMEOUT_MS = 30_000;

/** Per-source gather timeout (Tavily's own search timeout is 30s; headroom). */
export const REGIME_SOURCE_TIMEOUT_MS = 45_000;

// ── Evidence gathering (hardcoded queries — YAGNI: config-driven later) ──

/**
 * The fixed Tavily queries (titles + snippets only, fetchTop=0). Two angles —
 * today's trend/volatility and the week's sentiment — so a single noisy page
 * cannot dominate the evidence.
 */
export const REGIME_WEB_QUERIES = [
  "crypto market today bitcoin trend volatility",
  "crypto market sentiment this week",
] as const;

/** The fixed tweet-search query (words are AND-ed by the search filter). */
export const REGIME_TWEET_QUERY = "crypto market bitcoin";

/** Tweets fetched per classification (the tweet_search API cap is 20). */
export const REGIME_TWEET_COUNT = 20;

/**
 * Minimum likes for a tweet to count as evidence — a cheap engagement floor
 * against zero-traction spam/shill accounts (the prompt additionally instructs
 * the classifier to discount promotional content).
 */
export const REGIME_TWEET_MIN_LIKES = 50;

/**
 * Hard char cap PER EVIDENCE SECTION (Tavily / Twitter) in the user prompt.
 * Bounds prompt cost and caps how much attacker-controlled web text can reach
 * the classifier in one section.
 */
export const REGIME_EVIDENCE_MAX_CHARS = 6_000;
