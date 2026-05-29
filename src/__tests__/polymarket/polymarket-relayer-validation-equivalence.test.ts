/**
 * codex-002 Phase 2 — behaviour-preservation (equivalence) tests for the Zod
 * rewrite of `src/tools/polymarket/relayer/validation.ts`.
 *
 * Relayer responses (gasless tx submission, tx tracking, nonce, deployed,
 * api-keys) are FINANCIAL: they confirm tx hashes / signatures and feed wallet
 * tracking. The relayer validators are MIXED:
 *   - submit / transactions throw a plain `Error` on a ROOT mismatch;
 *     transactions also throws per non-record element.
 *   - apiKeys / nonce / deployed NEVER throw (bad root → default; apiKeys maps
 *     each element to a default object rather than dropping it).
 *   - every field is lenient-defaulting (`typeof === "string" ? x : def`,
 *     state default "STATE_NEW", type `=== "SAFE" ? "SAFE" : "PROXY"`,
 *     deployed `=== true`).
 *
 * This file pins the NEW implementation against an inline ORACLE that
 * reproduces the ORIGINAL hand-written logic verbatim, over a battery of
 * inputs: fully-valid, partial/missing (each default asserted), wrong-typed,
 * arrays with bad elements, and non-record/non-array roots (same throw type +
 * message OR same default).
 */

import { describe, it, expect } from "vitest";
import {
  validateSubmitResponse,
  validateTransactionsResponse,
  validateApiKeysResponse,
  validateNonceResponse,
  validateDeployedResponse,
} from "@tools/polymarket/relayer/validation.js";

// ── ORACLE: verbatim reproduction of the ORIGINAL hand-written logic ───

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function oSubmit(raw: unknown) {
  if (!isRecord(raw)) throw new Error("Expected submit response");
  return {
    transactionID: typeof raw.transactionID === "string" ? raw.transactionID : "",
    transactionHash: typeof raw.transactionHash === "string" ? raw.transactionHash : "",
    state: typeof raw.state === "string" ? raw.state : "STATE_NEW",
  };
}

function oTransactions(raw: unknown) {
  if (!Array.isArray(raw)) throw new Error("Expected transactions array");
  return raw.map((t) => {
    if (!isRecord(t)) throw new Error("transaction must be an object");
    return {
      transactionID: typeof t.transactionID === "string" ? t.transactionID : "",
      transactionHash: typeof t.transactionHash === "string" ? t.transactionHash : "",
      from: typeof t.from === "string" ? t.from : "",
      to: typeof t.to === "string" ? t.to : "",
      proxyAddress: typeof t.proxyAddress === "string" ? t.proxyAddress : "",
      data: typeof t.data === "string" ? t.data : "",
      nonce: typeof t.nonce === "string" ? t.nonce : "",
      state: typeof t.state === "string" ? t.state : "STATE_NEW",
      type: t.type === "SAFE" ? "SAFE" : "PROXY",
      owner: typeof t.owner === "string" ? t.owner : "",
      createdAt: typeof t.createdAt === "string" ? t.createdAt : "",
      updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : "",
    };
  });
}

function oApiKeys(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => {
    if (!isRecord(k)) return { apiKey: "", address: "", createdAt: "", updatedAt: "" };
    return {
      apiKey: typeof k.apiKey === "string" ? k.apiKey : "",
      address: typeof k.address === "string" ? k.address : "",
      createdAt: typeof k.createdAt === "string" ? k.createdAt : "",
      updatedAt: typeof k.updatedAt === "string" ? k.updatedAt : "",
    };
  });
}

function oNonce(raw: unknown) {
  if (!isRecord(raw)) return { nonce: "0" };
  return { nonce: typeof raw.nonce === "string" ? raw.nonce : "0" };
}

function oDeployed(raw: unknown) {
  if (!isRecord(raw)) return { deployed: false };
  return { deployed: raw.deployed === true };
}

// Helper: assert new == oracle, or both throw the same plain Error message.
function expectSame<T>(fn: (r: unknown) => T, oracle: (r: unknown) => T, raw: unknown): void {
  let newErr: unknown;
  let newVal: T | undefined;
  try {
    newVal = fn(raw);
  } catch (e) {
    newErr = e;
  }
  let oracleErr: unknown;
  let oracleVal: T | undefined;
  try {
    oracleVal = oracle(raw);
  } catch (e) {
    oracleErr = e;
  }
  if (oracleErr !== undefined) {
    expect(newErr, `expected throw for ${JSON.stringify(raw)}`).toBeInstanceOf(Error);
    expect((newErr as Error).constructor).toBe((oracleErr as Error).constructor); // plain Error, not VexError
    expect((newErr as Error).message).toBe((oracleErr as Error).message);
  } else {
    expect(newErr, `unexpected throw for ${JSON.stringify(raw)}: ${String(newErr)}`).toBeUndefined();
    expect(newVal).toEqual(oracleVal);
  }
}

// ── Input batteries ────────────────────────────────────────────────────

const fullTx = {
  transactionID: "id1",
  transactionHash: "0xhash",
  from: "0x1",
  to: "0x2",
  proxyAddress: "0x3",
  data: "0x",
  nonce: "5",
  state: "STATE_CONFIRMED",
  type: "SAFE",
  owner: "0x1",
  createdAt: "2024-01-01",
  updatedAt: "2024-01-01",
};

const badRoots: unknown[] = [null, undefined, 1, "str", true, NaN, Infinity];
const nonArrayRoots: unknown[] = [null, undefined, 1, "str", true, {}, { nonce: "1" }];
const nonRecordRoots: unknown[] = [null, undefined, 1, "str", true, [], [1, 2]];

describe("validateSubmitResponse equivalence (throws plain Error on bad root)", () => {
  it("valid full object", () => {
    expectSame(validateSubmitResponse, oSubmit, {
      transactionID: "uuid-1",
      transactionHash: "0xabc",
      state: "STATE_MINED",
    });
  });
  it("partial / missing → defaults land exactly", () => {
    const out = validateSubmitResponse({});
    expect(out).toEqual({ transactionID: "", transactionHash: "", state: "STATE_NEW" });
    expectSame(validateSubmitResponse, oSubmit, { transactionID: "only-id" });
  });
  it("wrong-typed fields → defaults", () => {
    expectSame(validateSubmitResponse, oSubmit, {
      transactionID: 123,
      transactionHash: null,
      state: { x: 1 },
    });
  });
  it("non-record roots (incl. array) throw 'Expected submit response'", () => {
    for (const r of [...badRoots, [], [fullTx]]) {
      expectSame(validateSubmitResponse, oSubmit, r);
    }
    expect(() => validateSubmitResponse(null)).toThrow("Expected submit response");
  });
});

describe("validateTransactionsResponse equivalence", () => {
  it("valid array", () => {
    expectSame(validateTransactionsResponse, oTransactions, [fullTx]);
    const out = validateTransactionsResponse([fullTx]);
    expect(out[0].state).toBe("STATE_CONFIRMED");
    expect(out[0].type).toBe("SAFE");
  });
  it("partial element → defaults; unknown state string kept; non-SAFE type → PROXY", () => {
    expectSame(validateTransactionsResponse, oTransactions, [{ state: "WHATEVER_STATE", type: "PROXY" }]);
    expectSame(validateTransactionsResponse, oTransactions, [{}]);
    const out = validateTransactionsResponse([{ state: "WHATEVER_STATE", type: "unknown" }]);
    expect(out[0].state).toBe("WHATEVER_STATE"); // original cast keeps any string
    expect(out[0].type).toBe("PROXY");
  });
  it("wrong-typed fields → defaults; state default STATE_NEW", () => {
    expectSame(validateTransactionsResponse, oTransactions, [
      { transactionID: 1, state: 5, type: 5, owner: null },
    ]);
    const out = validateTransactionsResponse([{ state: 5 }]);
    expect(out[0].state).toBe("STATE_NEW");
  });
  it("non-array root throws 'Expected transactions array'", () => {
    for (const r of nonArrayRoots) expectSame(validateTransactionsResponse, oTransactions, r);
    expect(() => validateTransactionsResponse(null)).toThrow("Expected transactions array");
  });
  it("non-record element throws 'transaction must be an object' (good elements before it still kept by oracle order)", () => {
    for (const bad of [null, 1, "x", true, []]) {
      expectSame(validateTransactionsResponse, oTransactions, [fullTx, bad]);
    }
    expect(() => validateTransactionsResponse([fullTx, null])).toThrow("transaction must be an object");
  });
});

describe("validateApiKeysResponse equivalence (never throws; maps non-record element to default obj)", () => {
  it("valid array", () => {
    expectSame(validateApiKeysResponse, oApiKeys, [
      { apiKey: "key1", address: "0x1", createdAt: "2024-01-01", updatedAt: "2024-01-01" },
    ]);
  });
  it("partial / wrong-typed element → defaults", () => {
    expectSame(validateApiKeysResponse, oApiKeys, [{}]);
    expectSame(validateApiKeysResponse, oApiKeys, [{ apiKey: 5, address: null }]);
    const out = validateApiKeysResponse([{ apiKey: 5 }]);
    expect(out).toEqual([{ apiKey: "", address: "", createdAt: "", updatedAt: "" }]);
  });
  it("non-record elements are MAPPED to default objects, not dropped", () => {
    for (const bad of [null, 1, "x", true, []]) {
      expectSame(validateApiKeysResponse, oApiKeys, [bad]);
    }
    const out = validateApiKeysResponse([null, { apiKey: "k" }, 5]);
    expect(out).toHaveLength(3); // not filtered out
    expect(out[0]).toEqual({ apiKey: "", address: "", createdAt: "", updatedAt: "" });
    expect(out[1].apiKey).toBe("k");
    expect(out[2]).toEqual({ apiKey: "", address: "", createdAt: "", updatedAt: "" });
  });
  it("non-array root → [] (never throws)", () => {
    for (const r of nonRecordRoots.filter((x) => !Array.isArray(x))) {
      expectSame(validateApiKeysResponse, oApiKeys, r);
    }
    expect(validateApiKeysResponse(null)).toEqual([]);
  });
});

describe("validateNonceResponse equivalence (never throws)", () => {
  it("valid + partial + wrong-typed", () => {
    expectSame(validateNonceResponse, oNonce, { nonce: "31" });
    expectSame(validateNonceResponse, oNonce, {});
    expectSame(validateNonceResponse, oNonce, { nonce: 31 });
    expect(validateNonceResponse({}).nonce).toBe("0");
  });
  it("non-record root → { nonce: '0' }", () => {
    for (const r of nonRecordRoots) expectSame(validateNonceResponse, oNonce, r);
    expect(validateNonceResponse([{ nonce: "1" }])).toEqual({ nonce: "0" });
  });
});

describe("validateDeployedResponse equivalence (never throws; === true)", () => {
  it("deployed=true only for literal true", () => {
    expectSame(validateDeployedResponse, oDeployed, { deployed: true });
    expectSame(validateDeployedResponse, oDeployed, { deployed: "true" });
    expectSame(validateDeployedResponse, oDeployed, { deployed: 1 });
    expectSame(validateDeployedResponse, oDeployed, {});
    expect(validateDeployedResponse({ deployed: true }).deployed).toBe(true);
    expect(validateDeployedResponse({ deployed: "true" }).deployed).toBe(false);
  });
  it("non-record root → { deployed: false }", () => {
    for (const r of nonRecordRoots) expectSame(validateDeployedResponse, oDeployed, r);
    expect(validateDeployedResponse([{ deployed: true }])).toEqual({ deployed: false });
  });
});
