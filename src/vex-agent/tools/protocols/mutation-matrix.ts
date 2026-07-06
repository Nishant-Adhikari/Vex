/**
 * Canonical mutation matrix — single source-of-truth for capture contracts.
 *
 * Imported by runtime.ts (validation, preview detection), tests (structural coverage),
 * and replay.ts (type correction). Every mutating protocol tool is classified exactly once.
 *
 * Non-mutating tools are implicit read_only — not listed here.
 */

import type { PortfolioRole, CaptureSupport } from "./types.js";

// ── Contract per mutation ──────────────────────────────────────

export interface MutationContract {
  /** Business semantics for downstream projections. */
  role: PortfolioRole;
  /** Whether handler produces _tradeCapture. */
  capture: CaptureSupport;
  /** Expected _tradeCapture.type value(s). Array for dual-type tools (e.g. Polymarket buy/sell). */
  expectedType: string | string[];
  /** Handler supports dryRun param → runtime skips approval + capture for previews. */
  previewSupport: boolean;
  /** Single _tradeCapture vs _tradeCaptureItems for bulk operations. */
  fanOut: "single" | "items";
  /** Minimum required fields in _tradeCapture for capture:"full". Empty for capture:"none". */
  requiredFields: readonly string[];
  /** Named exceptions to requiredFields (e.g. "claim: no instrumentKey"). */
  exceptions?: readonly string[];
  /**
   * Handler's USD valuation capability. Runtime hard gate in capture-validator.ts.
   * - "exact": must emit inputValueUsd/outputValueUsd + valuationSource. Capture rejected without them.
   * - "conditional": may emit exact USD on certain paths (e.g. Polymarket matched). No guard on unmatched.
   * - "none": no USD from source — honest null / valuationSource: "none".
   */
  valuationExpected: "exact" | "conditional" | "none";
  /**
   * Meta fields required for downstream features (e.g. contracts for MTM).
   * Validated in capture-validator.ts alongside requiredFields.
   */
  requiredMetaFields?: readonly string[];
}

// ── Required field sets per role ────────────────────────────────

const PNL_SPOT_FIELDS = [
  "type", "walletAddress", "tradeSide", "instrumentKey",
  "inputTokenAddress", "outputTokenAddress", "inputAmount", "outputAmount",
] as const;

const PNL_PREDICTION_FIELDS = [
  "type", "walletAddress", "status", "positionKey", "instrumentKey",
] as const;

const PROJECTION_FIELDS = [
  "type", "positionKey", "status",
] as const;

const AUDIT_FIELDS = [
  "type", "walletAddress", "status",
] as const;

const NO_FIELDS: readonly string[] = [];

// ── Matrix entries ─────────────────────────────────────────────

const entries: [string, MutationContract][] = [
  // ── pnl_spot ──────────────────────────────────────────────
  ["solana.swap.execute",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: false, fanOut: "single", requiredFields: PNL_SPOT_FIELDS, exceptions: ["neutral swap: no tradeSide when meta.stableSwap or meta.ambiguousSwap"], valuationExpected: "exact" }],
  ["kyberswap.swap.sell",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["kyberswap.swap.buy",     { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  // Uniswap has no aggregator USD — honest valuationExpected "none" (the portfolio
  // sync values holdings later via DexScreener). Token addresses are still
  // captured so the self-learning balance sync auto-tracks acquired tokens.
  ["uniswap.swap.sell",      { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],
  ["uniswap.swap.buy",       { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "none" }],

  // Pendle fixed-yield PT (Ethereum v1). All three capture as spot swaps: buy
  // opens a PT lot, sell (early exit) + redeem (matured, ~face) close it. The
  // handler emits exact USD from Pendle prices (valuationSource "pendle").
  ["pendle.pt.buy",          { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["pendle.pt.sell",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["pendle.pt.redeem",       { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],

  // Pendle YT (variable/leveraged yield). Buy opens a YT lot, early-exit sell
  // closes it — captured as spot swaps with exact USD from the payment leg
  // (valuationSource "pendle"). The YT lot key is the YT address (distinct from
  // the market's PT). No redeem — a YT decays to zero rather than maturing to face.
  ["pendle.yt.buy",          { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["pendle.yt.sell",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],

  // Pendle PY mint / pre-expiry redeem (P4). ONE execution, TWO capture items (a
  // PT leg + a YT leg) with DISTINCT instrument keys → fanOut:"items" (mint opens
  // a PT lot AND a YT lot; redeem closes both). Each item is a complete spot swap
  // with exact USD split proportionally across the legs (valuationSource "pendle").
  ["pendle.py.mint",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "items",  requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],
  ["pendle.py.redeem",       { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "items",  requiredFields: PNL_SPOT_FIELDS, valuationExpected: "exact" }],

  // ── pnl_prediction ────────────────────────────────────────
  // Solana predictions — single positionPubkey per buy/sell/claim
  ["solana.predict.buy",     { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS, valuationExpected: "exact", requiredMetaFields: ["contracts"] }],
  ["solana.predict.sell",    { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS, valuationExpected: "exact" }],
  ["solana.predict.claim",   { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey"], exceptions: ["claim: no instrumentKey — matches via positionKey"], valuationExpected: "exact" }],
  ["solana.predict.closeAll",{ role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "items",  requiredFields: PNL_PREDICTION_FIELDS, exceptions: ["closeAll claim item: no instrumentKey — matches via positionKey"], valuationExpected: "exact" }],

  // Polymarket CLOB — dual-type: matched→prediction (position, exact valuation), live→order (pending, no valuation)
  ["polymarket.clob.buy",    { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"], valuationExpected: "conditional" }],
  ["polymarket.clob.sell",   { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"], valuationExpected: "conditional" }],

  // Polymarket cancel* — order lifecycle, not prediction position
  ["polymarket.clob.cancel",       { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelOrders", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelAll",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["polymarket.clob.cancelMarket", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],

  // ── projection (orders, LP) ───────────────────────────────
  ["kyberswap.limitOrder.create",    { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.cancel",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.hardCancel",{ role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.fill",      { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.batchFill", { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.limitOrder.cancelAll", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.in",              { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.out",             { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["kyberswap.zap.migrate",         { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  // Pendle single-token LP add/remove (P5) — same LP-lifecycle projection as the
  // kyberswap zaps: type:"lp", positionKey `slug:lp:market:wallet`, meta.action
  // "lp-add"/"lp-remove" drives openPositions open/close (remove closes only on a
  // proven full exit) + proj_lp_events via the protocol-neutral meta.lpLegs path.
  // valuationExpected "none" — the handler emits honest Pendle-priced USD when
  // available, honest null otherwise (validator does not force it).
  ["pendle.lp.add",                 { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],
  ["pendle.lp.remove",              { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS, valuationExpected: "none" }],

  // ── audit (capture: full) ─────────────────────────────────
  ["khalani.bridge",           { role: "audit", capture: "full", expectedType: "bridge",       previewSupport: true,  fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["relay.bridge",             { role: "audit", capture: "full", expectedType: "bridge",       previewSupport: true,  fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["solana.lend.deposit",      { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  ["solana.lend.withdraw",     { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],
  // Pendle income sweep — claims accrued YT interest + rewards / LP rewards to the
  // wallet. Not a spot trade (no input/output pair, no principal moved) → audited
  // as a "reward" income event (type→product "reward"; honest null valuation).
  ["pendle.claim",             { role: "audit", capture: "full", expectedType: "reward",       previewSupport: true,  fanOut: "single", requiredFields: AUDIT_FIELDS, valuationExpected: "none" }],

  // ── audit (capture: none — address creation, no direct tx) ─
  ["polymarket.bridge.deposit",  { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
  ["polymarket.bridge.withdraw", { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],

  // ── utility (no portfolio impact) ─────────────────────────
  ["polymarket.clob.heartbeat",       { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS, valuationExpected: "none" }],
];

// ── Exported map ───────────────────────────────────────────────

export const MUTATION_MATRIX: ReadonlyMap<string, MutationContract> = new Map(entries);

// ── Helpers ────────────────────────────────────────────────────

/** Check if a type matches the expectedType (supports string | string[]). */
export function isExpectedType(contract: MutationContract, actualType: string): boolean {
  if (Array.isArray(contract.expectedType)) {
    return contract.expectedType.includes(actualType);
  }
  return contract.expectedType === actualType;
}

/** Get all toolIds in the matrix. */
export function getMatrixToolIds(): string[] {
  return entries.map(([id]) => id);
}

/** Get tools by role. */
export function getToolsByRole(role: PortfolioRole): [string, MutationContract][] {
  return entries.filter(([, c]) => c.role === role);
}
