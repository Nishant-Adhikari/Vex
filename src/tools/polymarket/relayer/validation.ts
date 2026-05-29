/**
 * Runtime validators for Polymarket Relayer API responses.
 *
 * codex-002 Phase 2 (full uniformity): these gate the SHAPE of relayer
 * (gasless tx submission) responses at the HTTP boundary. The values feed
 * wallet/transaction tracking flows, so the conversion is BEHAVIOUR-PRESERVING.
 *
 * The relayer client is MIXED per-function:
 *   - `validateSubmitResponse` and `validateTransactionsResponse` throw the
 *     SAME plain `Error` the hand-written code threw on a ROOT-type mismatch
 *     (object/array expected); `validateTransactionsResponse` also throws the
 *     plain `Error("transaction must be an object")` per non-record element.
 *   - `validateApiKeysResponse`, `validateNonceResponse`, and
 *     `validateDeployedResponse` NEVER throw — a bad root collapses to the
 *     original default (`[]` / `{ nonce: "0" }` / `{ deployed: false }`), and
 *     `validateApiKeysResponse` maps each non-record element to a default
 *     object (it does NOT filter elements out).
 *   - Every field is LENIENT-DEFAULTING (`typeof x === "string" ? x : ""` etc.);
 *     no field rejects.
 *
 * The schemas are intentionally NOT the type source of truth — the wire
 * interfaces in `types.ts` remain canonical, and each exported validator keeps
 * its declared return type so `tsc` verifies the inferred schema output is
 * assignable to that interface. The exported function API (names, signatures,
 * return types) is preserved so `client.ts` call sites stay unchanged.
 */

import { z } from "zod";
import type { RelayerSubmitResponse, RelayerTransaction, RelayerApiKey } from "./types.js";

// ── Lenient field primitive ────────────────────────────────────────────
//
// Mirrors the hand-written `typeof v === "string" ? v : def` guard. Never
// rejects: a wrong-typed/missing field is replaced with the same default the
// original produced, so the enclosing object schema fails ONLY on a root-type
// mismatch (and those mismatches are handled explicitly per function below).

/** `typeof v === "string" ? v : def` */
const strDefault = (def: string) => z.unknown().transform((v) => (typeof v === "string" ? v : def));

// ── SubmitResponse (throws plain Error on bad root) ────────────────────

const submitResponseSchema = z.object({
  transactionID: strDefault(""),
  transactionHash: strDefault(""),
  state: strDefault("STATE_NEW"),
});

export function validateSubmitResponse(raw: unknown): RelayerSubmitResponse {
  const parsed = submitResponseSchema.safeParse(raw);
  if (!parsed.success) throw new Error("Expected submit response");
  return parsed.data;
}

// ── Transactions (throws plain Error on bad root + bad element) ────────
//
// `state`: the original kept any string via `as RelayerTransaction["state"]`,
// defaulting to "STATE_NEW" otherwise — a lenient string with that default,
// then asserted to the union type. `type`: `=== "SAFE" ? "SAFE" : "PROXY"`.

const transactionStateSchema: z.ZodType<RelayerTransaction["state"]> = z
  .unknown()
  // Preserve the original cast: any string is accepted as-is (asserted to the
  // declared union), non-strings default to "STATE_NEW".
  .transform((v) => (typeof v === "string" ? (v as RelayerTransaction["state"]) : "STATE_NEW"));

const transactionTypeSchema = z.unknown().transform((v) => (v === "SAFE" ? "SAFE" : "PROXY"));

const transactionSchema = z.object({
  transactionID: strDefault(""),
  transactionHash: strDefault(""),
  from: strDefault(""),
  to: strDefault(""),
  proxyAddress: strDefault(""),
  data: strDefault(""),
  nonce: strDefault(""),
  state: transactionStateSchema,
  type: transactionTypeSchema,
  owner: strDefault(""),
  createdAt: strDefault(""),
  updatedAt: strDefault(""),
});

function parseTransaction(raw: unknown): RelayerTransaction {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("transaction must be an object");
  }
  // Schema only fails on a root mismatch, which we already rejected above.
  return transactionSchema.parse(raw);
}

export function validateTransactionsResponse(raw: unknown): RelayerTransaction[] {
  if (!Array.isArray(raw)) throw new Error("Expected transactions array");
  return raw.map(parseTransaction);
}

// ── ApiKeys (never throws; non-record element → default object) ────────

const apiKeySchema = z.object({
  apiKey: strDefault(""),
  address: strDefault(""),
  createdAt: strDefault(""),
  updatedAt: strDefault(""),
});

export function validateApiKeysResponse(raw: unknown): RelayerApiKey[] {
  if (!Array.isArray(raw)) return [];
  // The original MAPS (not filters) each element: a non-record element becomes
  // a fully-defaulted object, NOT dropped. apiKeySchema fails only on a root
  // mismatch, so non-record elements collapse to the default object.
  return raw.map((k) => {
    const parsed = apiKeySchema.safeParse(k);
    return parsed.success ? parsed.data : { apiKey: "", address: "", createdAt: "", updatedAt: "" };
  });
}

// ── Nonce (never throws; bad root → { nonce: "0" }) ────────────────────

const nonceResponseSchema = z.object({ nonce: strDefault("0") });

export function validateNonceResponse(raw: unknown): { nonce: string } {
  const parsed = nonceResponseSchema.safeParse(raw);
  if (!parsed.success) return { nonce: "0" };
  return parsed.data;
}

// ── Deployed (never throws; bad root → { deployed: false }) ────────────

const deployedResponseSchema = z.object({
  deployed: z.unknown().transform((v) => v === true),
});

export function validateDeployedResponse(raw: unknown): { deployed: boolean } {
  const parsed = deployedResponseSchema.safeParse(raw);
  if (!parsed.success) return { deployed: false };
  return parsed.data;
}
