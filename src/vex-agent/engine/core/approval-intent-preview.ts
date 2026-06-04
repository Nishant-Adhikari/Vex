/**
 * Approval intent preview + policy snapshot builders.
 *
 * Plan: agents_dm/plan-integration/05-approvals-wallet-policy.md §"Approval DB model".
 *
 * Puzzle 5 phase 2. Approval UI must show enough context for the user to
 * decide (which wallet? which chain? how much? to whom?) WITHOUT exposing
 * raw tool args (Codex 2/1B ruling: "Approval UI pobiera summary z tego
 * DTO, nie surowe tool args").
 *
 * `buildIntentPreview` extracts an allow-listed structured summary from the
 * tool call (`toolName`, optional `namespace`, and a flat `criticalArgs`
 * map of well-known keys like `to`, `amount`, `chain`). Defensive style
 * mirrors `approvals-db.ts:extractToolName` — never recurses, never returns
 * raw blobs, coerces unsafe types (bigint, nested objects, arrays) to
 * conservative substitutes.
 *
 * `buildPolicySnapshot` captures the enqueue-time policy context (permission,
 * sessionKind, missionRunActive, contextUsageBand, plus mission lineage and
 * source surface where available) so phase 3 approve dispatch can validate
 * the snapshot still matches the live context — a permission downgrade
 * between enqueue and approve must be observable.
 */

import type { InternalToolContext } from "../../tools/internal/types.js";
import type { SafetyVerdict } from "../../db/repos/swap-prequotes.js";

/**
 * Allow-list of `tool_call.arguments` keys eligible for the preview
 * `criticalArgs` map. Each key is one the user typically needs to verify
 * before approving an action (wallet/chain/amount/recipient). Adding a
 * new key requires intentional review — preview is a security boundary.
 */
const PREVIEW_KEY_ALLOWLIST: ReadonlySet<string> = new Set([
  "to",
  "recipient",
  "recipientAddress",
  "amount",
  "amountIn",
  "amountUsdc",
  "chain",
  "chainId",
  "network",
  "token",
  "tokenIn",
  "tokenOut",
  "intentId",
  "marketId",
  "conditionId",
  "outcome",
  "side",
  "orderId",
  "fromChain",
  "toChain",
  "fromToken",
  "toToken",
  "query",
]);

/** Max string length stored in `criticalArgs`. Longer values are truncated. */
const MAX_PREVIEW_STRING_LEN = 200;

/**
 * Coerce a value into a JSON-safe scalar for the preview. Returns:
 *   - string truncated to MAX_PREVIEW_STRING_LEN with `…` suffix
 *   - number/boolean/null as-is
 *   - bigint → decimal string (JSON.stringify(bigint) throws)
 *   - any object/array/function/symbol → null (preview never embeds nested)
 */
function coerceSummaryValue(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return value.length > MAX_PREVIEW_STRING_LEN
      ? `${value.slice(0, MAX_PREVIEW_STRING_LEN)}…`
      : value;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  return null;
}

export interface IntentPreview {
  /** Tool the user is being asked to approve. Always present. */
  toolName: string;
  /** Optional protocol namespace (e.g. "kyberswap", "polymarket"). */
  namespace?: string;
  /**
   * Flat map of allow-listed argument keys → coerced scalars. Stage 7 also
   * injects a non-arg `safety` key here (sourced from the typed prequote
   * verdict, NOT from raw args) so the renderer's strict
   * `approvalPreviewSchema` — which permits arbitrary scalar `criticalArgs`
   * keys — surfaces the swap safety verdict with zero cross-process schema
   * change. See {@link IntentPreviewExtras}.
   */
  criticalArgs: Record<string, string | number | boolean | null>;
}

/**
 * Typed, non-arg preview enrichment. Stage 7 R5: the swap prequote gate's
 * matched safety verdict reaches the approval preview through THIS channel —
 * never through `args`. `safety` is deliberately NOT in
 * {@link PREVIEW_KEY_ALLOWLIST}, so the LLM cannot spoof it via tool args; the
 * value is injected after allow-list extraction from `prequoteVerdict` only.
 */
export interface IntentPreviewExtras {
  /** Matched prequote safety verdict for a gated swap execute (`pass`/`unknown`). */
  prequoteVerdict?: SafetyVerdict;
}

/** Render a swap safety verdict for the approval preview's `criticalArgs.safety`. */
function renderSafetyVerdict(verdict: SafetyVerdict): string {
  switch (verdict) {
    case "pass":
      return "pass";
    case "unknown":
      return "UNVERIFIED — audit unavailable";
    case "fail":
      // A `fail` is blocked at the gate and never reaches the approval preview;
      // render defensively if it ever does (must never read as safe).
      return "FAILED — flagged unsafe";
  }
}

/**
 * Resolve the EFFECTIVE preview subject for `execute_tool` — the LLM call
 * is a wrapper (`execute_tool({toolId, params})`), so the user-visible
 * approval must surface the TARGET protocol tool (`toolId`) and the nested
 * `params` as critical args. Internal tools and unknown shapes pass
 * through unchanged.
 *
 * Codex final review puzzle 5/2 (2026-05-23): "Protocol approval preview
 * currently summarizes the wrapper, not the target tool. This is the most
 * important UI/policy summary for user_wallet_broadcast, so it cannot ship."
 */
function resolveEffectiveCall(
  toolName: string,
  args: Record<string, unknown>,
): { toolName: string; args: Record<string, unknown> } {
  if (toolName !== "execute_tool") return { toolName, args };

  const toolId = typeof args.toolId === "string" ? args.toolId : null;
  const params = isPlainObject(args.params) ? (args.params as Record<string, unknown>) : null;
  if (toolId === null) return { toolName, args };

  return { toolName: toolId, args: params ?? {} };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Build the renderer-safe preview from a parsed tool call. Allow-listed
 * keys only; coerced to JSON-safe scalars.
 *
 * `toolName` carries the user-visible identifier. For protocol tools the
 * caller passes the resolved `namespace.command` shape (e.g.
 * `kyberswap.swap.sell`) so the renderer can render namespace + command
 * separately if needed. For `execute_tool` calls the wrapper is unwrapped
 * via `resolveEffectiveCall` so the preview reflects the TARGET, not the
 * meta-tool — see Codex final review puzzle 5/2.
 */
export function buildIntentPreview(
  toolName: string,
  args: Record<string, unknown>,
  extras?: IntentPreviewExtras,
): IntentPreview {
  const effective = resolveEffectiveCall(toolName, args);

  const criticalArgs: Record<string, string | number | boolean | null> = {};
  for (const key of Object.keys(effective.args)) {
    if (!PREVIEW_KEY_ALLOWLIST.has(key)) continue;
    criticalArgs[key] = coerceSummaryValue(effective.args[key]);
  }

  // Stage 7 R5: inject the swap safety verdict AFTER allow-list extraction,
  // sourced ONLY from the typed `extras.prequoteVerdict` — never from raw args
  // (`safety` is not in PREVIEW_KEY_ALLOWLIST, so the LLM cannot spoof it).
  if (extras?.prequoteVerdict !== undefined) {
    criticalArgs.safety = renderSafetyVerdict(extras.prequoteVerdict);
  }

  // Derive namespace from dotted tool name (e.g. "kyberswap.swap.sell" → "kyberswap").
  // Internal tools without a dot get no namespace.
  const dotIdx = effective.toolName.indexOf(".");
  const namespace = dotIdx > 0 ? effective.toolName.slice(0, dotIdx) : undefined;

  const preview: IntentPreview = { toolName: effective.toolName, criticalArgs };
  if (namespace !== undefined) {
    preview.namespace = namespace;
  }
  return preview;
}

export interface PolicySnapshot {
  permission: InternalToolContext["sessionPermission"];
  sessionKind: InternalToolContext["sessionKind"];
  missionRunActive: boolean;
  contextUsageBand: InternalToolContext["contextUsageBand"];
  missionId: string | null;
  missionRunId: string | null;
  role: InternalToolContext["role"];
}

/**
 * Build the policy-context snapshot. Phase 3 approve compares this against
 * the live context — a permission downgrade or band change between enqueue
 * and approve is observable from the diff.
 */
export function buildPolicySnapshot(context: InternalToolContext): PolicySnapshot {
  return {
    permission: context.sessionPermission,
    sessionKind: context.sessionKind,
    missionRunActive: context.missionRunId !== null,
    contextUsageBand: context.contextUsageBand,
    missionId: context.missionId,
    missionRunId: context.missionRunId,
    role: context.role,
  };
}
