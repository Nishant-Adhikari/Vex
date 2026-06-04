/**
 * Tool dispatcher — routes tool calls to the correct handler.
 *
 * The engine calls dispatchTool() for every tool call from the LLM.
 * Dispatcher decides: internal tool → direct handler, or
 * discover/execute → protocol runtime.
 *
 * Internal tool handlers are lazy-imported so a dispatch for one handler
 * never forces the rest of the internal tool modules into memory. PR1
 * replaced a 25-case `switch` with a typed `INTERNAL_TOOL_LOADERS` map —
 * same lazy semantics, data-driven, and the completeness test structurally
 * catches orphaned entries.
 */

import type { ToolCallRequest, ToolResult } from "./types.js";
import type { InternalToolContext } from "./internal/types.js";
import { getActionKind, getPressureSafety, isInternalTool, isMutatingTool, isToolBlockedForRole } from "./registry.js";
import { getProtocolManifest } from "./protocols/catalog.js";
import { discoverProtocolCapabilities } from "./protocols/runtime.js";
import { executeProtocolTool } from "./protocols/runtime.js";
import {
  MUTATING_PROTOCOL_ALIAS_ROUTERS,
  MutatingAliasRouteError,
  isMutatingProtocolAlias,
} from "./mutating-aliases.js";
import { logDiscoveryTelemetry, newDiscoveryRunId } from "./protocols/discovery.telemetry.js";
import { toResultData } from "./protocols/handler-helpers.js";
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";
import logger from "@utils/logger.js";

/**
 * Stamp `result.actionKind` from the registry fallback when the handler did
 * not set it. Preserves a handler-set value (e.g. `executeProtocolTool` which
 * derives from the TARGET protocol manifest, not from the `execute_tool`
 * wrapper's own classification). Leaves `actionKind` undefined when the tool
 * name is not registered — the routing layer already returns an "unknown
 * tool" error in that case and policy consumers can treat absent `actionKind`
 * as the conservative "unknown" signal.
 *
 * Plan: agents_dm/plan-integration/05-approvals-wallet-policy.md §"Action taxonomy".
 */
function withActionKindFallback(result: ToolResult, toolName: string): ToolResult {
  if (result.actionKind !== undefined) return result;
  const kind = getActionKind(toolName);
  if (kind === undefined) return result;
  return { ...result, actionKind: kind };
}

/**
 * Pressure-band hard-deny check. Returns a synthetic error result when the
 * tool should be blocked at the current band; returns null when dispatch can
 * proceed. Bands `barrier` and `critical` block tools with `pressureSafety
 * === "mutating"`. `compact_only` tools dispatch only at those bands.
 */
export function checkPressureDeny(
  toolName: string,
  band: ContextUsageBand,
): ToolResult | null {
  const safety = getPressureSafety(toolName);
  if (safety === undefined) return null; // unknown tool — let routing handle it

  const atBarrier = band === "barrier" || band === "critical";

  if (atBarrier && safety === "mutating") {
    return {
      success: false,
      output:
        `Tool ${toolName} is blocked at context pressure ${band}. ` +
        `Call compact_now first to compact the conversation; the next turn after compaction restores the full tool set.`,
    };
  }

  if (!atBarrier && safety === "compact_only") {
    return {
      success: false,
      output:
        `Tool ${toolName} is only available at context pressure barrier (≥ 88% of context limit). ` +
        `Current band is ${band}; continue with normal work.`,
    };
  }

  return null;
}

/**
 * Dispatch a tool call to the appropriate handler.
 *
 * Returns a ToolResult that the engine feeds back to the LLM.
 * Never throws — errors are caught and returned as failed results.
 */
export async function dispatchTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  const startTime = Date.now();

  // Pressure-band hard-deny: at barrier/critical bands, mutating tools are
  // rejected with a synthetic error pointing the agent at compact_now. The
  // soft filter (LLM-visible tool catalog projection) is the first layer;
  // this is the runtime safety net for tools the model emits anyway.
  if (context.contextUsageBand) {
    const denied = checkPressureDeny(call.name, context.contextUsageBand);
    if (denied) {
      logger.info("tools.dispatch.pressure_denied", {
        tool: call.name,
        band: context.contextUsageBand,
      });
      return withActionKindFallback(denied, call.name);
    }
  }

  try {
    const result = await routeToolCall(call, context);
    const durationMs = Date.now() - startTime;

    logger.debug("tools.dispatch.completed", {
      tool: call.name,
      success: result.success,
      durationMs,
    });

    return withActionKindFallback(result, call.name);
  } catch (err) {
    const durationMs = Date.now() - startTime;
    const message = err instanceof Error ? err.message : String(err);

    logger.warn("tools.dispatch.failed", {
      tool: call.name,
      error: message,
      durationMs,
    });

    return withActionKindFallback(
      { success: false, output: `Tool ${call.name} failed: ${message}` },
      call.name,
    );
  }
}

// ── Routing ──────────────────────────────────────────────────────

/**
 * Phase 4d: does this dispatch run an IRREVERSIBLE (mutating) tool? For
 * `execute_tool` the answer comes from the TARGET protocol manifest (the
 * wrapper itself is `mutating: false`); a missing/unknown target is treated as
 * non-mutating. For a MUTATING protocol-alias (Stage 8b, e.g. `swap`) the
 * answer ALSO comes from the resolved TARGET manifest, so the mission
 * auto-retry-unsafe stamp reflects the target — not a generic alias default.
 * For other internal tools it is the registry `mutating` flag. Preview / dryRun
 * targets are stamped conservatively (a mutating manifest stamps regardless) —
 * safer to over-stamp than to miss a broadcast.
 *
 * This predicate must classify SIDE-EFFECT RISK, not validate args. A router
 * throw (invalid args, Solana + EVM-only `side`, unknown family) is swallowed
 * here and falls back to the alias's own registry `mutating` flag (true for a
 * mutating alias) so the stamp still fires conservatively; the real router
 * error surfaces later as a bounded failure in the dedicated dispatch branch.
 */
export function dispatchTargetIsMutating(call: ToolCallRequest): boolean {
  if (call.name === "execute_tool") {
    const toolId = typeof call.args.toolId === "string" ? call.args.toolId : "";
    if (!toolId) return false;
    return getProtocolManifest(toolId)?.mutating === true;
  }
  if (isMutatingProtocolAlias(call.name)) {
    const router = MUTATING_PROTOCOL_ALIAS_ROUTERS[call.name];
    try {
      const target = router(call.args);
      return getProtocolManifest(target.toolId)?.mutating === true;
    } catch {
      // Un-routable args are NOT a side-effect signal — fall back to the
      // alias's registry classification (mutating) so the stamp is conservative.
      return isMutatingTool(call.name);
    }
  }
  return isMutatingTool(call.name);
}

async function routeToolCall(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  // Phase 4d safety stamp: durably mark the mission run auto-retry-UNSAFE
  // BEFORE any mutating tool runs (sticky double-spend gate — an error after a
  // side effect can then never auto-retry). FAIL-CLOSED: if the stamp write
  // throws we propagate, so dispatchTool's catch returns a failed result and
  // the mutating handler never executes. Read-only tools and non-mission
  // dispatches (missionRunId === null) skip this. Dynamic import mirrors the
  // protocol runtime's DB-access pattern and avoids a static tool→DB cycle.
  if (context.missionRunId !== null && dispatchTargetIsMutating(call)) {
    const { markAutoRetryUnsafe } = await import(
      "@vex-agent/db/repos/mission-runs.js"
    );
    await markAutoRetryUnsafe(context.missionRunId);
  }

  // Protocol meta-tools
  if (call.name === "discover_tools") {
    const discoveryRequest = {
      query: typeof call.args.query === "string" ? call.args.query : undefined,
      namespace: typeof call.args.namespace === "string" ? call.args.namespace : undefined,
      limit: typeof call.args.limit === "number" ? call.args.limit : undefined,
      contextUsageBand: context.contextUsageBand,
    };
    const result = await discoverProtocolCapabilities(discoveryRequest);
    logDiscoveryTelemetry({
      request: discoveryRequest, result, discoveryRunId: newDiscoveryRunId(),
      sourceSurface: context.sourceSurface, sourceSession: context.sourceSession,
    });
    return {
      success: result.success,
      output: JSON.stringify(result, null, 2),
      data: toResultData(result),
    };
  }

  if (call.name === "execute_tool") {
    const toolId = typeof call.args.toolId === "string" ? call.args.toolId : "";
    const params = typeof call.args.params === "object" && call.args.params !== null
      ? call.args.params as Record<string, unknown>
      : {};

    if (!toolId) {
      return { success: false, output: "Missing required parameter: toolId" };
    }

    return executeProtocolTool(
      { toolId, params },
      {
        sessionPermission: context.sessionPermission,
        approved: context.approved,
        sessionId: context.sessionId,
        contextUsageBand: context.contextUsageBand,
        walletResolution: context.walletResolution,
        walletPolicy: context.walletPolicy,
      },
    );
  }

  // Hard role enforcement — blocked tools rejected even if model emits them.
  // Runs BEFORE the mutating-alias branch so `excludeRoles` still gates the
  // alias name (defense-in-depth for any future subagent-blocked alias).
  if (isToolBlockedForRole(call.name, context.role)) {
    return {
      success: false,
      output: `Tool "${call.name}" is not available for this session role (${context.role}).`,
    };
  }

  // Mutating protocol-alias branch (Stage 8b — e.g. `swap`). DEDICATED path:
  // resolve the TARGET protocol toolId + translated params via the router, then
  // dispatch DIRECTLY through `executeProtocolTool`. This deliberately SKIPS
  // `routeInternalTool`'s internal mutating-approval gate so approval is owned
  // SOLELY by `executeProtocolTool`, which runs the ordering the alias depends
  // on: Stage-7 prequote gate → approval gate → capture. The returned
  // ToolResult is passed back VERBATIM (it already carries `pendingApproval` +
  // the typed `prequote.verdict` for the restricted-mode approval preview, and
  // the TARGET manifest's `actionKind`). The target was already used for the
  // mission auto-retry-unsafe stamp (`dispatchTargetIsMutating`) and the
  // pressure-deny used the alias's `mutating` pressureSafety (equivalent — the
  // router only ever resolves to mutating targets). A router throw is a bounded
  // failure ToolResult — NO target is dispatched on an un-routable request.
  if (isMutatingProtocolAlias(call.name)) {
    const router = MUTATING_PROTOCOL_ALIAS_ROUTERS[call.name];
    let target: ReturnType<typeof router>;
    try {
      target = router(call.args);
    } catch (err) {
      if (err instanceof MutatingAliasRouteError) {
        return { success: false, output: err.message };
      }
      throw err; // unexpected — let dispatchTool's catch produce a failed result
    }
    return executeProtocolTool(
      { toolId: target.toolId, params: target.params },
      {
        sessionPermission: context.sessionPermission,
        approved: context.approved,
        sessionId: context.sessionId,
        contextUsageBand: context.contextUsageBand,
        walletResolution: context.walletResolution,
        walletPolicy: context.walletPolicy,
      },
    );
  }

  // Internal tools — route by name
  if (!isInternalTool(call.name)) {
    return { success: false, output: `Unknown tool: ${call.name}` };
  }

  return routeInternalTool(call, context);
}

// ── Internal tool routing ────────────────────────────────────────
//
// Table-driven lazy loader map (PR1 replacement for the 25-case switch).
// Each entry imports exactly one internal-tool module and returns the
// named handler. Lazy imports keep startup cost low — a handler module is
// only parsed when its tool is actually dispatched.
//
// Adding a new internal tool: add a row here. `registry-completeness.test.ts`
// asserts every ToolDef with `kind: "internal"` has a loader entry — EXCEPT
// the direct-dispatch tools that `routeToolCall` handles via a dedicated
// branch above: the meta-tools `discover_tools` / `execute_tool` and the
// MUTATING protocol-aliases (`MUTATING_PROTOCOL_ALIAS_ROUTERS`, e.g. `swap`).

type InternalHandler = (
  args: Record<string, unknown>,
  context: InternalToolContext,
) => Promise<ToolResult>;

type InternalHandlerLoader = () => Promise<InternalHandler>;

export const INTERNAL_TOOL_LOADERS: Readonly<Record<string, InternalHandlerLoader>> = {
  // Web research (search + optional fetch in one tool)
  web_research: async () => (await import("./internal/web.js")).handleWebResearch,

  // Twitter/X account research
  twitter_account: async () => (await import("./internal/twitter-account.js")).handleTwitterAccount,

  // Knowledge — canonical agent memory layer
  knowledge_write: async () => (await import("./internal/knowledge.js")).handleKnowledgeWrite,
  knowledge_recall: async () => (await import("./internal/knowledge.js")).handleKnowledgeRecall,
  knowledge_recall_overflow: async () => (await import("./internal/knowledge.js")).handleKnowledgeRecallOverflow,
  knowledge_get: async () => (await import("./internal/knowledge.js")).handleKnowledgeGet,
  knowledge_update_status: async () => (await import("./internal/knowledge.js")).handleKnowledgeUpdateStatus,
  knowledge_supersede: async () => (await import("./internal/knowledge.js")).handleKnowledgeSupersede,
  knowledge_lineage: async () => (await import("./internal/knowledge.js")).handleKnowledgeLineage,
  knowledge_history: async () => (await import("./internal/knowledge.js")).handleKnowledgeHistory,

  // Portfolio
  portfolio: async () => (await import("./internal/portfolio-inspect.js")).handlePortfolio,

  // Khalani direct read aliases
  khalani_chains_list: async () => (await import("./internal/khalani.js")).handleKhalaniChainsList,
  khalani_tokens_top: async () => (await import("./internal/khalani.js")).handleKhalaniTokensTop,
  token_find: async () => (await import("./internal/khalani.js")).handleTokenFind,
  khalani_tokens_balances: async () => (await import("./internal/khalani.js")).handleKhalaniTokensBalances,

  // Action-named read-only aliases (Stage 8a) — quote/preview/status routers
  swap_quote: async () => (await import("./internal/action-aliases.js")).handleSwapQuote,
  token_check: async () => (await import("./internal/action-aliases.js")).handleTokenCheck,
  bridge_status: async () => (await import("./internal/action-aliases.js")).handleBridgeStatus,
  bridge_quote: async () => (await import("./internal/action-aliases.js")).handleBridgeQuote,

  // Setup / Configuration
  polymarket_setup: async () => (await import("./internal/polymarket-setup.js")).handlePolymarketSetup,

  // Mission
  mission_draft_update: async () => (await import("./internal/mission.js")).handleMissionDraftUpdate,
  mission_stop: async () => (await import("./internal/mission.js")).handleMissionStop,

  // Autonomy primitives — mission wake
  loop_defer: async () => (await import("./internal/loop-defer.js")).handleLoopDefer,
  tool_output_read: async () => (await import("./internal/tool-output-read.js")).handleToolOutputRead,

  // Per-session memory layer — agent-driven recall + outstanding-item closing
  memory_recall: async () => (await import("./internal/memory/recall.js")).handleMemoryRecall,
  mark_outstanding_resolved: async () =>
    (await import("./internal/memory/mark-resolved.js")).handleMarkOutstandingResolved,

  // Compact primitive — agent-driven entry point for compaction at pressure
  compact_now: async () => (await import("./internal/compact/now.js")).handleCompactNow,

  // Subagents — DISABLED (TODO subagent-disabled). Re-enable z registry/subagents.ts.
  // subagent_spawn: async () => (await import("./internal/subagent.js")).handleSubagentSpawn,
  // subagent_status: async () => (await import("./internal/subagent.js")).handleSubagentStatus,
  // subagent_stop: async () => (await import("./internal/subagent.js")).handleSubagentStop,
  // subagent_reply: async () => (await import("./internal/subagent.js")).handleSubagentReply,
  // subagent_request_parent: async () => (await import("./internal/subagent.js")).handleSubagentRequestParent,
  // subagent_report_complete: async () => (await import("./internal/subagent.js")).handleSubagentReportComplete,

  // EVM on-chain forensics — receipts + ERC-721 mint detection
  chain_read: async () => (await import("./internal/chain-read.js")).handleChainRead,

  // Wallet
  wallet_balances: async () => (await import("./internal/wallet/read.js")).handleWalletBalances,
  wallet_send_prepare: async () => (await import("./internal/wallet/send.js")).handleWalletSendPrepare,
  wallet_send_confirm: async () => (await import("./internal/wallet/send.js")).handleWalletSendConfirm,
};

async function routeInternalTool(
  call: ToolCallRequest,
  context: InternalToolContext,
): Promise<ToolResult> {
  const loader = INTERNAL_TOOL_LOADERS[call.name];
  if (!loader) {
    return { success: false, output: `Unknown internal tool: ${call.name}` };
  }
  if (isMutatingTool(call.name) && context.sessionPermission === "restricted" && !context.approved) {
    logger.info("tools.dispatch.approval_required", {
      tool: call.name,
      permission: context.sessionPermission,
    });
    return {
      success: false,
      output: `${call.name} requires approval — mutating tool in restricted permission mode.`,
      pendingApproval: true,
    };
  }

  const handler = await loader();
  return handler(call.args, context);
}
