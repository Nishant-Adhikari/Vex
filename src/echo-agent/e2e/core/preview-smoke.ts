/**
 * Preview smoke — verify dryRun produces zero writes in all pipeline tables.
 *
 * Takes snapshot before, executes preview tools, takes snapshot after.
 * All counts must be identical.
 */

import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import { makeContext } from "./scenario-runner.js";
import { takePipelineSnapshot, type PipelineSnapshot } from "./db-assertions.js";
import logger from "@utils/logger.js";

/** Subset of previewSupport tools that don't require seed funds for dryRun. */
const PREVIEW_SMOKE_TOOLS: { toolId: string; params: Record<string, unknown> }[] = [
  { toolId: "khalani.bridge", params: { fromChain: "ethereum", toChain: "arbitrum", fromToken: "USDC", toToken: "USDC", amount: "1000000", dryRun: true } },
  { toolId: "kyberswap.swap.buy", params: { chain: "ethereum", tokenIn: "USDC", tokenOut: "WETH", amountIn: "1", dryRun: true } },
  { toolId: "jaine.swap.sell", params: { tokenIn: "w0G", tokenOut: "USDC", amountIn: "1", dryRun: true } },
  { toolId: "slop.trade.buy", params: { token: "0x0000000000000000000000000000000000000001", amountOg: "0.01", dryRun: true } },
  { toolId: "polymarket.clob.buy", params: { conditionId: "0x0000000000000000000000000000000000000000000000000000000000000001", outcome: "yes", amount: 1, dryRun: true } },
];

export interface PreviewSmokeResult {
  pass: boolean;
  before: PipelineSnapshot;
  after: PipelineSnapshot;
  toolResults: { toolId: string; success: boolean; isDryRun: boolean }[];
}

export async function runPreviewSmoke(): Promise<PreviewSmokeResult> {
  const ctx = makeContext(`preview-smoke-${Date.now()}`);
  const before = await takePipelineSnapshot();
  const toolResults: PreviewSmokeResult["toolResults"] = [];

  for (const { toolId, params } of PREVIEW_SMOKE_TOOLS) {
    try {
      const result = await dispatchTool(
        {
          name: "execute_tool",
          args: { toolId, params },
          toolCallId: `preview-${toolId}-${Date.now()}`,
        },
        ctx,
      );

      toolResults.push({
        toolId,
        success: result.success,
        isDryRun: (result.data?.dryRun === true) || result.success,
      });
    } catch (err) {
      // Preview failures are expected (missing wallet, missing API key, etc.)
      // What matters is that nothing was written to DB
      toolResults.push({ toolId, success: false, isDryRun: true });
      logger.debug("e2e.preview_smoke.tool_error", {
        toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const after = await takePipelineSnapshot();

  const pass = before.executions === after.executions
    && before.captureItems === after.captureItems
    && before.activities === after.activities
    && before.openPositions === after.openPositions
    && before.lots === after.lots;

  logger.info("e2e.preview_smoke.result", { pass, before, after });

  return { pass, before, after, toolResults };
}
