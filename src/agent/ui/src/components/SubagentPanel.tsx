import { cn } from "../utils";
import { HugeiconsIcon, Robot01Icon, Cancel01Icon } from "./icons";
import SubagentCard from "./SubagentCard";
import type { SubagentState } from "../types";

interface Props {
  subagents: SubagentState[];
  visible: boolean;
  onClose: () => void;
}

export default function SubagentPanel({ subagents, visible, onClose }: Props) {
  const active = subagents.filter((a) => a.status === "running");
  const recent = subagents.filter((a) => a.status !== "running").slice(0, 5);

  return (
    <div className={cn(
      "h-full border-l border-border/40 bg-[#0a0a0a]/90 backdrop-blur-3xl",
      "transition-all duration-300 overflow-hidden shrink-0",
      visible ? "w-[320px] opacity-100" : "w-0 opacity-0",
    )}>
      <div className="w-[320px] h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
          <div className="flex items-center gap-2">
            <HugeiconsIcon icon={Robot01Icon as never} size={16} className="text-accent" />
            <span className="text-[13px] font-medium text-foreground">Subagents</span>
            {active.length > 0 && (
              <span className="text-2xs font-mono bg-accent/15 text-accent px-1.5 py-0.5 rounded-full">
                {active.length} active
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/5 transition-colors"
          >
            <HugeiconsIcon icon={Cancel01Icon as never} size={14} className="text-muted-foreground" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2 scrollbar-thin">
          {subagents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <HugeiconsIcon icon={Robot01Icon as never} size={32} className="text-muted-foreground/20 mb-3" />
              <p className="text-[11px] text-muted-foreground/40">
                No subagents yet. The agent will spawn them when needed.
              </p>
            </div>
          ) : (
            <>
              {active.length > 0 && (
                <div className="space-y-2">
                  {active.map((agent) => (
                    <SubagentCard key={agent.id} agent={agent} />
                  ))}
                </div>
              )}

              {recent.length > 0 && (
                <>
                  {active.length > 0 && (
                    <div className="flex items-center gap-2 py-1.5">
                      <div className="flex-1 h-px bg-border/30" />
                      <span className="text-2xs text-muted-foreground/30 font-medium uppercase tracking-wide">Recent</span>
                      <div className="flex-1 h-px bg-border/30" />
                    </div>
                  )}
                  <div className="space-y-2">
                    {recent.map((agent) => (
                      <SubagentCard key={agent.id} agent={agent} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
