/**
 * SessionPanel forwards the composer focus handoff unchanged
 * (fix/hypervexing-exit-focus, item b) — to BOTH SessionComposer mount sites
 * (welcome/no-session stage and the active-session tape), since either can be
 * the render the shell returns to. SessionPanel itself stays agnostic to WHY
 * a handoff was requested; this only protects the wiring.
 *
 * Heavy children are stubbed (same rationale as SessionPanel-approval.test.tsx)
 * so this stays a focused wiring test.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { SessionListItem } from "@shared/schemas/sessions.js";

vi.mock("../../../lib/api/messages.js", () => ({
  useTranscriptLiveSync: () => undefined,
  useTranscriptInfinite: () => ({ data: undefined, isLoading: false }),
  flattenTranscriptPages: () => [],
}));
vi.mock("../../../lib/api/usage.js", () => ({
  useUsageLiveSync: () => undefined,
}));
vi.mock("../../../lib/api/streams.js", () => ({
  useStreamPreviewSync: () => undefined,
}));
vi.mock("../../../lib/api/runtime.js", async (importActual) => {
  const actual = await importActual<
    typeof import("../../../lib/api/runtime.js")
  >();
  return {
    ...actual,
    useControlStateLiveSync: () => undefined,
  };
});
vi.mock("../../../lib/api/sessions.js", async (importActual) => {
  const actual = await importActual<
    typeof import("../../../lib/api/sessions.js")
  >();
  return {
    ...actual,
    useSession: () => ({
      data: {
        ok: true,
        data: {
          id: SESSION,
          mode: "agent",
        } as unknown as SessionListItem, // test-local cast — render only checks wiring
      } satisfies Result<SessionListItem>,
      isLoading: false,
    }),
  };
});
vi.mock("../../../lib/api/approvals.js", () => ({
  usePendingApprovals: () => ({ data: { ok: true, data: [] } }),
  useApprove: () => ({ mutate: vi.fn(), isPending: false }),
  useReject: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("../SessionContext.js", () => ({ SessionContext: () => null }));
vi.mock("../SessionTranscript.js", () => ({ SessionTranscript: () => null }));
vi.mock("../SessionWelcomeHero.js", () => ({ SessionWelcomeHero: () => null }));

const composerProps = vi.fn();
vi.mock("../SessionComposer.js", () => ({
  SessionComposer: (props: unknown) => {
    composerProps(props);
    return null;
  },
}));

const { SessionPanel } = await import("../SessionPanel.js");
const { useUiStore } = await import("../../../stores/uiStore.js");

const SESSION = "00000000-0000-4000-8000-00000000aa02";

afterEach(() => {
  useUiStore.setState({ activeSessionId: null });
  vi.clearAllMocks();
});

function renderPanel(): void {
  composerProps.mockClear();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFocusRequestHandled = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <SessionPanel
        focusRequest
        onFocusRequestHandled={onFocusRequestHandled}
      />
    </QueryClientProvider>,
  );
}

function lastComposerProps(): {
  focusRequest?: boolean;
  onFocusRequestHandled?: () => void;
} {
  expect(composerProps).toHaveBeenCalled();
  return composerProps.mock.calls.at(-1)?.[0] as {
    focusRequest?: boolean;
    onFocusRequestHandled?: () => void;
  };
}

describe("SessionPanel — composer focus handoff wiring", () => {
  it("forwards focusRequest/onFocusRequestHandled unchanged to the active-session composer", () => {
    useUiStore.setState({ activeSessionId: SESSION });
    renderPanel();
    const props = lastComposerProps();
    expect(props.focusRequest).toBe(true);
    expect(typeof props.onFocusRequestHandled).toBe("function");
  });

  it("forwards focusRequest/onFocusRequestHandled unchanged to the welcome-stage composer", () => {
    useUiStore.setState({ activeSessionId: null });
    renderPanel();
    const props = lastComposerProps();
    expect(props.focusRequest).toBe(true);
    expect(typeof props.onFocusRequestHandled).toBe("function");
  });
});
