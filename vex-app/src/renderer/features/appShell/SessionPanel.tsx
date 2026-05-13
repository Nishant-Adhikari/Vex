/**
 * Main panel. Renders one of:
 *   - the welcome banner when no session is selected and the user has
 *     never created one,
 *   - the metadata placeholder for the active session (Phase 2's real
 *     chat UI lands later),
 *   - an "open a session" prompt when the user has sessions but none
 *     is currently selected.
 */

import type { JSX } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { useSession, useSessionsList } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";
import { WelcomeBanner } from "./WelcomeBanner.js";

interface SessionPanelProps {
  readonly onCreate: () => void;
}

export function SessionPanel({ onCreate }: SessionPanelProps): JSX.Element {
  const activeSessionId = useUiStore((s) => s.activeSessionId);
  const listQuery = useSessionsList();
  const detailQuery = useSession(activeSessionId);

  const sessionsCount =
    listQuery.data && listQuery.data.ok ? listQuery.data.data.length : 0;

  if (activeSessionId === null) {
    if (sessionsCount === 0) {
      return (
        <CenterWrap>
          <WelcomeBanner onStart={onCreate} />
        </CenterWrap>
      );
    }
    return (
      <CenterWrap>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>No session selected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-text-secondary)]">
              Pick a session from the sidebar, or start a new one.
            </p>
          </CardContent>
        </Card>
      </CenterWrap>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <CenterWrap>
        <p className="text-sm text-[var(--color-text-secondary)]">
          Loading session…
        </p>
      </CenterWrap>
    );
  }

  if (!detailQuery.data) return <CenterWrap>{null}</CenterWrap>;

  if (detailQuery.data.ok === false) {
    return (
      <CenterWrap>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Session unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-destructive">
              {detailQuery.data.error.message}
            </p>
          </CardContent>
        </Card>
      </CenterWrap>
    );
  }

  const session = detailQuery.data.data;
  if (session === null) {
    return (
      <CenterWrap>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Session not found</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--color-text-secondary)]">
              The selected session no longer exists. Pick another from
              the sidebar.
            </p>
          </CardContent>
        </Card>
      </CenterWrap>
    );
  }

  return (
    <CenterWrap>
      <Card className="w-full max-w-2xl">
        <CardHeader>
          <CardTitle>Session metadata</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Phase 2 will fill this with chat UI. Mode: {session.mode},
            Permission: {session.permission}, Goal:{" "}
            {session.initialGoal === null ? "none" : session.initialGoal}
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-xs font-mono text-[var(--color-text-muted)]">
            <dt>session.id</dt>
            <dd className="break-all text-foreground/80">{session.id}</dd>
            <dt>started</dt>
            <dd className="text-foreground/80">{session.startedAt}</dd>
            {session.missionStatus !== null ? (
              <>
                <dt>missionStatus</dt>
                <dd className="text-foreground/80">{session.missionStatus}</dd>
              </>
            ) : null}
          </dl>
        </CardContent>
      </Card>
    </CenterWrap>
  );
}

function CenterWrap({ children }: { readonly children: JSX.Element | null }): JSX.Element {
  return (
    <div className="flex h-full w-full items-center justify-center p-8">
      {children}
    </div>
  );
}
