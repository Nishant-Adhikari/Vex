import { useEffect, useRef } from "react";
import { listSessionSubagents } from "../../platform/subagent-monitor.js";
import type { Store } from "../state/store.js";
import { useStore } from "../state/store.js";

const POLL_INTERVAL_MS = 1_000;

export function useSubagentMonitor(store: Store): void {
  const sessionId = useStore(store, (state) => state.session?.id ?? null);
  const reportedErrors = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!sessionId) {
      store.setState({ subagentRows: [] });
      return;
    }

    let disposed = false;

    async function refresh(): Promise<void> {
      if (!sessionId) return;
      try {
        const rows = await listSessionSubagents(sessionId);
        if (disposed) return;

        const freshErrors = rows.filter((row) => row.attention === "error" && row.error);
        const nextError = freshErrors.find((row) => !reportedErrors.current.has(row.id));
        for (const row of freshErrors) reportedErrors.current.add(row.id);

        store.setState({
          subagentRows: rows,
          ...(nextError ? { lastError: formatSubagentError(nextError.name, nextError.error) } : {}),
        });
      } catch (err) {
        if (!disposed) {
          store.setState({ lastError: err instanceof Error ? err.message : String(err) });
        }
      }
    }

    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, POLL_INTERVAL_MS);

    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [sessionId, store]);
}

function formatSubagentError(name: string, error: string | null): string {
  const message = error?.replace(/\s+/g, " ").trim() || "unknown error";
  const clipped = message.length > 160 ? `${message.slice(0, 157)}...` : message;
  return `subagent ${name}: ${clipped}`;
}
