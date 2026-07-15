# Vex fork — engineering guidance

This repo is a fork of **Vex-Foundation/Vex**. We build features here and
contribute the generic ones back upstream. Upstream is selective (most PRs are
closed), so the discipline below matters.

## Categorize every feature: upstreamable vs fork-specific

Before building anything, decide which bucket it's in — and note it in the PR:

- **Upstreamable (generic).** A runtime / safety / correctness / UX improvement
  that would apply to a **stock upstream Vex install**, with **no fork-specific
  dependencies**. Examples: the economic buy/sell trade-side fix, provider
  retry/failover, the hard-deadline + force-liquidate watchdog, a plain-language
  mission summary, mission-contract-modal speedups.
  → Build these **STANDALONE** — decoupled from fork-only code — so they can be
  authored as clean, self-contained PRs against `upstream/main`.

- **Fork-specific.** Depends on our additions and would NOT make sense in stock
  Vex: Robinhood-chain specifics, the **$VEX** token, the **Vexa** companion,
  our **Signal Radar** feed, our **strategy-discipline** config, etc.
  → Stays in the fork only.

**Rule of thumb:** ask *"would this work on original Vex, unchanged?"* If yes,
keep its generic core free of fork-specific imports/assumptions so it stays
cherry-pickable and upstream-ready. The goal is that each generic improvement
**can stand alone on top of original Vex.**

## Upstreaming mechanics
- Author upstream PRs **fresh against `upstream/main`** (`git fetch upstream`),
  NOT by cherry-picking the bundled fork branch.
- **One tight, self-contained, tested PR per improvement.** Upstream closes
  half-baked or bundled PRs — keep the diff minimal and add a test + a clear
  repro/rationale.
- The Codex bot auto-reviews on PR open (or `@codex review`).
- Track which merged vs closed so we learn what upstream accepts.
