import { useState, useEffect } from "react";
import { cn } from "../utils";
import {
  HugeiconsIcon,
  Rocket01Icon,
  CheckmarkCircle02Icon,
  DangerIcon,
  HourglassIcon,
  StopCircleIcon,
  Pulse02Icon,
} from "./icons";
import type { SubagentState, SubagentStatus } from "../types";

const STATUS_CONFIG: Record<SubagentStatus, { color: string; bgColor: string; icon: unknown; label: string }> = {
  running:     { color: "text-accent",      bgColor: "bg-accent/10",      icon: Pulse02Icon,          label: "Running" },
  completed:   { color: "text-status-ok",   bgColor: "bg-status-ok/10",   icon: CheckmarkCircle02Icon, label: "Done" },
  error:       { color: "text-status-error", bgColor: "bg-status-error/10", icon: DangerIcon,           label: "Error" },
  timeout:     { color: "text-status-warn", bgColor: "bg-status-warn/10", icon: HourglassIcon,        label: "Timeout" },
  interrupted: { color: "text-muted-foreground", bgColor: "bg-muted",     icon: StopCircleIcon,       label: "Interrupted" },
  stopped:     { color: "text-muted-foreground", bgColor: "bg-muted",     icon: StopCircleIcon,       label: "Stopped" },
};

interface Props {
  agent: SubagentState;
}

export default function SubagentCard({ agent }: Props) {
  const [elapsed, setElapsed] = useState("");
  const config = STATUS_CONFIG[agent.status] ?? STATUS_CONFIG.running;
  const isActive = agent.status === "running";

  useEffect(() => {
    if (!isActive) {
      if (agent.endedAt) {
        const ms = new Date(agent.endedAt).getTime() - new Date(agent.startedAt).getTime();
        setElapsed(formatDuration(ms));
      }
      return;
    }
    const update = () => {
      const ms = Date.now() - new Date(agent.startedAt).getTime();
      setElapsed(formatDuration(ms));
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [isActive, agent.startedAt, agent.endedAt]);

  const progress = agent.maxIterations > 0
    ? Math.min(100, (agent.iterations / agent.maxIterations) * 100)
    : 0;

  return (
    <div className={cn(
      "rounded-xl border px-3 py-2.5 transition-all",
      isActive ? "border-accent/20 bg-accent/5" : "border-border/40 bg-card/30",
    )}>
      {/* Header: name + status */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={cn("w-5 h-5 rounded-full flex items-center justify-center relative", config.bgColor)}>
            <HugeiconsIcon icon={config.icon as never} size={12} className={config.color} />
            {isActive && (
              <div className="absolute inset-[-2px] rounded-full border-t border-accent animate-spin" />
            )}
          </div>
          <span className="text-[13px] font-medium text-foreground truncate">{agent.name}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={cn("text-2xs font-medium", config.color)}>{config.label}</span>
          <span className="text-2xs text-muted-foreground/50 font-mono">{elapsed}</span>
        </div>
      </div>

      {/* Task description */}
      <p className="mt-1.5 text-[11px] text-muted-foreground/70 line-clamp-2 leading-relaxed">
        {agent.task}
      </p>

      {/* Progress bar + stats */}
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              isActive ? "bg-accent/60" : agent.status === "completed" ? "bg-status-ok/50" : "bg-muted-foreground/30",
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0">
          {agent.iterations}/{agent.maxIterations}
        </span>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const s = sec % 60;
  return `${min}m ${s}s`;
}
