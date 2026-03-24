/**
 * Subagent REST handlers.
 *
 * GET /api/agent/subagents — list active + recent subagents
 * GET /api/agent/subagents/:id — single subagent detail
 */

import { registerRoute, jsonResponse } from "../routes.js";
import { getSubagentStatus } from "../subagent.js";

export function registerSubagentRoutes(): void {
  registerRoute("GET", "/api/agent/subagents", async (_req, res) => {
    const agents = await getSubagentStatus();
    jsonResponse(res, 200, { subagents: agents });
  });

  // ID-based lookup uses path: /api/agent/subagents/detail
  // with id in the body or as a path param parsed by the caller
  registerRoute("GET", "/api/agent/subagents/detail", async (_req, res, params) => {
    const id = params.pathParams?.id;
    if (!id) {
      jsonResponse(res, 200, { subagents: [] });
      return;
    }
    const agents = await getSubagentStatus(id);
    jsonResponse(res, 200, { subagents: agents });
  });
}
