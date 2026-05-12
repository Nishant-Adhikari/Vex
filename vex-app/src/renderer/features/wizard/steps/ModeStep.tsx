/**
 * Wizard Step 7 — Mode (M11).
 *
 * Three radio cards (chat / mission / full_autonomous). Mission unlocks
 * a textarea for the goal (min 5 chars after trim) plus a loop-mode
 * select. Full-autonomous unlocks an OPTIONAL seed prompt.
 *
 * Skip-card semantics use `envState.mode.coherent` (codex v3 D13) —
 * not just key presence — so a manual `.env` edit that left
 * AGENT_MODE=mission without a goal still drops to the form (rather
 * than skipping into an inconsistent state). The form does NOT
 * pre-fill the prompt textarea even when partial state is present —
 * operator types the prompt deliberately each visit.
 *
 * Full_autonomous shows an inline note that wake will be enforced at
 * finalize (`finalize.ts::ensureFullAutonomousWakeCoherent`) so the
 * operator is not surprised when the wake step pre-fills "enabled".
 *
 * Reload disclosure: AGENT_MODE / AGENT_LOOP_MODE / AGENT_INITIAL_PROMPT
 * are wizard-collected today; engine consumption is a Phase 2 concern.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  type LoopMode,
  type ModeSetInput,
  type WizardModeValue,
} from "@shared/schemas/mode.js";
import { type WizardStepId } from "@shared/schemas/wizard.js";
import { Button } from "../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../components/ui/card.js";
import { Input } from "../../../components/ui/input.js";
import { Label } from "../../../components/ui/label.js";
import { useEnvState } from "../../../lib/api/onboarding.js";
import { useModeSet } from "../../../lib/api/mode.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";

export interface ModeStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

interface FormState {
  mode: WizardModeValue;
  initialPrompt: string;
  loopMode: LoopMode;
}

const DEFAULT_FORM: FormState = {
  mode: "chat",
  initialPrompt: "",
  loopMode: "restricted",
};

const LOOP_MODE_LABELS: Record<LoopMode, { label: string; hint: string }> = {
  off: { label: "off", hint: "Wait for explicit user resume after each step." },
  restricted: { label: "restricted", hint: "Auto-resume but pause on risky tools." },
  full: { label: "full", hint: "Auto-resume freely (use with full_autonomous)." },
};

const MODE_CARDS: ReadonlyArray<{
  value: WizardModeValue;
  title: string;
  description: string;
}> = [
  {
    value: "chat",
    title: "Chat",
    description: "Free-form Q&A with tool calls. Model responds turn by turn.",
  },
  {
    value: "mission",
    title: "Mission",
    description: "Goal-oriented run with mission_stop; approvals in restricted mode.",
  },
  {
    value: "full_autonomous",
    title: "Full autonomous",
    description: "Continuous worker driven by loop_defer + wake executor.",
  },
];

function buildPayload(form: FormState): { ok: true; input: ModeSetInput } | { ok: false; message: string } {
  if (form.mode === "chat") {
    return { ok: true, input: { mode: "chat" } };
  }
  if (form.mode === "mission") {
    const trimmed = form.initialPrompt.trim();
    if (trimmed.length < 5) {
      return {
        ok: false,
        message: "Mission goal must be at least 5 characters.",
      };
    }
    return {
      ok: true,
      input: {
        mode: "mission",
        initialPrompt: trimmed,
        loopMode: form.loopMode,
      },
    };
  }
  const trimmed = form.initialPrompt.trim();
  return {
    ok: true,
    input:
      trimmed.length > 0
        ? { mode: "full_autonomous", initialPrompt: trimmed }
        : { mode: "full_autonomous" },
  };
}

export function ModeStep({
  completedSteps,
  onAdvance,
  flowMode,
}: ModeStepProps): JSX.Element {
  const envQuery = useEnvState();
  const modeSet = useModeSet();
  const stepAdvance = useStepAdvance();

  const envOk = envQuery.data?.ok === true ? envQuery.data.data : null;
  const coherent = envOk?.mode.coherent === true;
  const showSkip = coherent && flowMode === "first-pass";

  const [form, setForm] = useState<FormState>(DEFAULT_FORM);
  const [serverError, setServerError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // One-shot prefill: hydrate the form from envState on the FIRST
  // successful read only (codex post-impl YELLOW — without this guard,
  // an envQuery refetch mid-typing would clobber the operator's
  // in-progress mission prompt). Mode + loop mode are restored from
  // .env; the prompt is intentionally never pre-filled so the operator
  // re-enters it deliberately each time the form is shown.
  const hasPrefilledRef = useRef(false);
  useEffect(() => {
    if (!envOk || hasPrefilledRef.current) return;
    hasPrefilledRef.current = true;
    setForm({
      mode: envOk.mode.selected ?? DEFAULT_FORM.mode,
      initialPrompt: "",
      loopMode: envOk.mode.loopMode ?? DEFAULT_FORM.loopMode,
    });
  }, [envOk]);

  const advance = useCallback(async () => {
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "mode",
      forwardNext: "wake",
      onAdvance,
    });
    if (!result.ok) setServerError(result.message);
  }, [stepAdvance, flowMode, completedSteps, onAdvance]);

  const onSubmit = useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setServerError(null);
      setClientError(null);
      const built = buildPayload(form);
      if (!built.ok) {
        setClientError(built.message);
        return;
      }
      const result = await modeSet.mutateAsync(built.input);
      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }
      await advance();
    },
    [form, modeSet, advance],
  );

  if (showSkip && envOk) {
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-mode="skip">
        <CardHeader>
          <CardTitle>Mode already configured</CardTitle>
          <CardDescription>
            Vex will start the next session in <strong>{envOk.mode.selected}</strong>
            {envOk.mode.selected === "mission" && envOk.mode.loopMode
              ? ` (loop: ${envOk.mode.loopMode})`
              : ""}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            To change the mode, edit it from the Review step or run setup
            again from Settings (Phase 2).
          </p>
          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void advance();
              }}
              disabled={stepAdvance.isPending}
            >
              {stepAdvance.isPending ? "Continuing…" : "Continue"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const submitting = modeSet.isPending || stepAdvance.isPending;
  const showPromptField = form.mode === "mission" || form.mode === "full_autonomous";
  const promptRequired = form.mode === "mission";
  const showLoopMode = form.mode === "mission";

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-mode="form">
      <CardHeader>
        <CardTitle>Pick a session mode</CardTitle>
        <CardDescription>
          Sets the default mode for the next session start. You can switch
          later from the chat panel.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(e) => {
            void onSubmit(e);
          }}
          noValidate
          className="flex flex-col gap-5"
        >
          <fieldset className="flex flex-col gap-3" aria-label="Mode">
            {MODE_CARDS.map((card) => (
              <label
                key={card.value}
                className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
                  form.mode === card.value
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <input
                  type="radio"
                  name="vex-mode"
                  value={card.value}
                  checked={form.mode === card.value}
                  onChange={() => setForm({ ...form, mode: card.value })}
                  className="mt-1"
                />
                <span className="flex flex-col">
                  <span className="text-sm font-medium">{card.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {card.description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          {form.mode === "full_autonomous" ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
              Full autonomous requires the wake executor — Vex will turn it
              on at the end of setup if you leave it disabled in the next step.
            </p>
          ) : null}

          {showPromptField ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-mode-prompt">
                {form.mode === "mission" ? "Mission goal" : "Initial prompt (optional)"}
              </Label>
              <textarea
                id="vex-mode-prompt"
                rows={3}
                required={promptRequired}
                value={form.initialPrompt}
                onChange={(e) =>
                  setForm({ ...form, initialPrompt: e.target.value })
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder={
                  form.mode === "mission"
                    ? "What should Vex accomplish? (one sentence or short paragraph)"
                    : "Optional — leave empty to start with an empty session."
                }
              />
              {form.mode === "mission" ? (
                <p className="text-xs text-muted-foreground">
                  Minimum 5 characters. Stored in <code>.env</code>; not
                  rendered in logs.
                </p>
              ) : null}
            </div>
          ) : null}

          {showLoopMode ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="vex-mode-loop">Mission loop mode</Label>
              <select
                id="vex-mode-loop"
                value={form.loopMode}
                onChange={(e) =>
                  setForm({
                    ...form,
                    loopMode: e.target.value as LoopMode,
                  })
                }
                className="rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {(Object.keys(LOOP_MODE_LABELS) as LoopMode[]).map((value) => (
                  <option key={value} value={value}>
                    {LOOP_MODE_LABELS[value].label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {LOOP_MODE_LABELS[form.loopMode].hint}
              </p>
            </div>
          ) : null}

          {clientError ? (
            <p className="text-sm text-destructive" role="alert">
              {clientError}
            </p>
          ) : null}
          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}

          <div className="flex justify-end">
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Saving…"
                : flowMode === "back-edit"
                  ? "Save and return to review"
                  : "Save and continue"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
