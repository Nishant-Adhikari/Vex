/**
 * Mission contract hash — canonical, deterministic SHA-256 of the
 * runtime-relevant portion of a mission draft.
 *
 * Why a custom canonicalizer:
 *
 *   `JSON.stringify(obj, Object.keys(obj).sort())` only sorts keys at
 *   one depth (replacer signature is `(key, value)` per recursion
 *   level, not "sort everything"). For puzzle 04 the canonical contract
 *   material happens to be flat, but the helper below recurses through
 *   nested objects anyway so the function is safe if/when we widen the
 *   shape (e.g. structured `capitalSource`). RFC 8785 / JCS would be
 *   the official spec; we ship a minimal version sufficient for this
 *   contract.
 *
 * What goes into the hash:
 *
 *   - runtime-affecting fields only: goal, capitalSource, startingCapital,
 *     riskProfile, deadline, allowedWallets, allowedChains, allowedProtocols,
 *     successCriteria, stopConditions
 *   - the version literal `v: 1` so future shape migrations get a new
 *     `contract_hash_version` without quietly producing matching hashes
 *
 * What does NOT go into the hash:
 *
 *   - `title` (display-only; renaming should not invalidate acceptance)
 *   - `approvedAt` (mutable, written by the legacy `setApprovedAt` path)
 *   - mission row metadata (`id`, `rootSessionId`, timestamps)
 *   - raw `capitalSourceJson` blob — only the derived `capitalSource`
 *     + `startingCapital` strings (per codex review on the canonical
 *     contract material)
 *
 * Normalization rules:
 *
 *   - whitespace is trimmed; empty strings collapse to `null` (so
 *     "  " and "" and `null` and `undefined` all hash identically)
 *   - `allowedChains` is lowercased + sorted (chain ids are
 *     case-insensitive in repo convention; their order does not affect
 *     runtime)
 *   - `allowedWallets` and `allowedProtocols` are trimmed + sorted
 *     (the set is what matters, not the order)
 *   - `successCriteria` and `stopConditions` preserve user-given
 *     order — they are sequential rules / commitments and reordering
 *     changes intent
 *   - `startingCapital` accepts string only — numeric coercion is
 *     intentionally rejected to avoid lossy float→string conversion
 *     (e.g. `1.0` → `"1"` losing user-meaningful precision). The
 *     `MissionDraft` type already declares the field as `string | null`.
 */

import { createHash } from "node:crypto";
import { z } from "zod";

import type { MissionDraft } from "../types.js";

/** Bumped when the canonical shape or hashing rules change. */
export const CONTRACT_HASH_VERSION = 1;

const CanonicalContractMaterialSchema = z.object({
  v: z.literal(CONTRACT_HASH_VERSION),
  goal: z.string().nullable(),
  capitalSource: z.string().nullable(),
  startingCapital: z.string().nullable(),
  riskProfile: z.string().nullable(),
  deadline: z.string().nullable(),
  allowedWallets: z.array(z.string()),
  allowedChains: z.array(z.string()),
  allowedProtocols: z.array(z.string()),
  successCriteria: z.array(z.string()),
  stopConditions: z.array(z.string()),
}).strict();

export type CanonicalContractMaterial = z.infer<typeof CanonicalContractMaterialSchema>;

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function normalizeStringArray(values: readonly string[] | null | undefined): string[] {
  if (values === null || values === undefined) return [];
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function normalizeChainArray(values: readonly string[] | null | undefined): string[] {
  return normalizeStringArray(values).map((s) => s.toLowerCase());
}

/** Build the canonical contract material from a `MissionDraft`. */
export function buildContractMaterial(draft: MissionDraft): CanonicalContractMaterial {
  const material = {
    v: CONTRACT_HASH_VERSION as typeof CONTRACT_HASH_VERSION,
    goal: normalizeNullableString(draft.goal),
    capitalSource: normalizeNullableString(draft.capitalSource),
    startingCapital: normalizeNullableString(draft.startingCapital),
    riskProfile: normalizeNullableString(draft.riskProfile),
    deadline: normalizeNullableString(draft.deadline),
    allowedWallets: [...normalizeStringArray(draft.allowedWallets)].sort(),
    allowedChains: [...normalizeChainArray(draft.allowedChains)].sort(),
    allowedProtocols: [...normalizeStringArray(draft.allowedProtocols)].sort(),
    // successCriteria + stopConditions intentionally preserve order.
    successCriteria: normalizeStringArray(draft.successCriteria),
    stopConditions: normalizeStringArray(draft.stopConditions),
  };
  // The .parse() call doubles as an invariant check — if any of the
  // normalizers drifts and produces a wrong-shape value, we catch it
  // here instead of producing a silently-wrong hash.
  return CanonicalContractMaterialSchema.parse(material);
}

/**
 * Deterministic JSON serialization: sorts object keys at every depth,
 * uses native `JSON.stringify` for primitives + arrays. Arrays are
 * serialized in given order (caller must pre-sort sets where order is
 * irrelevant — `buildContractMaterial` does so for chain/wallet/
 * protocol arrays).
 */
export function canonicalStringify(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]));
  return "{" + parts.join(",") + "}";
}

/**
 * SHA-256 hex of the canonical material. 64-char lowercase hex
 * string. Two drafts that differ only in whitespace, key ordering, or
 * set ordering produce the same hash; two drafts that differ in
 * runtime-affecting content produce different hashes.
 */
export function computeContractHash(draft: MissionDraft): string {
  const material = buildContractMaterial(draft);
  const canonical = canonicalStringify(material);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
