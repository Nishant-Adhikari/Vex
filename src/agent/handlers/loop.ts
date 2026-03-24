/**
 * Echo Loop control handlers.
 *
 * POST /api/agent/loop/start — start echo loop with mode + interval
 * POST /api/agent/loop/stop — stop echo loop
 * GET  /api/agent/loop/status — read from DB (includes phase, timing)
 * GET  /api/agent/loop/cycles — recent cycle history
 */

import { registerRoute, jsonResponse, errorResponse } from "../routes.js";
import * as loopRepo from "../db/repos/loop.js";
import { startLoopEngine, stopLoopEngine } from "../scheduler.js";
import { parseLoopStartRequest, RequestValidationError } from "../validation.js";

export function registerLoopRoutes(): void {
  registerRoute("GET", "/api/agent/loop/status", async (_req, res) => {
    const state = await loopRepo.getLoopState();
    jsonResponse(res, 200, state);
  });

  registerRoute("GET", "/api/agent/loop/cycles", async (_req, res) => {
    const cycles = await loopRepo.getRecentCycles(20);
    jsonResponse(res, 200, { cycles });
  });

  registerRoute("POST", "/api/agent/loop/start", async (_req, res, params) => {
    let parsed: ReturnType<typeof parseLoopStartRequest>;
    try {
      parsed = parseLoopStartRequest(params.body);
    } catch (err) {
      if (err instanceof RequestValidationError) {
        errorResponse(res, 400, "VALIDATION_ERROR", err.message);
        return;
      }
      throw err;
    }

    const { mode, intervalMs } = parsed;

    // Start echo loop (persists state + starts phased runtime)
    await startLoopEngine(mode, intervalMs);

    jsonResponse(res, 200, { active: true, mode, intervalMs });
  });

  registerRoute("POST", "/api/agent/loop/stop", async (_req, res) => {
    await stopLoopEngine();
    jsonResponse(res, 200, { active: false });
  });
}
