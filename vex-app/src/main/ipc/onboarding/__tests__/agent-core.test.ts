/**
 * vex.onboarding.agentCoreConfigure IPC handler smoke tests (M9).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestWebContents,
  createTrustedSender,
  type TestIpcEvent,
} from "../../__tests__/test-sender.js";

type Handler = (
  event: TestIpcEvent,
  raw: unknown,
) => Promise<unknown>;

const handlers = new Map<string, Handler>();
const mockWriter = vi.fn();

vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, fn: Handler) => {
      handlers.set(channel, fn);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { isPackaged: true },
}));

vi.mock("../../../onboarding/agent-core-writer.js", () => ({
  writeAgentCoreConfig: (input: unknown) => mockWriter(input),
}));

vi.mock("../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerAgentCoreHandler } = await import("../agent-core.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

beforeEach(() => {
  handlers.clear();
  mockWriter.mockReset();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("agentCoreConfigure handler", () => {
  it("forwards empty payload to writer (validate-only)", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: { fieldsWritten: [], fieldsCleared: [] },
    });
    registerAgentCoreHandler();
    const fn = handlers.get(CH.onboarding.agentCoreConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r1",
      payload: {},
    })) as { ok: boolean; data?: { fieldsWritten: string[] } };
    expect(result.ok).toBe(true);
    expect(mockWriter).toHaveBeenCalledWith({});
  });

  it("forwards tri-state payload (number + null + absent)", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: {
        fieldsWritten: ["AGENT_CONTEXT_LIMIT"],
        fieldsCleared: ["AGENT_TEMPERATURE"],
      },
    });
    registerAgentCoreHandler();
    const fn = handlers.get(CH.onboarding.agentCoreConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r2",
      payload: { contextLimit: 64000, temperature: null },
    })) as { ok: boolean; data?: { fieldsCleared: string[] } };
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data?.fieldsCleared).toContain("AGENT_TEMPERATURE");
    expect(mockWriter).toHaveBeenCalledWith({
      contextLimit: 64000,
      temperature: null,
    });
  });

  it("propagates cross-field violation error with details", async () => {
    mockWriter.mockResolvedValue({
      ok: false,
      error: {
        code: "validation.invalid_input",
        domain: "onboarding",
        message: "x",
        retryable: false,
        userActionable: true,
        redacted: true,
        details: { violation: "max_output_exceeds_context" },
      },
    });
    registerAgentCoreHandler();
    const fn = handlers.get(CH.onboarding.agentCoreConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r3",
      payload: { maxOutputTokens: 99000 },
    })) as { ok: boolean; error?: { code: string; details?: unknown } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(result.error?.details).toMatchObject({
      violation: "max_output_exceeds_context",
    });
  });

  it("rejects out-of-range temperature at the schema boundary", async () => {
    registerAgentCoreHandler();
    const fn = handlers.get(CH.onboarding.agentCoreConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r4",
      payload: { temperature: 5 },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockWriter).not.toHaveBeenCalled();
  });

  it("accepts literal 0 temperature (not coerced to undefined)", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: { fieldsWritten: ["AGENT_TEMPERATURE"], fieldsCleared: [] },
    });
    registerAgentCoreHandler();
    const fn = handlers.get(CH.onboarding.agentCoreConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r5",
      payload: { temperature: 0 },
    })) as { ok: boolean };
    expect(result.ok).toBe(true);
    expect(mockWriter).toHaveBeenCalledWith({ temperature: 0 });
  });
});
