import { vi } from "vitest";

export interface TestFrame {
  readonly url: string;
  readonly parent: TestFrame | null;
  readonly top: TestFrame | null;
}

export interface TestIpcEvent {
  readonly senderFrame?: TestFrame;
  readonly sender?: unknown;
}

export function createMainFrame(url: string = "app://vex/index.html"): TestFrame {
  const frame: { url: string; parent: TestFrame | null; top: TestFrame | null } = {
    url,
    parent: null,
    top: null,
  };
  frame.top = frame;
  return frame;
}

export function createTrustedSender<T extends object = Record<string, never>>(
  extra?: T
): { readonly senderFrame: TestFrame } & T {
  return {
    senderFrame: createMainFrame(),
    ...(extra ?? ({} as T)),
  };
}

export function createTestWebContents(): {
  readonly send: ReturnType<typeof vi.fn>;
  readonly isDestroyed: () => boolean;
} {
  return {
    send: vi.fn(),
    isDestroyed: () => false,
  };
}
