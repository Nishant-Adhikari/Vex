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
}

// ── Required field sets per role ────────────────────────────────

const PNL_SPOT_FIELDS = [
  "walletAddress", "tradeSide", "instrumentKey",
  "inputTokenAddress", "outputTokenAddress", "inputAmount", "outputAmount",
] as const;

const PNL_PREDICTION_FIELDS = [
  "walletAddress", "status", "positionKey", "instrumentKey",
] as const;

const PROJECTION_FIELDS = [
  "positionKey", "type", "status",
] as const;

const AUDIT_FIELDS = [
  "walletAddress", "status", "type",
] as const;

const NO_FIELDS: readonly string[] = [];

// ── Matrix entries ─────────────────────────────────────────────

const entries: [string, MutationContract][] = [
  // ── pnl_spot ──────────────────────────────────────────────
  ["solana.swap.execute",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: false, fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["jaine.swap.sell",        { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["jaine.swap.buy",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["kyberswap.swap.sell",    { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["kyberswap.swap.buy",     { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["slop.trade.buy",         { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],
  ["slop.trade.sell",        { role: "pnl_spot", capture: "full", expectedType: "swap",       previewSupport: true,  fanOut: "single", requiredFields: PNL_SPOT_FIELDS }],

  // ── pnl_prediction ────────────────────────────────────────
  // Solana predictions — single positionPubkey per buy/sell/claim
  ["solana.predict.buy",     { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS }],
  ["solana.predict.sell",    { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: PNL_PREDICTION_FIELDS }],
  ["solana.predict.claim",   { role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey"], exceptions: ["claim: no instrumentKey — matches via positionKey"] }],
  ["solana.predict.closeAll",{ role: "pnl_prediction", capture: "full", expectedType: "prediction", previewSupport: false, fanOut: "items",  requiredFields: PNL_PREDICTION_FIELDS }],

  // Polymarket CLOB — dual-type: matched→prediction (position), live→order (pending)
  ["polymarket.clob.buy",    { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"] }],
  ["polymarket.clob.sell",   { role: "pnl_prediction", capture: "full", expectedType: ["prediction", "order"], previewSupport: true,  fanOut: "single", requiredFields: ["walletAddress", "status", "positionKey", "instrumentKey"] }],

  // Polymarket cancel* — order lifecycle, not prediction position
  ["polymarket.clob.cancel",       { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["polymarket.clob.cancelOrders", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS }],
  ["polymarket.clob.cancelAll",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS }],
  ["polymarket.clob.cancelMarket", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS }],

  // ── projection (orders, LP) ───────────────────────────────
  ["kyberswap.limitOrder.create",    { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.limitOrder.cancel",    { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.limitOrder.hardCancel",{ role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.limitOrder.fill",      { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.limitOrder.batchFill", { role: "projection", capture: "full", expectedType: "order", previewSupport: true,  fanOut: "items",  requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.limitOrder.cancelAll", { role: "projection", capture: "full", expectedType: "order", previewSupport: false, fanOut: "items",  requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.zap.in",              { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.zap.out",             { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS }],
  ["kyberswap.zap.migrate",         { role: "projection", capture: "full", expectedType: "lp",    previewSupport: true,  fanOut: "single", requiredFields: PROJECTION_FIELDS }],

  // ── audit (capture: full) ─────────────────────────────────
  ["khalani.bridge",           { role: "audit", capture: "full", expectedType: "bridge",       previewSupport: true,  fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["solana.lend.deposit",      { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["solana.lend.withdraw",     { role: "audit", capture: "full", expectedType: "lend",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["slop.fees.claimCreator",   { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["slop.fees.lpCollect",      { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["slop.reward.claim",        { role: "audit", capture: "full", expectedType: "reward",       previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["jaine.w0g.wrap",           { role: "audit", capture: "full", expectedType: "wrap",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["jaine.w0g.unwrap",         { role: "audit", capture: "full", expectedType: "wrap",         previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["jaine.allowance.approve",  { role: "audit", capture: "full", expectedType: "allowance",    previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["jaine.allowance.revoke",   { role: "audit", capture: "full", expectedType: "allowance",    previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],
  ["slop.token.create",        { role: "audit", capture: "full", expectedType: "token_create", previewSupport: false, fanOut: "single", requiredFields: AUDIT_FIELDS }],

  // ── audit (capture: none — address creation, no direct tx) ─
  ["polymarket.bridge.deposit",  { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["polymarket.bridge.withdraw", { role: "audit", capture: "none", expectedType: "bridge", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],

  // ── utility (no portfolio impact) ─────────────────────────
  ["echobook.post.create",            { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.post.delete",            { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.comment.create",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.comment.delete",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.follow.toggle",          { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.vote.post",              { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.vote.comment",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.repost",                 { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.profile.update",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.submolt.join",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.submolt.leave",          { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.tradeProof.submit",      { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["echobook.notifications.markRead", { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["slop-app.profile.register",       { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["slop-app.image.upload",           { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["slop-app.image.generate",         { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["slop-app.chat.post",              { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
  ["polymarket.clob.heartbeat",       { role: "utility", capture: "none", expectedType: "social", previewSupport: false, fanOut: "single", requiredFields: NO_FIELDS }],
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
