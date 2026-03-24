type CheckLike = { ok: boolean };

export const CORE_COMPUTE_CHECK_KEYS = [
  "wallet",
  "broker",
  "ledger",
  "subAccount",
  "ack",
] as const;

export type CoreComputeCheckKey = (typeof CORE_COMPUTE_CHECK_KEYS)[number];

export type CoreComputeChecks = Partial<Record<CoreComputeCheckKey, CheckLike>>;

export function listCoreComputeFailures(checks: CoreComputeChecks | null | undefined): CoreComputeCheckKey[] {
  if (!checks) return [...CORE_COMPUTE_CHECK_KEYS];
  return CORE_COMPUTE_CHECK_KEYS.filter((key) => checks[key]?.ok !== true);
}

export function isCoreComputeReady(checks: CoreComputeChecks | null | undefined): boolean {
  return listCoreComputeFailures(checks).length === 0;
}
