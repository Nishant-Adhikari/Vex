import type { AgentStatus, RuntimeUpdateStatus } from "./types";

export interface RuntimeUpdateBannerModel {
  tone: "info" | "error";
  title: string;
  message: string;
  actionLabel: string | null;
  action: "apply" | "retry" | null;
  disabled?: boolean;
}

export function buildRuntimeUpdateBannerModel(
  status: RuntimeUpdateStatus | null,
  agentStatus: AgentStatus | null,
): RuntimeUpdateBannerModel | null {
  if (!status || !status.agentManagedByPackage) {
    return null;
  }

  if (status.applyInProgress) {
    return {
      tone: "info",
      title: "Applying update",
      message: `Restarting the agent on v${status.targetPackageVersion ?? status.currentPackageVersion}. The UI will reconnect when the runtime is healthy.`,
      actionLabel: null,
      action: null,
      disabled: true,
    };
  }

  if (status.pullStatus === "failed" && status.lastError) {
    return {
      tone: "error",
      title: "Update download failed",
      message: status.lastError,
      actionLabel: "Retry download",
      action: "retry",
    };
  }

  if (status.pullStatus !== "ready" || !status.targetPackageVersion) {
    return null;
  }

  if (agentStatus?.version === status.targetPackageVersion) {
    return null;
  }

  return {
    tone: "info",
    title: `Update ready: v${status.targetPackageVersion}`,
    message: `Agent v${agentStatus?.version ?? "current"} is still running. The new runtime is already downloaded and ready to switch over.`,
    actionLabel: "Restart to update",
    action: "apply",
  };
}
