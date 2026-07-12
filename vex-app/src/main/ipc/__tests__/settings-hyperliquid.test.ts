import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { defaultPreferences, type Preferences } from "@shared/schemas/preferences.js";
import { createTestWebContents, createTrustedSender, type TestIpcEvent } from "./test-sender.js";

type Handler = (event: TestIpcEvent, raw: unknown) => Promise<unknown>;
const handlers = vi.hoisted(() => new Map<string, Handler>());
const state = vi.hoisted(() => ({ preferences: null as Preferences | null }));

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
    removeHandler: (channel: string) => handlers.delete(channel),
  },
  app: { isPackaged: true },
}));

vi.mock("../../preferences/store.js", () => ({
  preferencesStore: {
    load: async () => state.preferences,
    update: async (patch: Partial<Preferences>) => {
      state.preferences = {
        ...state.preferences!,
        ...patch,
      };
      return state.preferences;
    },
  },
}));
vi.mock("../../telemetry/sentry-lifecycle.js", () => ({
  disableSentry: vi.fn(),
  initSentryIfConsented: vi.fn(),
}));
vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerSettingsHandlers } = await import("../settings.js");
const { CH } = await import("@shared/ipc/channels.js");

const sender = createTrustedSender({ sender: createTestWebContents() });

beforeEach(() => {
  handlers.clear();
  state.preferences = structuredClone(defaultPreferences);
  registerSettingsHandlers();
});

afterEach(() => handlers.clear());

async function call(payload: unknown): Promise<{ readonly ok: boolean; readonly data?: Preferences; readonly error?: { readonly code: string } }> {
  const handler = handlers.get(CH.settings.setHyperliquidPolicy);
  if (handler === undefined) throw new Error("Hyperliquid settings handler was not registered.");
  return await handler(sender, { requestId: "00000000-0000-4000-8000-000000000111", payload }) as {
    readonly ok: boolean;
    readonly data?: Preferences;
    readonly error?: { readonly code: string };
  };
}

describe("Hyperliquid settings IPC", () => {
  it("persists only the user-owned global controls", async () => {
    const result = await call({ policy: { requireStopLoss: false, egressAlwaysApprove: false } });
    expect(result.ok).toBe(true);
    expect(result.data?.hyperliquid.policy.requireStopLoss).toBe(false);
    expect(result.data?.hyperliquid.policy.egressAlwaysApprove).toBe(false);
    expect(result.data?.hyperliquid.policy.builderFeeConsent).toEqual({ kind: "none" });
  });

  it("rejects builder fee consent through the generic settings path", async () => {
    const result = await call({ policy: { builderFeeConsent: { kind: "approved", maxFeeRate: "0.025%" } } });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });
});
