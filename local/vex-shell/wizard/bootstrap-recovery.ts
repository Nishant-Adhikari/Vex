import type { BootstrapResult } from "../platform/bootstrap.js";

const MISSING_ENV_PREFIX = "Missing required env:";

export function shouldOfferLocalServicesStart(
  bootstrap: Pick<BootstrapResult, "failure">,
): boolean {
  const failure = bootstrap.failure;
  const message = failure?.message ?? "";
  if (!failure || message.startsWith(MISSING_ENV_PREFIX)) return false;

  const lower = message.toLowerCase();
  return (
    message.includes("ECONNREFUSED") ||
    lower.includes("connect") ||
    lower.includes("migrations failed") ||
    failure.stage === "bootstrap_checks"
  );
}
