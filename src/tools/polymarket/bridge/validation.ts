/**
 * Runtime validators for Polymarket Bridge API responses.
 *
 * codex-002 Phase 2: these gate the SHAPE of bridge supported-assets, deposit,
 * quote, and transaction-status responses at the HTTP boundary (the values feed
 * wallet deposit/withdraw/quote flows). Three validators are LENIENT-DEFAULTING
 * (every field falls back to a safe default and the whole list collapses to `[]`
 * / `{ address: {} }` on a bad root — they NEVER throw); `validateQuoteResponse`
 * is MIXED: it throws the SAME plain `Error("Expected quote response")` on a
 * root-type mismatch, then defaults every field.
 *
 * IMPORTANT (financial recon): the original guards every numeric field with a
 * bare `typeof x === "number"` — NOT `!Number.isNaN(x)` and NOT a non-empty/
 * non-zero check. That means it ACCEPTS `NaN` and `±Infinity` and only falls
 * back to its default when the field is missing or non-numeric. The shared
 * `zNumberField`/`zOptionalNumber` helpers REJECT `NaN`, so they would change
 * accept/reject behavior here and are deliberately NOT used; local
 * `typeof`-only transforms reproduce the original exactly. Likewise string
 * fields use bare `typeof x === "string"` (so an empty string `""` passes
 * through), which is NOT `asOptionalString`/`zOptionalString` semantics
 * (those map `""` to `undefined`), so those helpers are not used either.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface.
 */

import { z } from "zod";
import type { BridgeSupportedAsset, BridgeDepositResponse, BridgeQuoteResponse, BridgeTransaction } from "./types.js";

// ── Reusable lenient field primitives (bare `typeof`, accept NaN/"") ───
//
// Each mirrors a hand-written `typeof x === "..." ? x : default` guard. They
// never reject; the enclosing object schema fails ONLY on a root-type mismatch.

/** `typeof v === "string" ? v : def` (empty string passes through). */
const strDefault = (def: string) => z.unknown().transform((v) => (typeof v === "string" ? v : def));

/** `typeof v === "number" ? v : def` (accepts NaN/±Infinity). */
const numDefault = (def: number) => z.unknown().transform((v) => (typeof v === "number" ? v : def));

/** `typeof v === "string" ? v : undefined` (empty string passes through — NOT asOptionalString). */
const strOrUndefined = z.unknown().transform((v) => (typeof v === "string" ? v : undefined));

/** `typeof v === "number" ? v : undefined` (accepts NaN/±Infinity — NOT asOptionalNumber). */
const numOrUndefined = z.unknown().transform((v) => (typeof v === "number" ? v : undefined));

// ── BridgeSupportedAsset[] (lenient; never throws) ─────────────────────

const supportedAssetTokenSchema = z.object({
  name: strDefault(""),
  symbol: strDefault(""),
  address: strDefault(""),
  decimals: numDefault(0),
});

const supportedAssetSchema: z.ZodType<BridgeSupportedAsset> = z.unknown().transform((a) => {
  if (typeof a !== "object" || a === null || Array.isArray(a)) {
    return { chainId: "", chainName: "", token: { name: "", symbol: "", address: "", decimals: 0 }, minCheckoutUsd: 0 };
  }
  const r = a as Record<string, unknown>;
  // `isRecord(a.token) ? a.token : {}` — non-record token collapses to {} then
  // each token field defaults (the original built the token from `{}` exactly).
  const token = typeof r.token === "object" && r.token !== null && !Array.isArray(r.token) ? r.token : {};
  return {
    chainId: typeof r.chainId === "string" ? r.chainId : "",
    chainName: typeof r.chainName === "string" ? r.chainName : "",
    token: supportedAssetTokenSchema.parse(token),
    minCheckoutUsd: typeof r.minCheckoutUsd === "number" ? r.minCheckoutUsd : 0,
  };
});

export function validateSupportedAssetsResponse(raw: unknown): BridgeSupportedAsset[] {
  // Non-record root OR non-array `supportedAssets` → []; otherwise element-wise
  // map (each element defaulted; a non-record element becomes the full default).
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.supportedAssets)) return [];
  return r.supportedAssets.map((a: unknown) => supportedAssetSchema.parse(a));
}

// ── BridgeDepositResponse (lenient; never throws) ──────────────────────

const depositAddressSchema = z.object({
  evm: strOrUndefined,
  svm: strOrUndefined,
  btc: strOrUndefined,
});

const depositResponseSchema = z.object({
  // `isRecord(raw.address) ? raw.address : {}` then default each address field.
  address: z
    .unknown()
    .transform((v) => (typeof v === "object" && v !== null && !Array.isArray(v) ? v : {}))
    .pipe(depositAddressSchema),
  note: strOrUndefined,
});

export function validateDepositResponse(raw: unknown): BridgeDepositResponse {
  const parsed = depositResponseSchema.safeParse(raw);
  // Non-record root → { address: {} } (no throw). Matches `if (!isRecord(raw)) return { address: {} }`.
  if (!parsed.success) return { address: {} };
  return parsed.data;
}

// ── BridgeQuoteResponse (MIXED: throws plain Error on bad root) ─────────

const quoteFeeBreakdownSchema = z.object({
  gasUsd: numDefault(0),
  totalImpactUsd: numDefault(0),
  minReceived: numDefault(0),
});

const quoteResponseSchema = z.object({
  estCheckoutTimeMs: numDefault(0),
  estInputUsd: numDefault(0),
  estOutputUsd: numDefault(0),
  estToTokenBaseUnit: strDefault("0"),
  quoteId: strDefault(""),
  // `isRecord(raw.estFeeBreakdown) ? {...defaults} : undefined` — non-record
  // (incl. missing) → undefined; record → each fee field defaulted.
  estFeeBreakdown: z
    .unknown()
    .transform((v) =>
      typeof v === "object" && v !== null && !Array.isArray(v)
        ? quoteFeeBreakdownSchema.parse(v)
        : undefined,
    ),
});

export function validateQuoteResponse(raw: unknown): BridgeQuoteResponse {
  const parsed = quoteResponseSchema.safeParse(raw);
  // Non-record root → throw the SAME plain Error the hand-written code threw.
  if (!parsed.success) throw new Error("Expected quote response");
  return parsed.data;
}

// ── BridgeTransaction[] (lenient; never throws) ────────────────────────

const transactionSchema: z.ZodType<BridgeTransaction> = z.unknown().transform((t) => {
  if (typeof t !== "object" || t === null || Array.isArray(t)) {
    return { fromChainId: "", fromTokenAddress: "", fromAmountBaseUnit: "", toChainId: "", toTokenAddress: "", status: "FAILED" as const };
  }
  const r = t as Record<string, unknown>;
  return {
    fromChainId: typeof r.fromChainId === "string" ? r.fromChainId : "",
    fromTokenAddress: typeof r.fromTokenAddress === "string" ? r.fromTokenAddress : "",
    fromAmountBaseUnit: typeof r.fromAmountBaseUnit === "string" ? r.fromAmountBaseUnit : "",
    toChainId: typeof r.toChainId === "string" ? r.toChainId : "",
    toTokenAddress: typeof r.toTokenAddress === "string" ? r.toTokenAddress : "",
    // Original: `typeof t.status === "string" ? t.status as Status : "FAILED"` —
    // any string is cast to the union (no enum membership check); else "FAILED".
    status: typeof r.status === "string" ? (r.status as BridgeTransaction["status"]) : "FAILED",
    txHash: strOrUndefined.parse(r.txHash),
    createdTimeMs: numOrUndefined.parse(r.createdTimeMs),
  };
});

export function validateTransactionsResponse(raw: unknown): BridgeTransaction[] {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [];
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.transactions)) return [];
  return r.transactions.map((t: unknown) => transactionSchema.parse(t));
}
