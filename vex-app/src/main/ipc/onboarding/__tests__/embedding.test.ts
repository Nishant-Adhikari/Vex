/**
 * vex.onboarding.embeddingConfigure IPC handler smoke tests (M9).
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

vi.mock("../../../onboarding/embedding-writer.js", () => ({
  writeEmbeddingConfig: (input: unknown) => mockWriter(input),
}));

vi.mock("../../../onboarding/env-write-mutex.js", () => ({
  withEnvWriteLock: <T>(fn: () => Promise<T>) => fn(),
}));

vi.mock("../../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { registerEmbeddingHandler } = await import("../embedding.js");
const { CH } = await import("@shared/ipc/channels.js");

const trustedSender = createTrustedSender({ sender: createTestWebContents() });

const VALID_INPUT = {
  baseUrl: "http://127.0.0.1:12434/engines/llama.cpp/v1",
  model: "ai/embeddinggemma:300M-Q8_0",
  dim: 768,
  provider: "local",
} as const;

beforeEach(() => {
  handlers.clear();
  mockWriter.mockReset();
});

afterEach(() => {
  handlers.clear();
  vi.clearAllMocks();
});

describe("embeddingConfigure handler", () => {
  it("returns ok({written:true,dimChanged:true}) on writer success", async () => {
    mockWriter.mockResolvedValue({
      ok: true,
      data: { written: true, dimChanged: true },
    });
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r1",
      payload: VALID_INPUT,
    })) as { ok: boolean; data?: { written: boolean } };
    expect(result.ok).toBe(true);
    expect(result.data?.written).toBe(true);
  });

  it("propagates dim_locked unchanged with details", async () => {
    mockWriter.mockResolvedValue({
      ok: false,
      error: {
        code: "embedding.dim_locked",
        domain: "embedding",
        message: "locked",
        retryable: false,
        userActionable: true,
        redacted: true,
        details: { existingRowCount: 5, targetDim: 768 },
      },
    });
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r2",
      payload: VALID_INPUT,
    })) as { ok: boolean; error?: { code: string; details?: unknown } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("embedding.dim_locked");
    expect(result.error?.details).toMatchObject({ existingRowCount: 5 });
  });

  it("propagates db_unavailable unchanged", async () => {
    mockWriter.mockResolvedValue({
      ok: false,
      error: {
        code: "embedding.db_unavailable",
        domain: "embedding",
        message: "DB down",
        retryable: true,
        userActionable: true,
        redacted: true,
      },
    });
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r3",
      payload: VALID_INPUT,
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("embedding.db_unavailable");
  });

  it("rejects malformed baseUrl at the schema boundary", async () => {
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r4",
      payload: { ...VALID_INPUT, baseUrl: "not-a-url" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockWriter).not.toHaveBeenCalled();
  });

  it("rejects credential-bearing baseUrl (Y2)", async () => {
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r5",
      payload: { ...VALID_INPUT, baseUrl: "https://user:pass@x.example/v1" },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
    expect(mockWriter).not.toHaveBeenCalled();
  });

  it("rejects out-of-range dim", async () => {
    registerEmbeddingHandler();
    const fn = handlers.get(CH.onboarding.embeddingConfigure)!;
    const result = (await fn(trustedSender, {
      requestId: "r6",
      payload: { ...VALID_INPUT, dim: 99999 },
    })) as { ok: boolean; error?: { code: string } };
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation.invalid_input");
  });
});
