/**
 * Protocol runtime — discover_tools + execute_tool handlers.
 *
 * These are the two internal tools that the LLM uses to interact
 * with protocol capabilities. Discovery returns metadata.
 * Execution validates params, finds the handler, and calls it.
 */

import { z } from "zod";

import type {
  ProtocolExecuteRequest,
  ProtocolExecutionContext,
  ProtocolParamDef,
  ProtocolToolManifest,
} from "./types.js";
import type { ToolResult } from "../types.js";
import type { ActionKind } from "../taxonomy.js";
import { getProtocolHandler, getProtocolManifest } from "./catalog.js";
import { redact } from "@vex-agent/memory/redaction.js";
import { isPreviewExecution, validateCaptureContract } from "./capture-validator.js";
import { extractExternalRefs, populateCaptureItems } from "./capture-pipeline.js";
import { MUTATION_MATRIX } from "./mutation-matrix.js";
import {
  PREQUOTE_QUOTE_TOOLS,
  recordPrequoteFromQuote,
  EXECUTE_GATE_TOOLS,
  evaluatePrequoteGate,
} from "./swap-prequote.js";
import type { SafetyVerdict } from "@vex-agent/db/repos/swap-prequotes.js";
import { isExecutableNamespace, NAMESPACE_LIFECYCLE } from "./lifecycle.js";
import { sanitizeJsonbValue } from "@vex-agent/db/params.js";
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";
import logger from "@utils/logger.js";

export { discoverProtocolCapabilities } from "./discovery.js";

// ── Action taxonomy stamp (puzzle 5 phase 1B) ───────────────────
//
// Phase 1A shipped `ProtocolToolManifest.actionKind` as a derived heuristic
// over `mutating` + `discovery.sideEffectLevel`. Phase 1B (this commit)
// added `actionKind: ActionKind` REQUIRED on every manifest; the heuristic
// is gone, replaced by a direct manifest read.
//
// Preview override preserved (Codex 1A Q3 ruling): `isPreviewExecution(...)`
// returns `"read"` regardless of `manifest.actionKind` — preview / dryRun is
// read-only simulation, even on a mutating manifest. The approval gate below
// also skips preview, so the override stays consistent end-to-end.
//
// Tested in `src/__tests__/vex-agent/tools/execute-tool-taxonomy.test.ts`
// (propagation paths) and `protocol-taxonomy.test.ts` (per-manifest pins).

/**
 * Local helper — stamp `actionKind` on a `ToolResult`. ALWAYS overwrites any
 * handler-set value: for protocol tools the manifest-driven classifier is
 * authoritative, not handler payload. A handler trying to downgrade a
 * `user_wallet_broadcast` mutation to `read` cannot bypass the policy
 * classifier (Codex final review, puzzle 5/1A — 2026-05-23). Tested in
 * `execute-tool-taxonomy.test.ts` ("handler-set actionKind cannot override
 * the derived classifier").
 */
function withActionKind(result: ToolResult, actionKind: ActionKind): ToolResult {
  return { ...result, actionKind };
}

// ── Strict param-boundary validation (B-002) ─────────────────────
//
// The protocol param surface is an UNTRUSTED boundary: `execute_tool` params
// come straight from the LLM. Pre-B-002 the runtime only checked declared
// params for `required` presence + `typeof`; it let UNKNOWN/extra keys flow
// into handlers untouched and never rejected nested shape drift. This closes
// the boundary with manifest-derived Zod schemas (rule 20 §2): every declared
// key is type-validated by `primitiveSchema(...).safeParse`, and an explicit
// strict-key pass REJECTS any undeclared key (the `.strict()` equivalent)
// before the handler is invoked. We keep the strict-key + required checks
// separate from Zod's per-field parse so the exact pre-B-002 messages and the
// "empty-string/null = missing" semantics are preserved byte-for-byte.
//
// Manifest params are primitive-only today (`string | number | boolean`), so
// the generated schemas are flat. `primitiveSchema` is deliberately written
// with an exhaustiveness guard so a future manifest declaring a nested
// `object`/`array` param must map to a recursive Zod schema HERE rather than
// fall through — the boundary stays at runtime.ts and never silently passes
// nested/extra keys.

/** Runtime-owned control keys recognised regardless of manifest declaration. */
//
// `dryRun` is read by the runtime ITSELF (`isPreviewExecution`) before the
// handler runs, so it is part of the runtime contract, not a per-handler param.
// Every production tool that supports preview ALSO declares `dryRun` in its
// manifest; this set only guarantees the runtime's own control key is never
// rejected as "unknown" even for a manifest that omits the declaration.
const RESERVED_RUNTIME_PARAM_KEYS: ReadonlySet<string> = new Set(["dryRun"]);

/** Map a primitive `ProtocolParamDef.type` to its base Zod schema. */
function primitiveSchema(type: ProtocolParamDef["type"]): z.ZodTypeAny {
  switch (type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "boolean":
      return z.boolean();
    default:
      // Exhaustiveness guard — a new param `type` must extend this mapping
      // (e.g. nested object/array → recursive schema) rather than fall through.
      return assertNeverParamType(type);
  }
}

function assertNeverParamType(value: never): never {
  throw new Error(`Unhandled protocol param type: ${String(value)}`);
}

/**
 * Outcome of strict param validation. `ok` carries no payload — the runtime
 * keeps operating on the already-validated `params` object; this is a boundary
 * gate, not a transform.
 */
type ParamValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/**
 * Validate `params` against `manifest.params` at the trust boundary.
 *
 * Order (each fails closed BEFORE the handler runs):
 *  1. UNKNOWN keys — any key neither declared nor runtime-reserved is rejected.
 *  2. REQUIRED presence — `undefined | null | ""` for a required param is
 *     "missing" (preserves the pre-B-002 empty-string-as-absent semantics so
 *     an empty optional is allowed and an empty required is rejected).
 *  3. TYPE — a PRESENT param whose value fails its declared primitive schema is
 *     rejected. Missing optionals are not type-checked.
 *
 * Messages are agent-actionable and contain only the offending KEY + declared
 * type — never a value (which could carry untrusted/secret-adjacent content).
 */
function validateProtocolParams(
  manifest: ProtocolToolManifest,
  params: Record<string, unknown>,
): ParamValidation {
  const declared = new Map(manifest.params.map((p) => [p.key, p] as const));

  // 1. Strict unknown-key rejection.
  for (const key of Object.keys(params)) {
    if (!declared.has(key) && !RESERVED_RUNTIME_PARAM_KEYS.has(key)) {
      return {
        ok: false,
        reason:
          `Unknown parameter "${key}" for ${manifest.toolId}. `
          + `Allowed parameters: ${manifest.params.map((p) => p.key).join(", ") || "(none)"}.`,
      };
    }
  }

  // 2 + 3. Per-declared-param required presence + strict type.
  for (const param of manifest.params) {
    const value = params[param.key];
    const missing = value === undefined || value === null || value === "";
    if (param.required && missing) {
      return {
        ok: false,
        reason: `Missing required parameter "${param.key}" for ${manifest.toolId}`,
      };
    }
    if (missing) continue; // optional + absent — not type-checked

    const parsed = primitiveSchema(param.type).safeParse(value);
    if (!parsed.success) {
      return {
        ok: false,
        reason:
          `Parameter "${param.key}" for ${manifest.toolId} has invalid type: `
          + `expected ${param.type}, got ${typeof value}`,
      };
    }
  }

  return { ok: true };
}

// ── Provider-safe error summarisation (B-003) ────────────────────
//
// A thrown handler error (or any provider/SDK error) can embed URLs, request /
// response bodies, auth headers, and key material. NONE of that may reach the
// tool output, the structured logs, or (downstream) the renderer. We emit ONLY:
//   - a coarse cause CATEGORY (transient vs permanent classification signal),
//   - a bounded message that has been run through the secret redactor AND
//     stripped of URLs, then length-capped.
// The original error is never logged or returned verbatim.

type ErrorCategory =
  | "timeout"
  | "network"
  | "rate_limit"
  | "auth"
  | "provider_error"
  | "unknown";

interface SafeErrorSummary {
  readonly category: ErrorCategory;
  readonly message: string;
}

const MAX_SAFE_ERROR_MESSAGE = 200;

// Structured/sensitive fragments stripped from the message BEFORE it is
// surfaced anywhere. These cover the provider/SDK internals the B-003 note
// forbids emitting (URLs, request/response bodies, auth) while leaving short
// human-readable error phrases (e.g. "network down") intact. Each replaces the
// offending span with a coarse placeholder rather than deleting it, so the
// summary still signals "an internal was removed here".
const SENSITIVE_FRAGMENT_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // URLs — provider endpoints often carry tokens/ids in path or query.
  [/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "[url]"],
  // Brace- or bracket-delimited bodies (JSON request/response payloads).
  [/[{[][^{}[\]]*[}\]]/g, "[body]"],
  // Auth headers + key/secret/token assignments (header: value OR key=value).
  [/\b(authorization|proxy-authorization|cookie|set-cookie)\s*[:=]\s*\S+/gi, "[auth]"],
  [/\bbearer\s+\S+/gi, "[auth]"],
  [/\b(api[_-]?key|apikey|access[_-]?token|secret|password|passwd|pwd|token|key)\s*[:=]\s*\S+/gi, "[auth]"],
];

/** Coarse, non-sensitive classification from the error's shape/text. */
function classifyError(raw: string, err: unknown): ErrorCategory {
  const name = err instanceof Error ? err.name.toLowerCase() : "";
  const text = raw.toLowerCase();
  if (name.includes("abort") || text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (text.includes("rate limit") || text.includes("429") || text.includes("too many requests")) {
    return "rate_limit";
  }
  if (text.includes("unauthorized") || text.includes("forbidden") || text.includes("401") || text.includes("403")) {
    return "auth";
  }
  if (
    name.includes("fetch")
    || text.includes("econn")
    || text.includes("enotfound")
    || text.includes("network")
    || text.includes("socket")
  ) {
    return "network";
  }
  if (err instanceof Error) return "provider_error";
  return "unknown";
}

/**
 * Reduce any thrown value to a `{ category, message }` summary that is safe to
 * log, return to the agent, and forward to the renderer. Bounded + redacted.
 */
function summarizeProtocolError(err: unknown): SafeErrorSummary {
  const raw = err instanceof Error ? err.message : String(err);
  const category = classifyError(raw, err);

  // Defense-in-depth, applied in order:
  //  1. redact known SECRET shapes (keys, JWTs, mnemonics, addresses),
  //  2. strip structured provider INTERNALS (URLs, bodies, auth) the B-003 note
  //     forbids emitting — placeholder-replaced, not just secret-matched,
  //  3. collapse whitespace and hard-cap the length.
  // We never trust the provider not to embed internals, so we keep only this
  // bounded summary regardless of what the raw text contained.
  let cleaned = redact(raw).text;
  for (const [pattern, replacement] of SENSITIVE_FRAGMENT_PATTERNS) {
    cleaned = cleaned.replace(pattern, replacement);
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  const bounded = cleaned.length > MAX_SAFE_ERROR_MESSAGE
    ? `${cleaned.slice(0, MAX_SAFE_ERROR_MESSAGE)}…`
    : cleaned;

  return { category, message: bounded || category };
}

// ── Execution ────────────────────────────────────────────────────

export async function executeProtocolTool(
  request: ProtocolExecuteRequest,
  context: ProtocolExecutionContext,
): Promise<ToolResult> {
  const manifest = getProtocolManifest(request.toolId);
  if (!manifest) {
    // Unknown manifest — leave `actionKind` undefined per Codex review
    // (puzzle 5/1A): policy layer treats missing `actionKind` as the
    // conservative "unknown action" signal.
    return {
      success: false,
      output: `Unknown protocol tool: ${request.toolId}. Use discover_tools to find available tools.`,
    };
  }

  // Resolve target action kind ONCE — every subsequent return path stamps
  // it on the `ToolResult` so the dispatcher / policy / audit layers see
  // the target classification, NOT the `execute_tool` wrapper's `read`.
  // Preview / dryRun overrides to `read` regardless of `manifest.actionKind`
  // (Codex 1A Q3 ruling — preview is read-only simulation end-to-end).
  const params = request.params ?? {};
  const effectiveActionKind: ActionKind = isPreviewExecution(request.toolId, params)
    ? "read"
    : manifest.actionKind;

  // Normalize the wallet scope so the deny-guard + migrated handlers never see
  // undefined. Both fields are REQUIRED on the type (production is fail-closed
  // via tsc); this defends test/legacy callers that omit them — they default to
  // source:"default", which is never session-scoped and never denied.
  const scopedContext: ProtocolExecutionContext = {
    ...context,
    walletResolution: context.walletResolution ?? { source: "default" },
    walletPolicy: context.walletPolicy ?? { kind: "none" },
  };

  // Per-session wallet scope (puzzle 5): the 5B hard-deny for user-wallet signing
  // tools (actionKind user_wallet_broadcast / external_post) was LIFTED in
  // 5D-protocols p5. Every protocol signer now resolves the session's selected
  // wallet (resolveSigningWallet / resolveSelectedAddress) and fails closed on an
  // unselected family or address drift — there is no fallback to the primary
  // wallet. Authorization is the approval gate below plus handler-level wallet
  // resolution; no second global gate is needed. The signer-import + keystore
  // scans (src/vex-agent/tools + src/tools/**) prevent a signer from regressing
  // to the primary wallet under a session, and the actionKind census test forces
  // a review if a new signing actionKind ever appears.

  // Note: `manifest.lifecycle` is always "active" after PR1 narrowed the
  // ToolLifecycle union; no runtime lifecycle gate at the per-tool level.
  // Per-namespace lifecycle is enforced below via `isExecutableNamespace`.

  // Per-namespace lifecycle gate — `deprecated_hidden` namespaces refuse
  // execution unless `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`. `reserved` never
  // execute. See `lifecycle.ts` and `embeddings/_DEPRECATED.md`.
  if (!isExecutableNamespace(manifest.namespace)) {
    const status = NAMESPACE_LIFECYCLE[manifest.namespace];
    const hint = status === "deprecated_hidden"
      ? "Set VEX_ALLOW_DEPRECATED_PROTOCOLS=1 to allow execution."
      : "Reserved namespace has no executable handlers.";
    logger.info("protocol.execute.namespace_blocked", {
      toolId: request.toolId,
      namespace: manifest.namespace,
      lifecycle: status,
    });
    return withActionKind({
      success: false,
      output: `Namespace "${manifest.namespace}" is ${status} and not executable. ${hint}`,
    }, effectiveActionKind);
  }

  if (manifest.requiresEnv && !process.env[manifest.requiresEnv]?.trim()) {
    return withActionKind({
      success: false,
      output: `${request.toolId} requires ${manifest.requiresEnv} to be set in .env`,
    }, effectiveActionKind);
  }

  // Pressure-barrier guard for protocol tools — at band ≥ barrier, mutating
  // protocol calls are blocked unless they are preview/dryRun. The agent must
  // call `compact_now` first to clear the barrier. Same semantics as the
  // dispatcher's hard-deny for internal mutating tools.
  if (
    context.contextUsageBand
    && manifest.mutating
    && !isPreviewExecution(request.toolId, params)
  ) {
    const band = context.contextUsageBand;
    if (band === "barrier" || band === "critical") {
      logger.info("protocol.execute.pressure_denied", {
        toolId: request.toolId,
        band,
      });
      return withActionKind({
        success: false,
        output:
          `${request.toolId} is blocked at context pressure ${band}. `
          + `Call compact_now first to compact the conversation; the next turn after compaction restores the full tool set.`,
      }, effectiveActionKind);
    }
  }

  // Strict param-boundary validation (B-002) — UNKNOWN/extra keys, missing
  // required params, and wrong-typed declared params are ALL rejected here,
  // BEFORE the handler runs. Manifest-derived Zod schema; see
  // `validateProtocolParams`. Pre-B-002 this only checked required+typeof and
  // let undeclared keys flow into handlers untouched.
  const paramValidation = validateProtocolParams(manifest, params);
  if (!paramValidation.ok) {
    return withActionKind({
      success: false,
      output: paramValidation.reason,
    }, effectiveActionKind);
  }

  // Find handler
  const handler = getProtocolHandler(request.toolId);
  if (!handler) {
    return withActionKind({
      success: false,
      output: `No handler registered for ${request.toolId}. This is a bug — manifest exists but handler is missing.`,
    }, effectiveActionKind);
  }

  // ── Prequote gate — quote-before-transaction on the BROADCAST path. Runs
  // BEFORE the approval gate (a block must short-circuit even a call that would
  // otherwise be enqueued for approval). Gated tools are the three swap EXECUTEs
  // (kind 'swap', Stage 7) and the Khalani bridge EXECUTE (kind 'bridge', Stage
  // 8c); preview/dryRun is read-only simulation and is never gated (the bridge's
  // `dryRun` is `isPreviewExecution`-true, so a bridge preview is excluded here).
  // Fail-closed: any error → BLOCK. On ALLOW it yields the matched prequote's
  // safety verdict, carried to the approval preview (R5; bridge is 'unknown').
  let prequoteVerdict: SafetyVerdict | undefined;
  let prequoteFotTax: number | undefined;
  if (request.toolId in EXECUTE_GATE_TOOLS && !isPreviewExecution(request.toolId, params)) {
    const decision = await evaluatePrequoteGate(request.toolId, params, scopedContext);
    if (decision.kind === "block") {
      logger.info("protocol.execute.prequote_gate_blocked", {
        toolId: request.toolId,
        reason: decision.reason,
      });
      return withActionKind({ success: false, output: decision.message }, effectiveActionKind);
    }
    prequoteVerdict = decision.verdict;
    // Fee-on-transfer tax (if any) rides the same TYPED channel for the preview.
    prequoteFotTax = decision.fotTax;
  }

  // Approval gate — mutating tools require approval under restricted permission.
  // Preview (dryRun) is read-only simulation — skip approval.
  if (manifest.mutating && !context.approved && context.sessionPermission === "restricted" && !isPreviewExecution(request.toolId, params)) {
    logger.info("protocol.execute.approval_required", { toolId: request.toolId, permission: context.sessionPermission });
    // Carry the gate-matched prequote verdict to the restricted-mode approval
    // preview via the TYPED `prequote` field (NOT raw args) so the human sees
    // the safety verdict — especially `unknown` — before approving (R5). A
    // fee-on-transfer tax (when the gate provided one) rides the same typed
    // field so the human still sees a high tax even though FoT is now `pass`.
    const pending: ToolResult = {
      success: false,
      output: `${request.toolId} requires approval — mutating tool in restricted permission mode.`,
      pendingApproval: true,
    };
    if (prequoteVerdict !== undefined) {
      pending.prequote =
        prequoteFotTax !== undefined
          ? { verdict: prequoteVerdict, fotTax: prequoteFotTax }
          : { verdict: prequoteVerdict };
    }
    return withActionKind(pending, effectiveActionKind);
  }

  // Determine preview BEFORE handler call — flag survives thrown exceptions
  const isPreview = isPreviewExecution(request.toolId, params);
  const shouldCapture = manifest.mutating && !isPreview;

  // Execute + capture
  const startTime = Date.now();
  try {
    const result = await handler(params, scopedContext);
    const durationMs = Date.now() - startTime;

    logger.info("protocol.execute.completed", {
      toolId: request.toolId,
      success: result.success,
      durationMs,
    });

    // Record a swap prequote on a successful QUOTE (Stage 6c). Quote tools are
    // `mutating:false`, so the `shouldCapture` pipeline below never fires for
    // them — this is a SEPARATE best-effort block gated on the quote-tool set +
    // `result.success`. A recording failure MUST NOT change the quote's
    // ToolResult; a missing prequote is safe (the Stage-7 gate fails closed).
    // Awaited (deterministic for tests) but fully isolated by try/catch.
    if (result.success && request.toolId in PREQUOTE_QUOTE_TOOLS) {
      try {
        await recordPrequoteFromQuote(request.toolId, params, result.data ?? {}, scopedContext);
      } catch (err) {
        logger.warn("protocol.execute.prequote_record_failed", {
          toolId: request.toolId,
          reason: err instanceof Error ? err.constructor.name : typeof err,
        });
      }
    }

    // Capture mutating execution — awaited inline for deterministic projection readiness
    // protocol_executions: ALL mutations (success + failure) for audit
    // proj_activity + positions/lots: ONLY successful mutations (business truth)
    // Preview executions skip capture entirely (determined before handler call)
    if (shouldCapture) {
      try {
        await captureExecution(request.toolId, manifest.namespace, context.sessionId ?? null, params, result, durationMs);
      } catch (err) {
        // B-003: capture/DB errors can embed a credential-bearing connection
        // URL — log only the redacted, bounded summary.
        const safe = summarizeProtocolError(err);
        logger.warn("protocol.execute.capture_failed", {
          toolId: request.toolId,
          code: safe.category,
          message: safe.message,
        });
      }
    }

    return withActionKind(result, effectiveActionKind);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    // B-003: reduce the raw provider/SDK error to a redacted, bounded summary.
    // The original message may carry URLs, request/response bodies, auth, or
    // key material — none of which may reach the log, the tool output, or the
    // renderer. We surface ONLY the cause CATEGORY + a bounded redacted message.
    const safe = summarizeProtocolError(err);

    logger.warn("protocol.execute.failed", {
      toolId: request.toolId,
      code: safe.category,
      message: safe.message,
      durationMs,
    });

    // Capture thrown mutations to audit trail only (no projections for failures)
    // Preview: skip capture even for thrown exceptions
    const failedResult: ToolResult = withActionKind(
      { success: false, output: `${request.toolId} failed (${safe.category}): ${safe.message}` },
      effectiveActionKind,
    );
    if (shouldCapture) {
      try {
        await captureExecution(request.toolId, manifest.namespace, context.sessionId ?? null, params, failedResult, durationMs);
      } catch (captureErr) {
        // B-003: same redaction discipline on the failure-capture path.
        const safeCapture = summarizeProtocolError(captureErr);
        logger.warn("protocol.execute.capture_failed", {
          toolId: request.toolId,
          code: safeCapture.category,
          message: safeCapture.message,
        });
      }
    }

    return failedResult;
  }
}

// ── Execution capture ───────────────────────────────────────────

// extractExternalRefs moved to capture-pipeline.ts (shared with replay.ts)

async function captureExecution(
  toolId: string,
  namespace: string,
  sessionId: string | null,
  params: Record<string, unknown>,
  result: ToolResult,
  durationMs: number,
): Promise<void> {
  // Defense-in-depth: preview results are NOT mutations — skip entire capture pipeline
  if (result.data?.dryRun === true) return;

  const { recordExecution } = await import("@vex-agent/db/repos/executions.js");
  const paramsForStorage = sanitizeRecord(params);
  const resultData = sanitizeRecord(result.data ?? {});
  const tradeCapture = isRecord(resultData._tradeCapture) ? resultData._tradeCapture : null;
  const tradeCaptureItems = sanitizeRecordArray(resultData._tradeCaptureItems);
  const externalRefs = extractExternalRefs(resultData);

  const executionId = await recordExecution(
    toolId, namespace, sessionId, paramsForStorage,
    resultData, result.success,
    tradeCapture, externalRefs, durationMs,
  );

  // Enqueue sync runs for this namespace (only on success — failed mutations don't need projection refresh)
  if (result.success && executionId > 0) {
    try {
      const { getJobsForNamespace, enqueueRun } = await import("@vex-agent/db/repos/sync.js");
      const jobs = await getJobsForNamespace(namespace);
      for (const job of jobs) {
        await enqueueRun(job.id, executionId);
      }
    } catch (err) {
      logger.warn("protocol.execute.sync_enqueue_failed", {
        toolId, namespace, executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Populate proj_activity ONLY for successful executions (projections = business truth)
  // Failed mutations go to protocol_executions audit log but NOT to activity/positions/lots
  if (executionId > 0 && result.success) {
    // Validate capture contract before sending to projection pipeline
    // For fanOut:"items" tools, validate items (not summary) — summary intentionally lacks per-item identity
    const contract = MUTATION_MATRIX.get(toolId);
    const itemsToValidate = contract?.fanOut === "items" && Array.isArray(tradeCaptureItems) && tradeCaptureItems.length > 0
      ? tradeCaptureItems
      : tradeCapture ? [tradeCapture] : [];
    const allValid = itemsToValidate.every(item => validateCaptureContract(toolId, item));
    if (!allValid) {
      logger.warn("protocol.execute.capture_validation_failed", {
        toolId, namespace, executionId,
        hint: "Capture blocked by validator — not sent to projection pipeline",
      });
      return;
    }
    try {
      await populateCaptureItems(executionId, toolId, namespace, tradeCapture, tradeCaptureItems, externalRefs);
    } catch (err) {
      logger.warn("protocol.execute.activity_populate_failed", {
        toolId, namespace, executionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

// populateCaptureItems moved to capture-pipeline.ts (shared with replay.ts)

function sanitizeRecord(value: Record<string, unknown>): Record<string, unknown> {
  const sanitized = sanitizeJsonbValue(value);
  return isRecord(sanitized) ? sanitized : {};
}

function sanitizeRecordArray(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) return undefined;

  const sanitized = sanitizeJsonbValue(value);
  if (!Array.isArray(sanitized)) return undefined;

  const records = sanitized.filter(isRecord);
  return records.length > 0 ? records : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
