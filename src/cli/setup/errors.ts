import { McpBootstrapError } from "../../mcp/bootstrap.js";
import { McpHealthError } from "../../mcp/runtime/health.js";

export function formatLauncherError(error: unknown): string {
  if (error instanceof McpBootstrapError || error instanceof McpHealthError) {
    return error.hint ? `${error.message} Hint: ${error.hint}` : error.message;
  }

  return error instanceof Error ? error.message : String(error);
}
