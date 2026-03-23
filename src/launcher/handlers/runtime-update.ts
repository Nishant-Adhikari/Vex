import type { RouteHandler } from "../types.js";
import { errorResponse, jsonResponse, registerRoute } from "../routes.js";
import {
  applyRuntimeUpdate,
  getRuntimeUpdateStatus,
  retryRuntimeUpdatePull,
} from "../../update/runtime-update-service.js";

const handleStatus: RouteHandler = async (_req, res) => {
  jsonResponse(res, 200, await getRuntimeUpdateStatus());
};

const handleRetry: RouteHandler = async (_req, res) => {
  const status = await retryRuntimeUpdatePull();
  jsonResponse(res, 200, { retried: true, status });
};

const handleApply: RouteHandler = async (_req, res) => {
  const result = await applyRuntimeUpdate();
  if (!result.status.agentManagedByPackage) {
    errorResponse(res, 409, "RUNTIME_UPDATE_DISABLED", "Agent image is explicitly overridden; package-managed runtime update is disabled.");
    return;
  }

  if (result.status.targetPackageVersion == null && !result.healthy) {
    errorResponse(res, 409, "RUNTIME_UPDATE_NOT_PENDING", "No pending agent runtime update is available.");
    return;
  }

  if (!result.applied && !result.healthy) {
    errorResponse(
      res,
      409,
      "RUNTIME_UPDATE_NOT_READY",
      result.status.lastError ?? "The new agent image is not ready to apply yet.",
    );
    return;
  }

  jsonResponse(res, 200, result);
};

export function registerRuntimeUpdateRoutes(): void {
  registerRoute("GET", "/api/runtime-update", handleStatus);
  registerRoute("POST", "/api/runtime-update/retry", handleRetry);
  registerRoute("POST", "/api/runtime-update/apply", handleApply);
}
