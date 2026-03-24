import { useState, useEffect } from "react";
import { cn } from "../utils";
import {
  HugeiconsIcon,
  Radar02Icon,
  BrainIcon,
  FlashIcon,
  PlayCircleIcon,
  CheckmarkCircle02Icon,
  Note01Icon,
  Moon01Icon,
  RepeatIcon,
} from "./icons";
import type { LoopPhase, LoopState } from "../types";

const PHASE_CONFIG: Record<LoopPhase, { icon: unknown; label: string; color: string }> = {
  idle:    { icon: Moon01Icon,            label: "Idle",    color: "text-muted-foreground/50" },
  sense:   { icon: Radar02Icon,           label: "Sense",   color: "text-accent" },
  assess:  { icon: BrainIcon,             label: "Assess",  color: "text-purple-400" },
  decide:  { icon: FlashIcon,             label: "Decide",  color: "text-amber-400" },
  execute: { icon: PlayCircleIcon,        label: "Execute", color: "text-status-ok" },
  verify:  { icon: CheckmarkCircle02Icon, label: "Verify",  color: "text-cyan-400" },
  journal: { icon: Note01Icon,            label: "Journal", color: "text-muted-foreground" },
  sleep:   { icon: Moon01Icon,            label: "Sleep",   color: "text-muted-foreground/60" },
};

interface Props {
  loop: LoopState;
}

export default function LoopStatusBar({ loop }: Props) {
  const [lastAgo, setLastAgo] = useState("");
  const [nextIn, setNextIn] = useState("");

  useEffect(() => {
    if (!loop.active) return;
    const update = () => {
      if (loop.lastCycleAt) {
        const ms = Date.now() - new Date(loop.lastCycleAt).getTime();
        setLastAgo(formatRelative(ms));
      }
      if (loop.lastCycleAt) {
        const nextMs = loop.intervalMs - (Date.now() - new Date(loop.lastCycleAt).getTime());
        setNextIn(nextMs > 0 ? formatRelative(nextMs) : "now");
      }
    };
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [loop.active, loop.lastCycleAt, loop.intervalMs]);

  if (!loop.active) return null;

  const phase = PHASE_CONFIG[loop.currentPhase] ?? PHASE_CONFIG.idle;
  const isWorking = loop.currentPhase !== "idle" && loop.currentPhase !== "sleep";

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border/30 bg-card/20">
      {/* Phase indicator */}
      <div className="flex items-center gap-1.5">
        <div className={cn("relative", isWorking && "animate-pulse")}>
          <HugeiconsIcon icon={phase.icon as never} size={12} className={phase.color} />
        </div>
        <span className={cn("text-2xs font-medium uppercase tracking-wide", phase.color)}>
          {phase.label}
        </span>
      </div>

      <div className="h-3 w-px bg-border/30" />

      {/* Cycle count */}
      <div className="flex items-center gap-1">
        <HugeiconsIcon icon={RepeatIcon as never} size={10} className="text-muted-foreground/40" />
        <span className="text-2xs font-mono text-muted-foreground/50">
          #{loop.cycleCount}
        </span>
      </div>

      <div className="h-3 w-px bg-border/30" />

      {/* Timing */}
      <span className="text-2xs font-mono text-muted-foreground/40">
        {lastAgo && `Last: ${lastAgo}`}
        {lastAgo && nextIn && " · "}
        {nextIn && `Next: ${nextIn}`}
      </span>
    </div>
  );
}

function formatRelative(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hours = Math.floor(min / 60);
  return `${hours}h ${min % 60}m`;
}
