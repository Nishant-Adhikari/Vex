/**
 * SessionTranscript render tests (stage 8-1).
 *
 * Verifies: the tail renders one row per message with the right
 * `data-vex-message-role`; tool name + system notice text show; the empty and
 * handler-error (`Result.ok === false`) states render; and — the security
 * guarantee for 8-1 — message content is printed as a literal text node, never
 * parsed as HTML (no injected element, only the Vex avatar `<img>`).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import type {
  MessageKind,
  MessageRole,
  SessionMessageDto,
} from "@shared/schemas/messages.js";
import { SessionTranscript } from "../SessionTranscript.js";

const SESSION = "00000000-0000-4000-8000-0000000000aa";
const ISO = "2026-05-26T10:00:00.000Z";
const getTailMock = vi.fn();

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function msg(p: {
  readonly id: number;
  readonly role: MessageRole;
  readonly kind: MessageKind;
  readonly content: string;
  readonly toolName?: string | null;
}): SessionMessageDto {
  return {
    id: p.id,
    sessionId: SESSION,
    role: p.role,
    kind: p.kind,
    content: p.content,
    createdAt: ISO,
    toolCallId: null,
    toolName: p.toolName ?? null,
  };
}

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { messages: { getTail: getTailMock } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("SessionTranscript", () => {
  it("renders each role and never parses message content as HTML", async () => {
    const injected = '<img src=x onerror="alert(1)"> **not bold**';
    getTailMock.mockResolvedValue(
      ok({
        items: [
          msg({ id: 1, role: "user", kind: "text", content: "hello vex" }),
          msg({ id: 2, role: "assistant", kind: "text", content: injected }),
          msg({
            id: 3,
            role: "tool",
            kind: "tool_result",
            content: "ok",
            toolName: "swap",
          }),
          msg({
            id: 4,
            role: "system",
            kind: "runtime_notice",
            content: "context compacted",
          }),
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );
    setVex();
    const { container } = render(
      createElement(SessionTranscript, { sessionId: SESSION }),
      { wrapper: makeWrapper(freshClient()) },
    );

    await waitFor(() => {
      expect(screen.getByText("hello vex")).not.toBeNull();
    });
    expect(container.querySelector('[data-vex-message-role="user"]')).not.toBeNull();
    expect(
      container.querySelector('[data-vex-message-role="assistant"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-vex-message-role="tool"]')).not.toBeNull();
    expect(
      container.querySelector('[data-vex-message-role="system"]'),
    ).not.toBeNull();
    expect(screen.getByText("swap")).not.toBeNull();
    expect(screen.getByText("context compacted")).not.toBeNull();
    // The injected markup is shown verbatim — no element is created from it.
    expect(screen.getByText(/onerror="alert\(1\)"/)).not.toBeNull();
    expect(container.querySelector("img[onerror]")).toBeNull();
    // The only image is the Vex avatar on the assistant row.
    expect(container.querySelector('img[src="/vex.jpg"]')).not.toBeNull();
  });

  it("shows the empty state when there are no messages", async () => {
    getTailMock.mockResolvedValue(
      ok({ items: [], nextCursor: null, hasMore: false }),
    );
    setVex();
    render(createElement(SessionTranscript, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => {
      expect(screen.getByText(/Start the conversation/i)).not.toBeNull();
    });
  });

  it("surfaces a handler error (Result.ok === false) as an alert", async () => {
    getTailMock.mockResolvedValue({
      ok: false,
      error: {
        code: "internal.unexpected",
        domain: "data",
        message: "DB is down",
        retryable: true,
        userActionable: true,
        redacted: true,
        correlationId: "c",
      },
    });
    setVex();
    render(createElement(SessionTranscript, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => {
      expect(screen.getByText("DB is down")).not.toBeNull();
    });
    expect(screen.getByRole("alert")).not.toBeNull();
  });
});
