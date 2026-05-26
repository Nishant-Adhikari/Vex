/**
 * Session transcript surface (stage 8-1) — the live conversation for a
 * selected session.
 *
 * Reads the bounded newest page via `useMessageTail` (the session's
 * `useTranscriptLiveSync` subscription, mounted in `SessionPanel`, keeps it
 * fresh). Renders loading (dotmatrix) / error / empty / list, bottom-anchored:
 * jumps to the newest message on session change and on new arrivals *only*
 * while the user is pinned to the bottom, so reading older history isn't
 * yanked. Virtualization + load-older history land in a follow-up slice; the
 * tail is bounded (≤100) so a plain scroll container is correct here.
 *
 * Handles BOTH transport failure (`query.isError`) and a handler error
 * (`Result.ok === false`). Content rendering is delegated to
 * `TranscriptMessage` (plain text, never HTML).
 */

import { useEffect, useMemo, useRef, type JSX } from "react";
import type { SessionMessageDto } from "@shared/schemas/messages.js";
import { useMessageTail } from "../../lib/api/messages.js";
import { DotmHex3 } from "../../components/ui/dotm-hex-3.js";
import { TranscriptMessage } from "./TranscriptMessage.js";
import { toTranscriptRow } from "./transcriptRowModel.js";

const PINNED_THRESHOLD_PX = 48;

export function SessionTranscript({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element {
  const query = useMessageTail(sessionId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const items = useMemo<readonly SessionMessageDto[]>(() => {
    const res = query.data;
    if (res === undefined || !res.ok) return [];
    return res.data.items;
  }, [query.data]);

  const newestId = items.at(-1)?.id ?? 0;

  // Reset to the bottom whenever the active session changes.
  useEffect(() => {
    pinnedToBottom.current = true;
    const el = scrollRef.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [sessionId]);

  // Follow new arrivals only while the user is reading the latest messages.
  useEffect(() => {
    const el = scrollRef.current;
    if (el !== null && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [newestId]);

  if (query.isLoading) {
    return (
      <div
        data-vex-area="chat-transcript"
        data-state="loading"
        className="flex min-h-0 flex-1 items-center justify-center"
      >
        <DotmHex3
          size={28}
          dotSize={4}
          color="#6f91ff"
          ariaLabel="Loading conversation"
        />
      </div>
    );
  }

  const res = query.data;
  if (query.isError || res === undefined || !res.ok) {
    const message =
      res !== undefined && !res.ok
        ? res.error.message
        : "Unable to load this conversation.";
    return (
      <div
        data-vex-area="chat-transcript"
        data-state="error"
        className="flex min-h-0 flex-1 items-center justify-center px-4"
      >
        <div
          role="alert"
          className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          {message}
        </div>
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div
        data-vex-area="chat-transcript"
        data-state="empty"
        className="flex min-h-0 flex-1 items-center justify-center px-4"
      >
        <p className="text-center text-sm text-[var(--color-text-muted)]">
          Start the conversation — your messages and Vex&apos;s replies appear
          here.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (el === null) return;
        const distanceFromBottom =
          el.scrollHeight - el.scrollTop - el.clientHeight;
        pinnedToBottom.current = distanceFromBottom < PINNED_THRESHOLD_PX;
      }}
      data-vex-area="chat-transcript"
      data-state="ready"
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-4"
    >
      {items.map((m) => (
        <TranscriptMessage key={m.id} row={toTranscriptRow(m)} />
      ))}
    </div>
  );
}
