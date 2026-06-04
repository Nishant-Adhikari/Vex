/**
 * Swap prequote recording (Stage 6c) + execute-time gate (Stage 7).
 *
 * RECORDER — for a SUCCESSFUL swap QUOTE this module computes:
 *   1. a deterministic match-hash over the trade identity (reused verbatim by
 *      the Stage-7 execute gate so record-time and gate-time hashes collide),
 *   2. a 3-state token-safety verdict (`pass` | `fail` | `unknown`),
 *   3. a bounded, structural-only `safetyDetail` payload,
 * then records a `swap_prequotes` row. Recording is best-effort: any failure is
 * swallowed (logged structurally) so it never alters the quote's ToolResult. A
 * missing prequote is safe — the Stage-7 gate blocks the execute instead.
 *
 * GATE (`evaluateSwapPrequoteGate`) — before a swap EXECUTE broadcasts, this
 * enforces quote-before-transaction. It BLOCKS on (no fresh matching `swap`
 * prequote) OR (a fresh `fail` row); both `pass` AND `unknown` PASS the gate.
 * An allowed `unknown` is surfaced in the restricted-mode approval preview
 * ("safety: UNVERIFIED") and logged in full-auto. The gate is the INVERSE of
 * the recorder: the recorder swallows errors, the gate FAILS CLOSED to BLOCK on
 * any error / missing session / un-gateable token identity.
 *
 * The quote result payload (`ToolResult.data`) is UNTRUSTED here: it is
 * re-validated with Zod at this boundary. We deliberately do NOT import the
 * handler-local `QuoteSafetyLeg` type from kyberswap/handlers/swap.ts (it is
 * not exported); we structurally re-validate instead.
 *
 * NEVER persist or log raw provider/HTTP/DB/error text — only bounded
 * structural labels (recorder) or bounded reason classes (gate).
 */

import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { isAddress } from "viem";

import type { ChainFamily } from "@tools/khalani/types.js";
import { SOL_MINT } from "@tools/solana-ecosystem/shared/solana-constants.js";
import { isNativeTokenInput } from "@tools/kyberswap/helpers.js";
import { NATIVE_TOKEN_ADDRESS } from "@tools/kyberswap/constants.js";
import { resolveChainSlug, slugToChainId } from "@tools/kyberswap/chains.js";
import { requireJupiterResolvedToken } from "@tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import { resolveSelectedAddress } from "@vex-agent/tools/internal/wallet/resolve.js";
import { VexError } from "../../../errors.js";
import logger from "@utils/logger.js";

import type { ProtocolExecutionContext } from "./types.js";
import * as prequoteRepo from "@vex-agent/db/repos/swap-prequotes.js";
import type {
  CreatePrequoteInput,
  PrequoteFamily,
  PrequoteKind,
  SafetyVerdict,
} from "@vex-agent/db/repos/swap-prequotes.js";

// ── Quote-tool registry ──────────────────────────────────────────────────

/**
 * Quote tools that record a prequote on success. Stage 6c records only
 * `kind: "swap"`; the schema allows `bridge` for Stage 8 forward-compat but
 * this map intentionally has no bridge entries yet.
 */
export const PREQUOTE_QUOTE_TOOLS: Record<
  string,
  { family: PrequoteFamily; provider: string; kind: "swap" }
> = {
  "kyberswap.swap.quote": { family: "eip155", provider: "kyberswap", kind: "swap" },
  "solana.swap.quote": { family: "solana", provider: "jupiter", kind: "swap" },
};

/**
 * Prequote freshness window. Honeypot / audit status is stable minute-to-minute,
 * but a restricted-mode approval pause can sit for minutes before the execute
 * call lands, so the window must comfortably outlive a human approval without
 * letting a stale safety preview authorize an execute indefinitely. Tunable.
 */
export const PREQUOTE_MAX_AGE_MS = 15 * 60_000;

// ── Match-hash ────────────────────────────────────────────────────────────

export interface PrequoteMatchInput {
  readonly sessionId: string;
  readonly family: PrequoteFamily;
  /** EVM numeric chainId; null/undefined for Solana (single chain in scope). */
  readonly chainId: number | null | undefined;
  readonly walletAddress: string;
  readonly tokenIn: string;
  readonly tokenOut: string;
  /** Human decimal amount the quote was computed for. */
  readonly amount: string;
}

/**
 * Canonicalize an address/mint for the match-hash. EVM addresses are
 * case-insensitive → lowercase; Solana base58 mints/addresses are
 * case-SENSITIVE → preserved as-is (after trim).
 */
function canonAddress(family: PrequoteFamily, value: string): string {
  const trimmed = value.trim();
  return family === "eip155" ? trimmed.toLowerCase() : trimmed;
}

/**
 * Canonicalize a human decimal amount so `"1.0"`, `"1"`, `"1.00"`, `"01"` and
 * `" 1 "` all hash identically. Strips sign-less leading/trailing zeros around
 * a single decimal point. Non-numeric input falls back to the trimmed string so
 * the hash is still deterministic (the recorder only ever passes amounts the
 * quote already accepted).
 */
function canonAmount(raw: string): string {
  const trimmed = raw.trim();
  // Plain decimal (optional sign, digits, optional fraction). Anything exotic
  // (scientific notation, units) falls through to the trimmed literal.
  if (!/^[+-]?\d*\.?\d+$/.test(trimmed) && !/^[+-]?\d+\.?\d*$/.test(trimmed)) {
    return trimmed;
  }
  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.replace(/^[+-]/, "");
  const [intPartRaw = "", fracPartRaw = ""] = unsigned.split(".");
  const intPart = intPartRaw.replace(/^0+/, "") || "0";
  const fracPart = fracPartRaw.replace(/0+$/, "");
  const body = fracPart.length > 0 ? `${intPart}.${fracPart}` : intPart;
  // Zero is always positive-canonical so "-0" and "0" collide.
  return negative && body !== "0" ? `-${body}` : body;
}

/**
 * Deterministic sha256-hex match-hash over the trade identity. Identical at
 * record-time and Stage-7 gate-time. Slippage and provider are deliberately
 * EXCLUDED (slippage tweaks must not invalidate the safety preview; provider
 * derives from family). Exported so Stage 7 reuses the EXACT function.
 */
export function computePrequoteMatchHash(input: PrequoteMatchInput): string {
  const chainIdOrEmpty =
    input.family === "eip155" && input.chainId != null ? String(input.chainId) : "";
  const material = [
    input.sessionId,
    input.family,
    chainIdOrEmpty,
    canonAddress(input.family, input.walletAddress),
    canonAddress(input.family, input.tokenIn),
    canonAddress(input.family, input.tokenOut),
    canonAmount(input.amount),
  ].join(" ");
  return createHash("sha256").update(material).digest("hex");
}

// ── Verdict computation ───────────────────────────────────────────────────

type LegVerdict = "pass" | "fail" | "unknown";

/** Worst-leg aggregation: any fail → fail; else any unknown → unknown; else pass. */
function aggregateVerdict(legs: readonly LegVerdict[]): SafetyVerdict {
  if (legs.includes("fail")) return "fail";
  if (legs.includes("unknown")) return "unknown";
  return "pass";
}

// EVM safety legs — structural re-validation of the kyberswap quote safety
// block (we do NOT import the handler-local QuoteSafetyLeg type).
const EvmNativeLegSchema = z.object({ native: z.literal(true) });
const EvmAuditLegSchema = z.object({
  isHoneypot: z.boolean(),
  isFOT: z.boolean(),
  tax: z.number(),
});
const EvmCheckFailedLegSchema = z.object({
  checkFailed: z.literal(true),
  reason: z.string(),
});
const EvmLegSchema = z.union([
  EvmNativeLegSchema,
  EvmAuditLegSchema,
  EvmCheckFailedLegSchema,
]);
const EvmSafetySchema = z.object({
  tokenIn: EvmLegSchema,
  tokenOut: EvmLegSchema,
});
type EvmLeg = z.infer<typeof EvmLegSchema>;

/** Bounded reason class — only the four literals the handler emits survive. */
const EVM_CHECK_FAILED_REASONS = new Set([
  "timeout",
  "rate_limited",
  "kyber_error",
  "unavailable",
]);

interface LegVerdictDetail {
  readonly verdict: LegVerdict;
  readonly detail: Record<string, unknown>;
}

/**
 * Per-leg EVM verdict + bounded detail. Mirrors the hard-abort in
 * `executeKyberSwap`: honeypot OR (FoT && tax > 50) → fail. FoT with tax <= 50
 * is info-only (NOT a fail — the model decides on fee-bearing tokens). A
 * checkFailed or malformed leg is fail-closed → unknown. Native does not worsen
 * the verdict (treated as pass at the leg level; aggregation ignores it anyway).
 */
function evmLegVerdict(leg: EvmLeg): LegVerdictDetail {
  if ("native" in leg) {
    return { verdict: "pass", detail: { native: true } };
  }
  if ("checkFailed" in leg) {
    // Defense-in-depth: only surface a bounded reason class, never raw text.
    const reason = EVM_CHECK_FAILED_REASONS.has(leg.reason) ? leg.reason : "unavailable";
    return { verdict: "unknown", detail: { checkFailed: true, reason } };
  }
  const isHardFail = leg.isHoneypot || (leg.isFOT && leg.tax > 50);
  return {
    verdict: isHardFail ? "fail" : "pass",
    detail: { isHoneypot: leg.isHoneypot, isFOT: leg.isFOT, tax: leg.tax },
  };
}

// Solana token metadata + safety block — structural re-validation of the
// Jupiter quote summary fields we need.
const SolanaTokenMetadataSchema = z.object({
  address: z.string(),
  symbol: z.string().optional(),
  decimals: z.number().optional(),
});
const SolanaTokenSafetySchema = z.object({
  isSus: z.boolean().nullish(),
  mintAuthorityDisabled: z.boolean().nullish(),
  freezeAuthorityDisabled: z.boolean().nullish(),
  topHoldersPercentage: z.number().nullish(),
});
const SolanaQuoteSchema = z.object({
  inputToken: SolanaTokenMetadataSchema,
  outputToken: SolanaTokenMetadataSchema,
  safety: z
    .object({
      inputToken: SolanaTokenSafetySchema.optional(),
      outputToken: SolanaTokenSafetySchema.optional(),
    })
    .optional(),
  slippageBps: z.number().nullish(),
});
type SolanaTokenSafety = z.infer<typeof SolanaTokenSafetySchema>;

function isNativeSolanaMint(mint: string): boolean {
  // Jupiter audits wSOL and returns isSus:false; treat the native sentinel as
  // a no-audit-needed leg regardless of whether a safety entry is present.
  return mint === SOL_MINT;
}

/**
 * Per-leg Solana verdict + bounded detail. A present entry with `isSus === true`
 * → fail; `isSus === false` → pass. A native (SOL/wSOL) leg never worsens the
 * verdict. An ABSENT entry for a non-native mint is fail-closed → unknown (no
 * audit data). `isSus` null/undefined on a present non-native entry is also
 * treated as "no verdict signal" → unknown (fail-closed).
 */
function solanaLegVerdict(
  mint: string,
  safety: SolanaTokenSafety | undefined,
): LegVerdictDetail {
  if (isNativeSolanaMint(mint)) {
    return { verdict: "pass", detail: { native: true } };
  }
  if (!safety || safety.isSus == null) {
    return { verdict: "unknown", detail: { auditPresent: false } };
  }
  const detail: Record<string, unknown> = { isSus: safety.isSus };
  if (safety.mintAuthorityDisabled != null) detail.mintAuthorityDisabled = safety.mintAuthorityDisabled;
  if (safety.freezeAuthorityDisabled != null) detail.freezeAuthorityDisabled = safety.freezeAuthorityDisabled;
  if (safety.topHoldersPercentage != null) detail.topHoldersPercentage = safety.topHoldersPercentage;
  return { verdict: safety.isSus ? "fail" : "pass", detail };
}

// ── Extraction (untrusted result.data → trusted prequote fields) ───────────

interface ExtractedQuote {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly chainId: number | null;
  readonly amount: string;
  readonly slippageBps: number | null;
  readonly verdict: SafetyVerdict;
  readonly safetyDetail: Record<string, unknown>;
}

// EVM quote result (kyberswap.swap.quote) — token addresses + chainId + safety.
const EvmQuoteResultSchema = z.object({
  chainId: z.number(),
  tokenIn: z.object({ address: z.string() }),
  tokenOut: z.object({ address: z.string() }),
  safety: EvmSafetySchema,
});

function extractEvm(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  const parsed = EvmQuoteResultSchema.safeParse(data);
  if (!parsed.success) return null;
  const amountRaw = params.amountIn;
  if (typeof amountRaw !== "string" || amountRaw.trim() === "") return null;
  const slippage = typeof params.slippageBps === "number" ? params.slippageBps : null;

  const inLeg = evmLegVerdict(parsed.data.safety.tokenIn);
  const outLeg = evmLegVerdict(parsed.data.safety.tokenOut);
  return {
    tokenIn: parsed.data.tokenIn.address,
    tokenOut: parsed.data.tokenOut.address,
    chainId: parsed.data.chainId,
    amount: amountRaw,
    slippageBps: slippage,
    verdict: aggregateVerdict([inLeg.verdict, outLeg.verdict]),
    safetyDetail: { tokenIn: inLeg.detail, tokenOut: outLeg.detail },
  };
}

function extractSolana(
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  const parsed = SolanaQuoteSchema.safeParse(data);
  if (!parsed.success) return null;
  const amountRaw = params.amount;
  // Solana params.amount is a human number; accept number or numeric string.
  const amount =
    typeof amountRaw === "number" && Number.isFinite(amountRaw)
      ? String(amountRaw)
      : typeof amountRaw === "string" && amountRaw.trim() !== ""
        ? amountRaw
        : null;
  if (amount === null) return null;

  // Slippage: prefer the quote's echoed value, else the request param.
  const slippage =
    typeof parsed.data.slippageBps === "number"
      ? parsed.data.slippageBps
      : typeof params.slippageBps === "number"
        ? params.slippageBps
        : null;

  const inMint = parsed.data.inputToken.address;
  const outMint = parsed.data.outputToken.address;
  const inLeg = solanaLegVerdict(inMint, parsed.data.safety?.inputToken);
  const outLeg = solanaLegVerdict(outMint, parsed.data.safety?.outputToken);
  return {
    tokenIn: inMint,
    tokenOut: outMint,
    chainId: null,
    amount,
    slippageBps: slippage,
    verdict: aggregateVerdict([inLeg.verdict, outLeg.verdict]),
    safetyDetail: { inputToken: inLeg.detail, outputToken: outLeg.detail },
  };
}

/**
 * Validate + extract the prequote fields for a quote tool. Returns `null` when
 * the result payload does not structurally validate (recording is then
 * skipped). Exported for focused unit tests.
 */
export function extractQuote(
  toolId: string,
  params: Record<string, unknown>,
  data: Record<string, unknown>,
): ExtractedQuote | null {
  if (toolId === "kyberswap.swap.quote") return extractEvm(params, data);
  if (toolId === "solana.swap.quote") return extractSolana(params, data);
  return null;
}

// ── Recorder ──────────────────────────────────────────────────────────────

function familyToChainFamily(family: PrequoteFamily): ChainFamily {
  // PrequoteFamily and ChainFamily share the same inhabitants; keep them
  // separate types but bridge here at the single call site.
  return family;
}

/**
 * Record a prequote from a successful quote. Best-effort: resolves the would-be
 * signing address (skips on a wallet-scope throw — never fabricates an
 * address), validates + extracts the quote, computes the match-hash + verdict,
 * and writes the row. Never throws to the caller; structural logs only.
 */
export async function recordPrequoteFromQuote(
  toolId: string,
  params: Record<string, unknown>,
  resultData: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<void> {
  const registered = PREQUOTE_QUOTE_TOOLS[toolId];
  if (!registered) return;

  const sessionId = context.sessionId;
  if (!sessionId) {
    logger.warn("protocol.prequote.skipped", { toolId, reason: "no_session" });
    return;
  }

  // Resolve the SELECTED address (never decrypts a key). A wallet-scope throw
  // (no wallet selected for this family) is a valid skip — fail-closed, never
  // fabricate.
  let walletAddress: string;
  try {
    walletAddress = resolveSelectedAddress(
      context.walletResolution,
      context.walletPolicy,
      familyToChainFamily(registered.family),
    );
  } catch (err) {
    const reason = err instanceof VexError ? err.code : "wallet_unresolved";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return;
  }

  const extracted = extractQuote(toolId, params, resultData);
  if (!extracted) {
    logger.warn("protocol.prequote.skipped", { toolId, reason: "shape_invalid" });
    return;
  }

  const matchHash = computePrequoteMatchHash({
    sessionId,
    family: registered.family,
    chainId: extracted.chainId,
    walletAddress,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    amount: extracted.amount,
  });

  const now = Date.now();
  const input: CreatePrequoteInput = {
    prequoteId: `prequote-${randomUUID()}`,
    sessionId,
    matchHash,
    kind: registered.kind,
    family: registered.family,
    provider: registered.provider,
    chainId: extracted.chainId,
    walletAddress,
    tokenIn: extracted.tokenIn,
    tokenOut: extracted.tokenOut,
    amount: extracted.amount,
    slippageBps: extracted.slippageBps,
    safetyVerdict: extracted.verdict,
    safetyDetail: extracted.safetyDetail,
    routeRef: null,
    expiresAt: new Date(now + PREQUOTE_MAX_AGE_MS).toISOString(),
  };

  // Best-effort write: the DB call is the only remaining throw site, so it is
  // wrapped here to honour the "never throws to the caller" contract above
  // (the runtime caller also guards, but the module owns its own contract).
  // Only a bounded structural reason is logged — never raw provider/DB text.
  try {
    await prequoteRepo.create(input);
  } catch (err) {
    const reason =
      err instanceof VexError
        ? err.code
        : err instanceof Error
          ? err.constructor.name
          : "write_failed";
    logger.warn("protocol.prequote.skipped", { toolId, reason });
    return;
  }
  logger.info("protocol.prequote.recorded", {
    toolId,
    family: registered.family,
    verdict: extracted.verdict,
  });
}

// ── Stage 7 — execute-time prequote gate ────────────────────────────────────
//
// Quote-before-transaction: a swap EXECUTE may broadcast ONLY when a fresh
// matching `swap` prequote exists and that prequote is not a confirmed scam.
// The gate is the INVERSE of the recorder: the recorder swallows its errors
// (a missing prequote is safe), but the gate FAILS CLOSED — any error, a
// missing session, or an un-gateable token identity → BLOCK. The gate runs
// BEFORE the approval gate in `executeProtocolTool`; an allow carries the
// matched verdict to the restricted-mode approval preview (R5).
//
// NEVER leaks raw provider/DB/wallet text — only a bounded structural reason
// class reaches the log and the agent-facing message.

/**
 * Swap EXECUTE tools subject to the Stage-7 gate, mapped to their family. Only
 * these three tool ids are gated; bridge/send and all non-swap tools pass
 * through untouched.
 */
export const EXECUTE_GATE_TOOLS: Record<string, { family: PrequoteFamily }> = {
  "kyberswap.swap.sell": { family: "eip155" },
  "kyberswap.swap.buy": { family: "eip155" },
  "solana.swap.execute": { family: "solana" },
};

/** All gated swaps share one kind; bridge prequotes never authorize a swap. */
const SWAP_GATE_KIND: PrequoteKind = "swap";

/**
 * Single gate decision. `allow` carries the matched prequote's verdict +
 * id (the verdict rides to the approval preview). `block` carries a BOUNDED
 * structural `reason` (for the log) and an agent-facing `message`. No row
 * contents, addresses, or raw error text appear in either field.
 */
export type GateDecision =
  | { readonly kind: "allow"; readonly verdict: SafetyVerdict; readonly prequoteId: string }
  | { readonly kind: "block"; readonly reason: GateBlockReason; readonly message: string };

/** Bounded reason class for a gate block — never raw provider/DB/wallet text. */
type GateBlockReason =
  | "gate_error"        // any thrown failure (DB / chain parse / resolve) — fail-closed
  | "no_session"        // missing sessionId on the execution context
  | "unresolved_token"  // EVM bare-symbol leg at execute (un-gateable identity)
  | "no_quote"          // no fresh matching swap prequote for these exact params
  | "safety_fail";      // a fresh prequote flagged the trade as a confirmed scam

const BLOCK_MESSAGES: Record<GateBlockReason, string> = {
  gate_error:
    "Swap blocked: could not verify a fresh quote. Re-run the swap quote and retry.",
  no_session:
    "Swap blocked: could not verify a fresh quote (no session). Re-run the swap quote and retry.",
  unresolved_token:
    "Swap blocked: unresolved execute token — pass the exact token address the quote returned, then retry.",
  no_quote:
    "Swap blocked: no fresh quote for these exact params. Call the swap quote first, then retry.",
  safety_fail:
    "Swap blocked: the quoted token was flagged unsafe (honeypot/scam). Aborting.",
};

function block(reason: GateBlockReason): GateDecision {
  return { kind: "block", reason, message: BLOCK_MESSAGES[reason] };
}

/** A thrown identity-build error that already names its block reason. */
class GateIdentityError extends Error {
  constructor(readonly gateReason: GateBlockReason) {
    super(gateReason);
    this.name = "GateIdentityError";
  }
}

/** EVM trade identity for the match-hash. `chainId` is the numeric chain id. */
interface GateIdentity {
  readonly family: PrequoteFamily;
  readonly chainId: number | null;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string;
}

/**
 * Canonicalize one EVM execute-leg token to the identity the quote recorded:
 *   - native input ("ETH"/"native"/sentinel) → `NATIVE_TOKEN_ADDRESS` (the hash
 *     lowercases it; the quote recorded the same sentinel),
 *   - a hex address → used verbatim (the hash lowercases it),
 *   - a bare symbol → un-gateable at execute → BLOCK (Kyber execute is strict
 *     address-only anyway; the gate never network-resolves an EVM symbol).
 */
function evmLegIdentity(param: string): string {
  if (isNativeTokenInput(param)) return NATIVE_TOKEN_ADDRESS;
  if (isAddress(param)) return param;
  throw new GateIdentityError("unresolved_token");
}

/** Build the EVM trade identity from validated execute params. Throws on a bare symbol. */
function buildEvmIdentity(params: Record<string, unknown>): GateIdentity {
  const chainParam = typeof params.chain === "string" ? params.chain : "";
  const tokenInParam = typeof params.tokenIn === "string" ? params.tokenIn : "";
  const tokenOutParam = typeof params.tokenOut === "string" ? params.tokenOut : "";
  const amount = typeof params.amountIn === "string" ? params.amountIn : "";
  // resolveChainSlug + slugToChainId are local (no network); an unsupported
  // chain throws a VexError → caught upstream → gate_error block (fail-closed).
  const chainId = slugToChainId(resolveChainSlug(chainParam));
  return {
    family: "eip155",
    chainId,
    tokenIn: evmLegIdentity(tokenInParam),
    tokenOut: evmLegIdentity(tokenOutParam),
    amount,
  };
}

/**
 * Build the Solana trade identity. `inputToken`/`outputToken` are symbol-OR-mint
 * at execute; resolve BOTH to their mint with the SAME resolver
 * `executeJupiterSwap` uses (`requireJupiterResolvedToken`, which returns
 * `.address` = mint) so the gate mint matches the recorded mint. A resolve
 * failure throws → caught upstream → gate_error block.
 */
async function buildSolanaIdentity(params: Record<string, unknown>): Promise<GateIdentity> {
  const inputParam = typeof params.inputToken === "string" ? params.inputToken : "";
  const outputParam = typeof params.outputToken === "string" ? params.outputToken : "";
  const [inToken, outToken] = await Promise.all([
    requireJupiterResolvedToken(inputParam),
    requireJupiterResolvedToken(outputParam),
  ]);
  return {
    family: "solana",
    chainId: null,
    tokenIn: inToken.address,
    tokenOut: outToken.address,
    amount: String(params.amount),
  };
}

/**
 * Evaluate the execute-time prequote gate for a swap EXECUTE. Single decision;
 * fail-closed to BLOCK on ANY failure. Guardrail #1: a fresh `fail` row can
 * never slip through — `existsFreshFailByMatch` is checked FIRST (a later
 * `pass`/`unknown` for the same identity cannot override it), and the latest-row
 * `fail` is re-checked as belt-and-suspenders.
 */
export async function evaluateSwapPrequoteGate(
  toolId: string,
  params: Record<string, unknown>,
  context: ProtocolExecutionContext,
): Promise<GateDecision> {
  const gated = EXECUTE_GATE_TOOLS[toolId];
  if (!gated) {
    // Defensive: callers only invoke for gated tools. Treat an unexpected tool
    // as a block rather than silently allowing an ungated execute.
    return block("gate_error");
  }

  try {
    const sessionId = context.sessionId;
    if (!sessionId) return block("no_session");

    // Resolve the SELECTED address (never decrypts). A wallet-scope throw is
    // caught below → gate_error block (fail-closed, never fabricate).
    const walletAddress = resolveSelectedAddress(
      context.walletResolution,
      context.walletPolicy,
      gated.family as ChainFamily,
    );

    const identity =
      gated.family === "eip155"
        ? buildEvmIdentity(params)
        : await buildSolanaIdentity(params);

    const matchHash = computePrequoteMatchHash({
      sessionId,
      family: gated.family,
      chainId: identity.chainId,
      walletAddress,
      tokenIn: identity.tokenIn,
      tokenOut: identity.tokenOut,
      amount: identity.amount,
    });

    // Guardrail #1 — a fresh confirmed-scam row dominates everything else.
    if (await prequoteRepo.existsFreshFailByMatch(sessionId, matchHash, SWAP_GATE_KIND)) {
      return block("safety_fail");
    }

    const latest = await prequoteRepo.findLatestFreshByMatch(sessionId, matchHash, SWAP_GATE_KIND);
    if (!latest) return block("no_quote");

    // Belt-and-suspenders: even though existsFreshFail already ruled out a fresh
    // fail, never allow a `fail` latest row (guardrail #1).
    if (latest.safetyVerdict === "fail") return block("safety_fail");

    if (latest.safetyVerdict === "unknown") {
      // Surface that an un-audited leg is being allowed (preview/full-auto see
      // it downstream). Prefix only — never the full hash or any address.
      logger.warn("protocol.prequote.gate.unknown_allowed", {
        toolId,
        family: gated.family,
        matchHashPrefix: matchHash.slice(0, 8),
      });
    }
    return { kind: "allow", verdict: latest.safetyVerdict, prequoteId: latest.prequoteId };
  } catch (err) {
    const reason =
      err instanceof GateIdentityError
        ? err.gateReason
        : ("gate_error" as const);
    // Bounded structural log only — never raw provider/DB/wallet text.
    logger.warn("protocol.prequote.gate.error", {
      toolId,
      reason,
      errorClass:
        err instanceof VexError
          ? err.code
          : err instanceof Error
            ? err.constructor.name
            : "unknown",
    });
    return block(reason);
  }
}
