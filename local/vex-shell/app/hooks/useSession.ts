/**
 * Session polling hook — keeps the store's `session` slice fresh with mission
 * status + pending approvals. Lightweight 1 s interval; session-host reads are
 * single-row lookups.
 *
 * Does NOT own the chat messages (those land via send-message action + 2D
 * polling). Does NOT create sessions (explicit new-session action in the UI).
 */

import { useEffect } from "react";
import {
  getPendingApprovalsForSession,
  summarizeSession,
} from "../../platform/session-host.js";
import type { Store } from "../state/store.js";

const POLL_INTERVAL_MS = 1000;

export function useSession(store: Store): void {
  useEffect(() => {
    let cancelled = false;
    const tick = async (): Promise<void> => {
      const { session } = store.getState();
      if (!session) return;
      try {
        const [summary, approvals] = await Promise.all([
          summarizeSession(session.id),
          getPendingApprovalsForSession(session.id),
        ]);
        if (cancelled) return;
        store.setState({
          session: summary ?? null,
          approvals: approvals.map((a) => ({
            id: a.id,
            tool: (a.toolCall.command ?? a.toolCall.name ?? "?") as string,
            createdAt: a.createdAt,
            reasoning: typeof a.reasoning === "string" ? a.reasoning : undefined,
          })),
        });
      } catch {
        // Transient DB blip — skip this tick. Next tick will recover.
      }
    };

    const handle = setInterval(tick, POLL_INTERVAL_MS);
    void tick(); // prime

    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, [store]);
}
