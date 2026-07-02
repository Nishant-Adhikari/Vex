/**
 * UpdateLayer (M13). Verifies the defensive no-op when the updater bridge is
 * absent (plain dev / isolated tests), and that an `available` status surfaces
 * the banner when the bridge is stubbed.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";
import type { UpdateStatus } from "@shared/schemas/updater.js";

// Isolate from the @hugeicons ESM icon lib (banner glyphs render nothing) —
// same convention as the appShell modal tests.
vi.mock("@hugeicons/react", () => ({
  HugeiconsIcon: () => null,
}));

const { UpdateLayer } = await import("../UpdateLayer.js");

function stubUpdater(status: UpdateStatus): void {
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      updater: {
        getStatus: vi.fn().mockResolvedValue({ ok: true, data: status }),
        onStatus: vi.fn(() => () => {}),
        checkNow: vi.fn(),
        startUpdateNow: vi.fn(),
        cancelDownload: vi.fn(),
        restartAndInstallNow: vi.fn(),
        openReleaseNotes: vi.fn(),
      },
    },
  });
}

function withClient(children: ReactNode): ReactNode {
  return createElement(QueryClientProvider, { client: new QueryClient() }, children);
}

afterEach(() => {
  // @ts-expect-error — test cleanup
  delete window.vex;
});

describe("UpdateLayer", () => {
  it("renders nothing when the updater bridge is absent", () => {
    const { container } = render(<UpdateLayer />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the banner when an update is available", async () => {
    stubUpdater({
      kind: "available",
      currentVersion: "1.0.0",
      latestVersion: "1.1.0",
      severity: "normal",
    });
    render(withClient(<UpdateLayer />));
    expect(
      await screen.findByText("Update available — Vex 1.1.0"),
    ).toBeTruthy();
  });
});
