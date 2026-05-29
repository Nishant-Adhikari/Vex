/**
 * codex-002 Phase 2 — behavior-preservation (equivalence) tests for the Zod
 * rewrite of `src/tools/polymarket/bridge/validation.ts`.
 *
 * Bridge responses feed wallet deposit/withdraw/quote flows. Three validators
 * are LENIENT-DEFAULTING (never throw; whole list collapses to []/{address:{}}
 * on a bad root); `validateQuoteResponse` is MIXED — it throws the plain
 * `Error("Expected quote response")` on a root-type mismatch then defaults
 * every field.
 *
 * CRITICAL number behavior: the ORIGINAL guards numeric fields with a bare
 * `typeof x === "number"` (NOT `!Number.isNaN`), so it ACCEPTS NaN AND
 * ±Infinity. These tests pin that: Infinity is accepted AND NaN is accepted
 * (proving the conversion did not use `z.number()` / `zNumberField` /
 * `zOptionalNumber`, all of which reject NaN). String fields use bare
 * `typeof x === "string"`, so an empty string passes through (NOT
 * asOptionalString semantics).
 *
 * Expected outputs are derived from an inline ORACLE that reproduces the
 * pre-conversion hand-written logic verbatim.
 */

import { describe, it, expect } from "vitest";
import {
  validateSupportedAssetsResponse,
  validateDepositResponse,
  validateQuoteResponse,
  validateTransactionsResponse,
} from "@tools/polymarket/bridge/validation.js";
import type {
  BridgeSupportedAsset,
  BridgeDepositResponse,
  BridgeQuoteResponse,
  BridgeTransaction,
} from "@tools/polymarket/bridge/types.js";

// ── ORACLE: verbatim reproduction of the ORIGINAL hand-written logic ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oSupportedAssets(raw: unknown): BridgeSupportedAsset[] {
  if (!isRecord(raw) || !Array.isArray(raw.supportedAssets)) return [];
  return raw.supportedAssets.map((a: unknown) => {
    if (!isRecord(a)) return { chainId: "", chainName: "", token: { name: "", symbol: "", address: "", decimals: 0 }, minCheckoutUsd: 0 };
    const token = isRecord(a.token) ? a.token : {};
    return {
      chainId: typeof a.chainId === "string" ? a.chainId : "",
      chainName: typeof a.chainName === "string" ? a.chainName : "",
      token: {
        name: typeof token.name === "string" ? token.name : "",
        symbol: typeof token.symbol === "string" ? token.symbol : "",
        address: typeof token.address === "string" ? token.address : "",
        decimals: typeof token.decimals === "number" ? token.decimals : 0,
      },
      minCheckoutUsd: typeof a.minCheckoutUsd === "number" ? a.minCheckoutUsd : 0,
    };
  });
}

function oDeposit(raw: unknown): BridgeDepositResponse {
  if (!isRecord(raw)) return { address: {} };
  const addr = isRecord(raw.address) ? raw.address : {};
  return {
    address: {
      evm: typeof addr.evm === "string" ? addr.evm : undefined,
      svm: typeof addr.svm === "string" ? addr.svm : undefined,
      btc: typeof addr.btc === "string" ? addr.btc : undefined,
    },
    note: typeof raw.note === "string" ? raw.note : undefined,
  };
}

function oQuote(raw: unknown): BridgeQuoteResponse {
  if (!isRecord(raw)) throw new Error("Expected quote response");
  return {
    estCheckoutTimeMs: typeof raw.estCheckoutTimeMs === "number" ? raw.estCheckoutTimeMs : 0,
    estInputUsd: typeof raw.estInputUsd === "number" ? raw.estInputUsd : 0,
    estOutputUsd: typeof raw.estOutputUsd === "number" ? raw.estOutputUsd : 0,
    estToTokenBaseUnit: typeof raw.estToTokenBaseUnit === "string" ? raw.estToTokenBaseUnit : "0",
    quoteId: typeof raw.quoteId === "string" ? raw.quoteId : "",
    estFeeBreakdown: isRecord(raw.estFeeBreakdown) ? {
      gasUsd: typeof raw.estFeeBreakdown.gasUsd === "number" ? raw.estFeeBreakdown.gasUsd : 0,
      totalImpactUsd: typeof raw.estFeeBreakdown.totalImpactUsd === "number" ? raw.estFeeBreakdown.totalImpactUsd : 0,
      minReceived: typeof raw.estFeeBreakdown.minReceived === "number" ? raw.estFeeBreakdown.minReceived : 0,
    } : undefined,
  };
}

function oTransactions(raw: unknown): BridgeTransaction[] {
  if (!isRecord(raw) || !Array.isArray(raw.transactions)) return [];
  return raw.transactions.map((t: unknown) => {
    if (!isRecord(t)) return { fromChainId: "", fromTokenAddress: "", fromAmountBaseUnit: "", toChainId: "", toTokenAddress: "", status: "FAILED" as const };
    return {
      fromChainId: typeof t.fromChainId === "string" ? t.fromChainId : "",
      fromTokenAddress: typeof t.fromTokenAddress === "string" ? t.fromTokenAddress : "",
      fromAmountBaseUnit: typeof t.fromAmountBaseUnit === "string" ? t.fromAmountBaseUnit : "",
      toChainId: typeof t.toChainId === "string" ? t.toChainId : "",
      toTokenAddress: typeof t.toTokenAddress === "string" ? t.toTokenAddress : "",
      status: typeof t.status === "string" ? t.status as BridgeTransaction["status"] : "FAILED",
      txHash: typeof t.txHash === "string" ? t.txHash : undefined,
      createdTimeMs: typeof t.createdTimeMs === "number" ? t.createdTimeMs : undefined,
    };
  });
}

// ── Root batteries ─────────────────────────────────────────────────────
const nonRecordRoots: ReadonlyArray<readonly [string, unknown]> = [
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  ["string", "bad"],
  ["boolean", true],
  ["array", [1, 2, 3]],
];

// ── validateSupportedAssetsResponse (lenient, never throws) ────────────

describe("validateSupportedAssetsResponse — equivalence", () => {
  const valid = {
    supportedAssets: [
      { chainId: "1", chainName: "Ethereum", token: { name: "USDC", symbol: "USDC", address: "0x1", decimals: 6 }, minCheckoutUsd: 45 },
    ],
  };
  // mixed: non-record element (defaults), wrong-typed fields, non-record token,
  // empty-string fields pass through, missing numbers default to 0.
  const mixed = {
    supportedAssets: [
      { chainId: 1, chainName: "", token: "notarecord", minCheckoutUsd: "x" }, // chainId wrong->"" ; chainName ""->"" ; token {}->all defaults ; minCheckoutUsd "x"->0
      "junk",                                                                   // non-record element -> full default
      null,                                                                     // non-record element -> full default
      { token: { name: "T", symbol: 5, address: "", decimals: "6" } },          // partial token: symbol wrong->"" ; decimals "6"->0
    ],
  };

  it.each([
    ["valid", valid],
    ["mixed (defaults / coercions / non-record elements)", mixed],
    ["empty object -> []", {}],
    ["non-array supportedAssets -> []", { supportedAssets: "nope" }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateSupportedAssetsResponse(input)).toEqual(oSupportedAssets(input));
  });

  it.each(nonRecordRoots)("returns [] (no throw) on non-record root: %s", (_l, root) => {
    expect(validateSupportedAssetsResponse(root)).toEqual([]);
    expect(oSupportedAssets(root)).toEqual([]);
  });

  it("ACCEPTS Infinity AND NaN for numeric fields (bare typeof, not z.number)", () => {
    const input = { supportedAssets: [{ token: { decimals: Infinity }, minCheckoutUsd: NaN }] };
    const out = validateSupportedAssetsResponse(input);
    expect(out[0].token.decimals).toBe(Infinity);
    expect(Number.isNaN(out[0].minCheckoutUsd)).toBe(true);
    expect(out).toEqual(oSupportedAssets(input));
  });
});

// ── validateDepositResponse (lenient, never throws) ────────────────────

describe("validateDepositResponse — equivalence", () => {
  it.each([
    ["full addresses + note", { address: { evm: "0xabc", svm: "sol123", btc: "bc1q..." }, note: "test" }],
    ["empty-string evm passes through (NOT asOptionalString)", { address: { evm: "" }, note: "" }],
    ["wrong-typed address fields -> undefined", { address: { evm: 5, svm: null, btc: {} }, note: 9 }],
    ["non-record address -> {} (all undefined)", { address: "nope" }],
    ["missing address -> all undefined", {}],
    ["extra keys stripped", { address: { evm: "0x1", extra: "drop" }, note: "n", other: 1 }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateDepositResponse(input)).toEqual(oDeposit(input));
  });

  it("preserves empty string (does not collapse to undefined)", () => {
    const r = validateDepositResponse({ address: { evm: "" } });
    expect(r.address.evm).toBe("");
    expect(r.address.svm).toBeUndefined();
  });

  it.each(nonRecordRoots)("returns { address: {} } (no throw) on non-record root: %s", (_l, root) => {
    expect(validateDepositResponse(root)).toEqual({ address: {} });
    expect(oDeposit(root)).toEqual({ address: {} });
  });
});

// ── validateQuoteResponse (MIXED: throws plain Error on bad root) ───────

describe("validateQuoteResponse — equivalence", () => {
  const valid = { estCheckoutTimeMs: 25000, estInputUsd: 10, estOutputUsd: 9.95, estToTokenBaseUnit: "9950000", quoteId: "0xq1", estFeeBreakdown: { gasUsd: 0.5, totalImpactUsd: 0.1, minReceived: 9.9 } };
  const partial = {}; // every field defaults; estFeeBreakdown -> undefined
  const wrongTyped = { estCheckoutTimeMs: "x", estInputUsd: "y", estOutputUsd: null, estToTokenBaseUnit: 5, quoteId: 9, estFeeBreakdown: "nope" };
  const feeBreakdownPartial = { estFeeBreakdown: { gasUsd: 1 } }; // totalImpactUsd/minReceived default 0

  it.each([
    ["valid (incl. fee breakdown)", valid],
    ["partial -> all defaults, estFeeBreakdown undefined", partial],
    ["wrong-typed -> defaults, non-record fee breakdown -> undefined", wrongTyped],
    ["partial fee breakdown -> missing fee fields default 0", feeBreakdownPartial],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateQuoteResponse(input)).toEqual(oQuote(input));
  });

  it("ACCEPTS Infinity AND NaN for numeric fields (recon: do NOT reject)", () => {
    const input = { estInputUsd: Infinity, estOutputUsd: NaN, estCheckoutTimeMs: -Infinity, estFeeBreakdown: { gasUsd: Infinity, totalImpactUsd: NaN, minReceived: 1 } };
    const out = validateQuoteResponse(input);
    expect(out.estInputUsd).toBe(Infinity);
    expect(Number.isNaN(out.estOutputUsd)).toBe(true);
    expect(out.estCheckoutTimeMs).toBe(-Infinity);
    expect(out.estFeeBreakdown?.gasUsd).toBe(Infinity);
    expect(Number.isNaN(out.estFeeBreakdown?.totalImpactUsd ?? 0)).toBe(true);
    expect(out).toEqual(oQuote(input));
  });

  it("does NOT coerce a missing numeric field to anything other than the original default", () => {
    // recon flag: missing numeric fields default to the ORIGINAL's 0, not silently dropped.
    const out = validateQuoteResponse({ quoteId: "q" });
    expect(out.estInputUsd).toBe(0);
    expect(out.estOutputUsd).toBe(0);
    expect(out.estCheckoutTimeMs).toBe(0);
    expect(out).toEqual(oQuote({ quoteId: "q" }));
  });

  it.each(nonRecordRoots)("throws plain Error on non-record root: %s", (_l, root) => {
    expect(() => validateQuoteResponse(root)).toThrowError(new Error("Expected quote response"));
    expect(() => oQuote(root)).toThrowError(new Error("Expected quote response"));
  });
});

// ── validateTransactionsResponse (lenient, never throws) ───────────────

describe("validateTransactionsResponse — equivalence", () => {
  const valid = {
    transactions: [
      { fromChainId: "1", fromTokenAddress: "0x1", fromAmountBaseUnit: "1000000", toChainId: "137", toTokenAddress: "0x2", status: "COMPLETED", txHash: "0xtx", createdTimeMs: 1700000000000 },
    ],
  };
  const mixed = {
    transactions: [
      { status: "WEIRD_NOT_IN_UNION" },   // any string cast through (no enum check)
      { status: 5 },                       // non-string status -> "FAILED"
      "junk",                              // non-record element -> full default
      null,                                // non-record element -> full default
      { txHash: 9, createdTimeMs: "x" },   // wrong-typed optionals -> undefined
    ],
  };

  it.each([
    ["valid", valid],
    ["mixed (status cast, non-record elements, wrong-typed optionals)", mixed],
    ["empty object -> []", {}],
    ["non-array transactions -> []", { transactions: { a: 1 } }],
  ])("matches oracle: %s", (_l, input) => {
    expect(validateTransactionsResponse(input)).toEqual(oTransactions(input));
  });

  it("casts any string status through without enum membership check", () => {
    const r = validateTransactionsResponse({ transactions: [{ status: "TOTALLY_BOGUS" }] });
    expect(r[0].status).toBe("TOTALLY_BOGUS");
  });

  it("optional createdTimeMs ACCEPTS Infinity/NaN (bare typeof, not zOptionalNumber)", () => {
    const input = { transactions: [{ createdTimeMs: Infinity }, { createdTimeMs: NaN }] };
    const out = validateTransactionsResponse(input);
    expect(out[0].createdTimeMs).toBe(Infinity);
    expect(Number.isNaN(out[1].createdTimeMs ?? 0)).toBe(true);
    expect(out).toEqual(oTransactions(input));
  });

  it("optional txHash empty string passes through (NOT asOptionalString)", () => {
    const r = validateTransactionsResponse({ transactions: [{ txHash: "" }] });
    expect(r[0].txHash).toBe("");
  });

  it.each(nonRecordRoots)("returns [] (no throw) on non-record root: %s", (_l, root) => {
    expect(validateTransactionsResponse(root)).toEqual([]);
    expect(oTransactions(root)).toEqual([]);
  });
});
