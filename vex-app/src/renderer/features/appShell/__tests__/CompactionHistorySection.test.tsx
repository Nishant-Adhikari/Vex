/**
 * CompactionHistorySection retry tests (stage 8-5).
 *
 * Verifies the Retry affordance: it appears ONLY on `permanently_failed`
 * generations; clicking it calls `window.vex.compaction.retry` with the
 * (sessionId, generation) key; a failed retry surfaces an inline error; and
 * the button is disabled while its retry is in flight.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { CompactionHistorySection } from "../CompactionHistorySection.js";

const SESSION = "00000000-0000-4000-8000-0000000000d5";
const ISO = "2026-05-21T10:00:00.000Z";
const listHistoryMock = vi.fn();
const retryMock = vi.fn();

function ok<T>(data: T) {
  return { ok: true as const, data };
}

function item(gen: number, status: string) {
  return {
    checkpointGeneration: gen,
    status,
    sourceStartMessageId: 1,
    sourceEndMessageId: 30,
    chunksInserted: 0,
    createdAt: ISO,
    startedAt: ISO,
    completedAt: ISO,
  };
}

function setVex(): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { compaction: { listHistory: listHistoryMock, retry: retryMock } },
  });
}

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function freshClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

afterEach(() => {
  vi.clearAllMocks();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("CompactionHistorySection retry (8-5)", () => {
  it("shows Retry only on permanently_failed rows", async () => {
    listHistoryMock.mockResolvedValue(
      ok([item(3, "permanently_failed"), item(2, "completed")]),
    );
    setVex();
    render(createElement(CompactionHistorySection, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Retry compaction generation 3" }),
      ).not.toBeNull();
    });
    expect(
      screen.queryByRole("button", { name: "Retry compaction generation 2" }),
    ).toBeNull();
  });

  it("clicking Retry calls compaction.retry with the (sessionId, generation) key", async () => {
    listHistoryMock.mockResolvedValue(ok([item(3, "permanently_failed")]));
    retryMock.mockResolvedValue(ok({ checkpointGeneration: 3, status: "pending" }));
    setVex();
    render(createElement(CompactionHistorySection, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry compaction generation 3",
      }),
    );
    await waitFor(() => {
      expect(retryMock).toHaveBeenCalledWith({
        sessionId: SESSION,
        checkpointGeneration: 3,
      });
    });
  });

  it("surfaces a failed retry (ok:false) as an inline error", async () => {
    listHistoryMock.mockResolvedValue(ok([item(3, "permanently_failed")]));
    retryMock.mockResolvedValue({
      ok: false,
      error: {
        code: "compaction.invalid_state",
        domain: "compaction",
        message: "Only a permanently-failed compaction can be retried.",
        retryable: false,
        userActionable: true,
        redacted: true,
        correlationId: "c",
      },
    });
    setVex();
    render(createElement(CompactionHistorySection, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry compaction generation 3",
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Only a permanently-failed compaction/i),
      ).not.toBeNull();
    });
  });

  it("disables the Retry button while the retry is in flight", async () => {
    listHistoryMock.mockResolvedValue(ok([item(3, "permanently_failed")]));
    retryMock.mockReturnValue(new Promise(() => {})); // never resolves
    setVex();
    render(createElement(CompactionHistorySection, { sessionId: SESSION }), {
      wrapper: makeWrapper(freshClient()),
    });
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Retry compaction generation 3",
      }),
    );
    await waitFor(() => {
      const btn = screen.getByRole("button", {
        name: "Retry compaction generation 3",
      });
      expect((btn as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
