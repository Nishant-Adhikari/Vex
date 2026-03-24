import { useState, useEffect, useCallback } from "react";
import type { SubagentState } from "../types";

/** Tracks subagent state from SSE events + periodic polling. */
export function useSubagents() {
  const [subagents, setSubagents] = useState<SubagentState[]>([]);

  // Poll every 10s for full state
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch("/api/agent/subagents", { credentials: "same-origin" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.subagents)) {
            setSubagents(data.subagents);
          }
        }
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  const handleSubagentSpawned = useCallback((data: Record<string, unknown>) => {
    const agent: SubagentState = {
      id: String(data.id),
      name: String(data.name),
      task: String(data.task ?? ""),
      status: "running",
      startedAt: new Date().toISOString(),
      endedAt: null,
      iterations: 0,
      maxIterations: 25,
      tokenCostOg: 0,
    };
    setSubagents((prev) => [agent, ...prev.filter((a) => a.id !== agent.id)]);
  }, []);

  const handleSubagentProgress = useCallback((data: Record<string, unknown>) => {
    const id = String(data.id);
    setSubagents((prev) =>
      prev.map((a) =>
        a.id === id ? { ...a, iterations: Number(data.iteration ?? a.iterations) } : a,
      ),
    );
  }, []);

  const handleSubagentCompleted = useCallback((data: Record<string, unknown>) => {
    const id = String(data.id);
    setSubagents((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status: String(data.status) as SubagentState["status"], endedAt: new Date().toISOString() }
          : a,
      ),
    );
  }, []);

  const hasActive = subagents.some((a) => a.status === "running");

  return {
    subagents,
    hasActive,
    handleSubagentSpawned,
    handleSubagentProgress,
    handleSubagentCompleted,
  };
}
