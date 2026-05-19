/**
 * "New Session" dialog. Owns the local form state and submits via
 * `useCreateSession()`. On success the new session is selected
 * automatically (`uiStore.setActiveSessionId`) so the panel opens
 * straight onto it.
 *
 * Form invariants mirror the IPC schema discriminated union:
 *   - mode = agent → goal field disabled + ignored
 *   - mode = mission → goal required, trim().min(1)
 * The submit button stays disabled when the form is invalid for the
 * selected mode.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import {
  AiChat01Icon,
  Shield02Icon,
  Target02Icon,
  ZapIcon,
} from "@hugeicons/core-free-icons";
import {
  INITIAL_GOAL_MAX_LENGTH,
  type SessionCreateInput,
  type SessionMode,
  type SessionPermission,
} from "@shared/schemas/sessions.js";
import { Button } from "../../components/ui/button.js";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { Label } from "../../components/ui/label.js";
import { cn } from "../../lib/utils.js";
import { useCreateSession } from "../../lib/api/sessions.js";
import { useUiStore } from "../../stores/uiStore.js";

interface SessionCreatorProps {
  readonly open: boolean;
  readonly onOpenChange: (next: boolean) => void;
}

interface ModeOption {
  readonly value: SessionMode;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

const MODE_OPTIONS: ReadonlyArray<ModeOption> = [
  {
    value: "agent",
    title: "Agent",
    description: "One-shot conversation. Vex stays in chat, no loop.",
    icon: AiChat01Icon,
  },
  {
    value: "mission",
    title: "Mission",
    description:
      "Goal-driven loop. Vex pursues a target and can self-schedule wakes.",
    icon: Target02Icon,
  },
];

interface PermissionOption {
  readonly value: SessionPermission;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

const PERMISSION_OPTIONS: ReadonlyArray<PermissionOption> = [
  {
    value: "restricted",
    title: "Restricted",
    description: "Every mutating transaction requires your approval.",
    icon: Shield02Icon,
  },
  {
    value: "full",
    title: "Full access",
    description: "Auto-execute approved tools without prompting per call.",
    icon: ZapIcon,
  },
];

export function SessionCreator({
  open,
  onOpenChange,
}: SessionCreatorProps): JSX.Element {
  const setActiveSessionId = useUiStore((s) => s.setActiveSessionId);
  const createMutation = useCreateSession();

  const [mode, setMode] = useState<SessionMode>("agent");
  const [permission, setPermission] = useState<SessionPermission>("restricted");
  const [goal, setGoal] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const goalRef = useRef<HTMLTextAreaElement | null>(null);

  // Reset state on every (re)open so the next opening starts clean.
  useEffect(() => {
    if (open) {
      setMode("agent");
      setPermission("restricted");
      setGoal("");
      setSubmitError(null);
    }
  }, [open]);

  // Mission mode: focus the goal textarea so the keyboard user can type
  // immediately. Defer to next tick so the dialog finishes its open
  // transition first.
  useEffect(() => {
    if (mode !== "mission" || !open) return;
    const id = requestAnimationFrame(() => {
      goalRef.current?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mode, open]);

  const trimmedGoal = goal.trim();
  const formInvalid =
    mode === "mission" ? trimmedGoal.length === 0 : false;
  const submitDisabled = formInvalid || createMutation.isPending;

  const onSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      if (submitDisabled) return;
      setSubmitError(null);
      const input: SessionCreateInput =
        mode === "mission"
          ? { mode: "mission", permission, initialGoal: trimmedGoal }
          : { mode: "agent", permission };
      const outcome = await createMutation.mutateAsync(input);
      if (!outcome.ok) {
        setSubmitError(outcome.error.message);
        return;
      }
      setActiveSessionId(outcome.data.id);
      onOpenChange(false);
    },
    [
      createMutation,
      mode,
      onOpenChange,
      permission,
      setActiveSessionId,
      submitDisabled,
      trimmedGoal,
    ],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl border-white/[0.10] bg-[#071024]/92 text-foreground shadow-[0_0_80px_rgba(22,68,190,0.28)] backdrop:bg-black/70 backdrop:backdrop-blur-sm">
        <form onSubmit={onSubmit} className="flex flex-col">
          <DialogHeader className="border-white/[0.08]">
            <DialogTitle className="text-xl">New session</DialogTitle>
            <DialogDescription className="text-[var(--color-text-secondary)]">
              Choose how the session behaves. Mode and permission are
              locked once the session is created.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="gap-5">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">Mode</legend>
              <div className="grid grid-cols-2 gap-2">
                {MODE_OPTIONS.map((opt) => (
                  <RadioCard
                    key={opt.value}
                    name="mode"
                    value={opt.value}
                    checked={mode === opt.value}
                    onChange={() => setMode(opt.value)}
                    title={opt.title}
                    description={opt.description}
                    icon={opt.icon}
                  />
                ))}
              </div>
            </fieldset>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium text-foreground">
                Permission
              </legend>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSION_OPTIONS.map((opt) => (
                  <RadioCard
                    key={opt.value}
                    name="permission"
                    value={opt.value}
                    checked={permission === opt.value}
                    onChange={() => setPermission(opt.value)}
                    title={opt.title}
                    description={opt.description}
                    icon={opt.icon}
                  />
                ))}
              </div>
            </fieldset>

            {mode === "mission" ? (
              <div className="flex flex-col gap-2">
                <Label htmlFor="vex-session-goal">Goal</Label>
                <textarea
                  ref={goalRef}
                  id="vex-session-goal"
                  required
                  maxLength={INITIAL_GOAL_MAX_LENGTH}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                  rows={4}
                  placeholder="Describe what you want the mission to accomplish."
                  className={cn(
                    "min-h-24 w-full rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2 text-sm shadow-sm",
                    "placeholder:text-muted-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#3275f8]",
                  )}
                />
                <div className="flex items-center justify-between gap-3 text-xs text-[var(--color-text-secondary)]">
                  <p>
                    Vex will refine this with you in the first turn before
                    the mission starts.
                  </p>
                  <span aria-live="polite">{goal.length} / {INITIAL_GOAL_MAX_LENGTH}</span>
                </div>
              </div>
            ) : null}

            {submitError !== null ? (
              <p className="text-sm text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
          </DialogBody>

          <DialogFooter className="border-white/[0.08]">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={createMutation.isPending}
              className="text-[var(--color-text-secondary)] hover:bg-white/[0.06] hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={submitDisabled}
              className="bg-[#3758ff] text-white hover:bg-[#4668ff]"
            >
              {createMutation.isPending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface RadioCardProps {
  readonly name: string;
  readonly value: string;
  readonly checked: boolean;
  readonly onChange: () => void;
  readonly title: string;
  readonly description: string;
  readonly icon: IconSvgElement;
}

function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  icon,
}: RadioCardProps): JSX.Element {
  return (
    <label
      className={cn(
        "flex min-h-[112px] cursor-pointer flex-col gap-2 rounded-lg border bg-white/[0.035] px-3 py-3 text-sm transition-colors",
        checked
          ? "border-[#3275f8]/55 bg-[#3275f8]/14 ring-1 ring-[#3275f8]/55"
          : "border-white/[0.08] hover:bg-white/[0.06]",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="sr-only"
      />
      <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-black/[0.18] text-[#8da5ff]">
        <HugeiconsIcon icon={icon} size={17} aria-hidden />
      </span>
      <span className="font-medium text-foreground">{title}</span>
      <span className="text-xs text-[var(--color-text-secondary)]">
        {description}
      </span>
    </label>
  );
}
