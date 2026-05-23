/**
 * MissionContractCard render-state tests (puzzle 04 phase 7).
 *
 * Four render states the card must surface:
 *   1. `setup-needed`        — draft.status === "draft"
 *   2. `awaiting-acceptance` — status ready, diff.isAccepted=false
 *   3. `accepted`            — diff.isAccepted=true + !isDirty
 *   4. `dirty-acceptance`    — diff.isAccepted=true + isDirty=true
 *
 * Plus: Accept button click calls `useAcceptMissionContract` with the
 * `currentHash` the card just rendered.
 *
 * Matchers: plain Vitest/Chai (no `@testing-library/jest-dom`) —
 * mirrors the rest of the renderer test suite (see
 * `IntroScreen.test.tsx`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import { MissionContractCard } from "../MissionContractCard.js";

const SESSION = "00000000-0000-4000-8000-00000000bbbb";
const MISSION = "mission-1";
const HASH = "a".repeat(64);

const mockBridge = {
  getDraft: vi.fn(),
  updateDraft: vi.fn(),
  getDiff: vi.fn(),
  acceptContract: vi.fn(),
  start: vi.fn(),
  continue: vi.fn(),
  recover: vi.fn(),
  rewind: vi.fn(),
  restore: vi.fn(),
  renew: vi.fn(),
  stop: vi.fn(),
  getRenewableSource: vi.fn(),
};

const SAMPLE_DRAFT = {
  missionId: MISSION,
  sessionId: SESSION,
  status: "ready" as const,
  title: "Rebalance LP",
  goal: "Move USDC into a tighter range on Uniswap.",
  constraints: {
    maxSpendUsd: 100,
    maxLossUsd: 10,
  },
  successCriteria: ["TVL up by 5%"],
  stopConditions: ["TVL down 10%"],
  riskProfile: "balanced",
  allowedChains: ["ethereum"],
  allowedProtocols: ["uniswap"],
  allowedWallets: ["w1"],
  createdAt: "2026-05-22T08:00:00.000Z",
  updatedAt: "2026-05-22T09:00:00.000Z",
  approvedAt: null,
  acceptance: null,
  renewedFromMissionId: null,
};

const READY_DIFF = {
  outcome: "ready" as const,
  missionId: MISSION,
  sessionId: SESSION,
  currentHash: HASH,
  contractHashVersion: 1,
  acceptedHash: null,
  acceptedAt: null,
  acceptedBy: null,
  acceptedContractHashVersion: null,
  isAccepted: false,
  isDirty: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: { mission: mockBridge },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, "vex");
});

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function Wrapper(client: QueryClient) {
  return function ({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("MissionContractCard render states", () => {
  it("returns null when no draft exists", () => {
    mockBridge.getDraft.mockResolvedValue({ ok: true, data: null });
    mockBridge.getDiff.mockResolvedValue({ ok: true, data: READY_DIFF });
    const { container } = render(
      <MissionContractCard sessionId={SESSION} />,
      { wrapper: Wrapper(makeClient()) },
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows 'Setup needed' badge when draft.status === 'draft'", async () => {
    mockBridge.getDraft.mockResolvedValue({
      ok: true,
      data: { ...SAMPLE_DRAFT, status: "draft" },
    });
    mockBridge.getDiff.mockResolvedValue({ ok: true, data: READY_DIFF });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    await waitFor(() => {
      expect(screen.queryByText(/Setup needed/i)).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: /Accept/i })).toBeNull();
  });

  it("shows 'Awaiting acceptance' + Accept button when ready + unaccepted", async () => {
    mockBridge.getDraft.mockResolvedValue({ ok: true, data: SAMPLE_DRAFT });
    mockBridge.getDiff.mockResolvedValue({ ok: true, data: READY_DIFF });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    await waitFor(() => {
      expect(screen.queryByText(/Awaiting acceptance/i)).not.toBeNull();
    });
    const accept = await screen.findByRole("button", {
      name: /Accept contract/i,
    });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows 'Accepted' badge (no action) when accepted and not dirty", async () => {
    mockBridge.getDraft.mockResolvedValue({
      ok: true,
      data: {
        ...SAMPLE_DRAFT,
        acceptance: {
          contractHash: HASH,
          acceptedAt: "2026-05-22T09:30:00.000Z",
          acceptedBy: "host",
          contractHashVersion: 1,
        },
      },
    });
    mockBridge.getDiff.mockResolvedValue({
      ok: true,
      data: {
        ...READY_DIFF,
        acceptedHash: HASH,
        acceptedAt: "2026-05-22T09:30:00.000Z",
        acceptedBy: "host",
        acceptedContractHashVersion: 1,
        isAccepted: true,
        isDirty: false,
      },
    });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    await waitFor(() => {
      expect(screen.queryByText(/^Accepted$/)).not.toBeNull();
    });
    expect(screen.queryByRole("button", { name: /Accept/i })).toBeNull();
  });

  it("shows 'Contract changed' + Re-accept when accepted but dirty", async () => {
    mockBridge.getDraft.mockResolvedValue({
      ok: true,
      data: {
        ...SAMPLE_DRAFT,
        acceptance: {
          contractHash: "b".repeat(64),
          acceptedAt: "2026-05-22T09:30:00.000Z",
          acceptedBy: "host",
          contractHashVersion: 1,
        },
      },
    });
    mockBridge.getDiff.mockResolvedValue({
      ok: true,
      data: {
        ...READY_DIFF,
        acceptedHash: "b".repeat(64),
        acceptedAt: "2026-05-22T09:30:00.000Z",
        acceptedBy: "host",
        acceptedContractHashVersion: 1,
        isAccepted: true,
        isDirty: true,
      },
    });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    await waitFor(() => {
      expect(screen.queryByText(/Contract changed/i)).not.toBeNull();
    });
    const accept = await screen.findByRole("button", {
      name: /Accept new contract/i,
    });
    expect((accept as HTMLButtonElement).disabled).toBe(false);
  });

  it("Accept button posts the currentHash from the diff (round-trip safety)", async () => {
    mockBridge.getDraft.mockResolvedValue({ ok: true, data: SAMPLE_DRAFT });
    mockBridge.getDiff.mockResolvedValue({ ok: true, data: READY_DIFF });
    mockBridge.acceptContract.mockResolvedValue({
      ok: true,
      data: { outcome: "accepted" },
    });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    const accept = await screen.findByRole("button", {
      name: /Accept contract/i,
    });
    fireEvent.click(accept);
    await waitFor(() => {
      expect(mockBridge.acceptContract).toHaveBeenCalledWith({
        sessionId: SESSION,
        missionId: MISSION,
        contractHash: HASH,
      });
    });
  });

  it("renders renewedFromMissionId pointer when set", async () => {
    mockBridge.getDraft.mockResolvedValue({
      ok: true,
      data: {
        ...SAMPLE_DRAFT,
        renewedFromMissionId: "mission-prev",
      },
    });
    mockBridge.getDiff.mockResolvedValue({ ok: true, data: READY_DIFF });
    render(<MissionContractCard sessionId={SESSION} />, {
      wrapper: Wrapper(makeClient()),
    });
    await waitFor(() => {
      expect(screen.queryByText(/Renewed from mission/i)).not.toBeNull();
    });
    expect(screen.queryByText(/mission-prev/)).not.toBeNull();
  });
});
