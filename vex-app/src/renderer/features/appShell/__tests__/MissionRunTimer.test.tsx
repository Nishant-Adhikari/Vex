/**
 * MissionRunTimer — the live running-time / time-left readout. Renders elapsed
 * always, remaining only when a deadline is known, and a pulse while live.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { MissionRunTimer } from "../MissionRunTimer.js";

const START = Date.parse("2026-07-24T00:00:00.000Z");

afterEach(() => {
  vi.useRealTimers();
});

describe("MissionRunTimer", () => {
  it("renders nothing without a start time", () => {
    const { container } = render(
      createElement(MissionRunTimer, {
        startedAtMs: null,
        deadlineMs: null,
        live: true,
        now: () => START,
      }),
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows elapsed only when no deadline is known", () => {
    render(
      createElement(MissionRunTimer, {
        startedAtMs: START,
        deadlineMs: null,
        live: false,
        now: () => START + 90_000,
      }),
    );
    expect(screen.getByText("1:30")).toBeTruthy();
    expect(screen.queryByText(/Time left/i)).toBeNull();
  });

  it("shows elapsed AND time-left with a known deadline", () => {
    render(
      createElement(MissionRunTimer, {
        startedAtMs: START,
        deadlineMs: START + 60 * 60_000,
        live: false,
        now: () => START + 15 * 60_000,
      }),
    );
    // Elapsed 15:00, remaining 45:00.
    expect(screen.getByText("15:00")).toBeTruthy();
    expect(screen.getByText(/Time left/i)).toBeTruthy();
    expect(screen.getByText("45:00")).toBeTruthy();
  });

  it("flags an overdue deadline", () => {
    render(
      createElement(MissionRunTimer, {
        startedAtMs: START,
        deadlineMs: START + 60 * 60_000,
        live: false,
        now: () => START + 61 * 60_000,
      }),
    );
    expect(screen.getByText(/Deadline passed/i)).toBeTruthy();
  });

  it("shows a live pulse while running and ticks the elapsed clock", () => {
    vi.useFakeTimers();
    let current = START + 1_000;
    render(
      createElement(MissionRunTimer, {
        startedAtMs: START,
        deadlineMs: null,
        live: true,
        now: () => current,
      }),
    );
    expect(screen.getByRole("img", { name: "Mission running" })).toBeTruthy();
    expect(screen.getByText("0:01")).toBeTruthy();
    act(() => {
      current = START + 4_000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("0:04")).toBeTruthy();
  });
});
