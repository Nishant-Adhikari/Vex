/**
 * TanStack Query key factories per skill §5. Centralised so M2-M5 view
 * code never assembles raw key arrays inline (and so invalidation
 * targets — `queryClient.invalidateQueries({ queryKey: dockerKeys.all })`
 * — touch every consumer atomically).
 */

export const systemKeys = {
  all: ["system"] as const,
  health: () => ["system", "health"] as const,
  osInfo: () => ["system", "osInfo"] as const,
  network: () => ["system", "network"] as const,
};

export const dockerKeys = {
  all: ["docker"] as const,
  status: () => ["docker", "status"] as const,
};

export const onboardingKeys = {
  all: ["onboarding"] as const,
  envState: () => ["onboarding", "envState"] as const,
  wizardState: () => ["onboarding", "wizardState"] as const,
};

// ── Agent integration puzzle 1 ────────────────────────────────────────
// Each factory namespaces queries under a stable root so cross-cutting
// invalidation (`queryClient.invalidateQueries({ queryKey: messagesKeys.all })`)
// targets every consumer at once. Mutation hooks for fail-closed
// handlers do NOT invalidate query caches — there is no state change to
// surface until the matching puzzle ships the runtime.

export const messagesKeys = {
  all: ["messages"] as const,
  tail: (sessionId: string, limit: number) =>
    ["messages", "tail", sessionId, { limit }] as const,
  list: (sessionId: string, limit: number, cursorId: number | null) =>
    ["messages", "list", sessionId, { limit, cursorId }] as const,
  around: (
    sessionId: string,
    messageId: number,
    before: number,
    after: number,
  ) =>
    ["messages", "around", sessionId, messageId, { before, after }] as const,
};

export const usageKeys = {
  all: ["usage"] as const,
  sessionTotals: (sessionId: string, currency: string) =>
    ["usage", "sessionTotals", sessionId, { currency }] as const,
  lastTurn: (sessionId: string, currency: string) =>
    ["usage", "lastTurn", sessionId, { currency }] as const,
};

export const runtimeKeys = {
  all: ["runtime"] as const,
  state: (sessionId: string) => ["runtime", "state", sessionId] as const,
};

export const missionKeys = {
  all: ["mission"] as const,
  draft: (sessionId: string) => ["mission", "draft", sessionId] as const,
};

export const approvalsKeys = {
  all: ["approvals"] as const,
  pending: (sessionId: string) => ["approvals", "pending", sessionId] as const,
  detail: (id: string) => ["approvals", "detail", id] as const,
  history: (sessionId: string, limit: number) =>
    ["approvals", "history", sessionId, { limit }] as const,
};

export const walletsKeys = {
  all: ["wallets"] as const,
  sessionScope: (sessionId: string) =>
    ["wallets", "sessionScope", sessionId] as const,
  preparedIntent: (intentId: string) =>
    ["wallets", "preparedIntent", intentId] as const,
};

export const modelsKeys = {
  all: ["models"] as const,
  available: () => ["models", "available"] as const,
};

export const sessionModelKeys = {
  all: ["sessionModel"] as const,
  detail: (sessionId: string) =>
    ["sessionModel", "detail", sessionId] as const,
};
