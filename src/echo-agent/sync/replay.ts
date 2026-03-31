/**
 * Replay projections — one-time correction tool.
 *
 * Reads immutable audit trail (protocol_executions + protocol_capture_items),
 * truncates projection tables, and re-runs activity population with
 * type correction from MUTATION_MATRIX.
 *
 * Does NOT modify protocol_executions or protocol_capture_items.
 * TRUNCATES only: proj_activity, proj_open_positions, proj_pnl_lots.
 *
 * Idempotent: can run multiple times with same result.
 * Run once after W3 handler fixes are deployed.
 */

import { query, execute } from "@echo-agent/db/client.js";
import { MUTATION_MATRIX, isExpectedType } from "@echo-agent/tools/protocols/mutation-matrix.js";
import { extractExternalRefs, replayActivityFromCapture } from "@echo-agent/tools/protocols/capture-pipeline.js";
import logger from "@utils/logger.js";

interface ReplayStats {
  replayed: number;
  skipped: number;
  errors: number;
}

/**
 * Replay all projections from protocol_executions + protocol_capture_items.
 *
 * Steps:
 * 1. TRUNCATE projection tables (proj_activity, proj_open_positions, proj_pnl_lots)
 * 2. Read all successful executions chronologically
 * 3. For each execution: read its capture_items (batch truth), apply type correction, replay
 * 4. Return stats
 */
export async function replayProjections(): Promise<ReplayStats> {
  const stats: ReplayStats = { replayed: 0, skipped: 0, errors: 0 };

  // 1. Truncate projection tables only (audit trail is immutable)
  logger.info("replay.truncating_projections");
  await execute("TRUNCATE proj_activity, proj_open_positions, proj_pnl_lots");

  // 2. Read all successful executions chronologically
  const executions = await query<Record<string, unknown>>(
    `SELECT id, tool_id, namespace, params, trade_capture
     FROM protocol_executions
     WHERE success = true
     ORDER BY created_at ASC`,
    [],
  );

  logger.info("replay.starting", { executionCount: executions.length });

  for (const exec of executions) {
    const executionId = exec.id as number;
    const toolId = exec.tool_id as string;
    const namespace = exec.namespace as string;
    const params = (exec.params as Record<string, unknown>) ?? {};
    const storedCapture = (exec.trade_capture as Record<string, unknown>) ?? null;

    // Skip preview executions
    if (params.dryRun === true) {
      stats.skipped++;
      continue;
    }

    try {
      // 3. Read capture items for this execution (batch truth)
      const captureItemRows = await query<Record<string, unknown>>(
        "SELECT trade_capture FROM protocol_capture_items WHERE execution_id = $1 ORDER BY id ASC",
        [executionId],
      );

      // Build items: prefer capture_items (batch truth), fallback to execution.trade_capture
      let items: Record<string, unknown>[];
      if (captureItemRows.length > 0) {
        items = captureItemRows
          .map(r => r.trade_capture as Record<string, unknown>)
          .filter(Boolean);
      } else if (storedCapture) {
        items = [storedCapture];
      } else {
        stats.skipped++;
        continue;
      }

      if (items.length === 0) {
        stats.skipped++;
        continue;
      }

      // 4. Apply type correction per item
      const contract = MUTATION_MATRIX.get(toolId);
      const correctedItems = items.map(item => {
        if (!contract) return item;
        const currentType = typeof item.type === "string" ? item.type : "";
        if (currentType && !isExpectedType(contract, currentType)) {
          // Correct type to first expected type
          const correctedType = Array.isArray(contract.expectedType)
            ? contract.expectedType[0]
            : contract.expectedType;
          return { ...item, type: correctedType };
        }
        return item;
      });

      // 5. Replay activity (does NOT create new capture_items — reads existing)
      const executionRefs = extractExternalRefs({ _tradeCapture: storedCapture });
      await replayActivityFromCapture(executionId, toolId, namespace, correctedItems, executionRefs);
      stats.replayed++;

    } catch (err) {
      stats.errors++;
      logger.warn("replay.execution_failed", {
        executionId, toolId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  logger.info("replay.completed", stats);
  return stats;
}
