/**
 * Wizard Step 8 — Wake (M11).
 *
 * Toggle + 2 number inputs. When the operator picks full_autonomous in
 * the prior step, this step pre-fills enabled=true and surfaces a note
 * that finalize will enforce wake on if they try to leave it off
 * (`finalize.ts::ensureFullAutonomousWakeCoherent`).
 *
 * Skip-card semantics: `envState.wake.coherent` (codex v3 D13) — both
 * `enabled=false` and `enabled=true with valid range` count as
 * coherent; partial state does not.
 */

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import {
  WAKE_DEFAULT_BATCH_SIZE,
  WAKE_DEFAULT_INTERVAL_MS,
  WAKE_RANGES,
  type WakeSetInput,
} from "@shared/schemas/wake.js";
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
import { useWakeSet } from "../../../lib/api/wake.js";
import {
  useStepAdvance,
  type WizardFlowMode,
} from "../../../lib/api/wizard.js";

export interface WakeStepProps {
  readonly completedSteps: ReadonlyArray<WizardStepId>;
  readonly onAdvance: (next: WizardStepId) => void;
  readonly flowMode: WizardFlowMode;
}

interface FormState {
  enabled: boolean;
  intervalMs: string;
  batchSize: string;
}

function defaultForm(): FormState {
  return {
    enabled: false,
    intervalMs: String(WAKE_DEFAULT_INTERVAL_MS),
    batchSize: String(WAKE_DEFAULT_BATCH_SIZE),
  };
}

function buildPayload(form: FormState): { ok: true; input: WakeSetInput } | { ok: false; message: string } {
  if (!form.enabled) return { ok: true, input: { enabled: false } };
  const intervalMs = Number.parseInt(form.intervalMs, 10);
  const batchSize = Number.parseInt(form.batchSize, 10);
  if (
    !Number.isFinite(intervalMs) ||
    intervalMs < WAKE_RANGES.intervalMin ||
    intervalMs > WAKE_RANGES.intervalMax
  ) {
    return {
      ok: false,
      message: `Wake interval must be an integer between ${WAKE_RANGES.intervalMin} and ${WAKE_RANGES.intervalMax} ms.`,
    };
  }
  if (
    !Number.isFinite(batchSize) ||
    batchSize < WAKE_RANGES.batchMin ||
    batchSize > WAKE_RANGES.batchMax
  ) {
    return {
      ok: false,
      message: `Wake batch size must be an integer between ${WAKE_RANGES.batchMin} and ${WAKE_RANGES.batchMax}.`,
    };
  }
  return { ok: true, input: { enabled: true, intervalMs, batchSize } };
}

export function WakeStep({
  completedSteps,
  onAdvance,
  flowMode,
}: WakeStepProps): JSX.Element {
  const envQuery = useEnvState();
  const wakeSet = useWakeSet();
  const stepAdvance = useStepAdvance();

  const envOk = envQuery.data?.ok === true ? envQuery.data.data : null;
  const coherent = envOk?.wake.coherent === true;
  const showSkip = coherent && flowMode === "first-pass";
  const fullAutonomous = envOk?.mode.selected === "full_autonomous";

  const [form, setForm] = useState<FormState>(defaultForm());
  const [serverError, setServerError] = useState<string | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);

  // One-shot prefill: hydrate the form once, so an envQuery refetch
  // mid-edit cannot clobber the operator's in-progress number inputs
  // (codex post-impl YELLOW). We still react to `fullAutonomous`
  // flipping ON because that is a hard semantic — the toggle becomes
  // disabled with enabled=true forced.
  const hasPrefilledRef = useRef(false);
  useEffect(() => {
    if (!envOk) return;
    if (!hasPrefilledRef.current) {
      hasPrefilledRef.current = true;
      setForm({
        enabled: fullAutonomous ? true : envOk.wake.enabled,
        intervalMs: String(envOk.wake.intervalMs ?? WAKE_DEFAULT_INTERVAL_MS),
        batchSize: String(envOk.wake.batchSize ?? WAKE_DEFAULT_BATCH_SIZE),
      });
      return;
    }
    // After initial prefill: react ONLY to full_autonomous mode-change
    // (force enabled=true). Don't touch the operator's typed intervals.
    if (fullAutonomous) {
      setForm((prev) => (prev.enabled ? prev : { ...prev, enabled: true }));
    }
  }, [envOk, fullAutonomous]);

  const advance = useCallback(async () => {
    const result = await stepAdvance.advance({
      flowMode,
      completedSteps,
      current: "wake",
      forwardNext: "review",
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
      const result = await wakeSet.mutateAsync(built.input);
      if (!result.ok) {
        setServerError(result.error.message);
        return;
      }
      await advance();
    },
    [form, wakeSet, advance],
  );

  if (showSkip && envOk) {
    const detail = envOk.wake.enabled
      ? `enabled · ${envOk.wake.intervalMs} ms · batch ${envOk.wake.batchSize}`
      : "disabled";
    return (
      <Card className="w-full max-w-2xl" data-vex-wizard-wake="skip">
        <CardHeader>
          <CardTitle>Wake executor already configured</CardTitle>
          <CardDescription>
            Current schedule: <strong>{detail}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
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

  const submitting = wakeSet.isPending || stepAdvance.isPending;
  const toggleDisabled = fullAutonomous;

  return (
    <Card className="w-full max-w-2xl" data-vex-wizard-wake="form">
      <CardHeader>
        <CardTitle>Background tasks (wake executor)</CardTitle>
        <CardDescription>
          Lets Vex resume parked sessions when their wake timer fires.
          Recommended for mission and full_autonomous modes.
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
          <label className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3">
            <input
              type="checkbox"
              checked={form.enabled}
              disabled={toggleDisabled}
              onChange={(e) =>
                setForm({ ...form, enabled: e.target.checked })
              }
              className="mt-1"
            />
            <span className="flex flex-col">
              <span className="text-sm font-medium">Enable wake executor</span>
              <span className="text-xs text-muted-foreground">
                {toggleDisabled
                  ? "Auto-enabled by full_autonomous — finalize will enforce this."
                  : "Default off; turn on for mission / full_autonomous workflows."}
              </span>
            </span>
          </label>

          {form.enabled ? (
            <>
              <div className="flex flex-col gap-2">
                <Label htmlFor="vex-wake-interval">Tick interval (ms)</Label>
                <Input
                  id="vex-wake-interval"
                  type="number"
                  min={WAKE_RANGES.intervalMin}
                  max={WAKE_RANGES.intervalMax}
                  step={1}
                  value={form.intervalMs}
                  onChange={(e) =>
                    setForm({ ...form, intervalMs: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Range {WAKE_RANGES.intervalMin}–{WAKE_RANGES.intervalMax}.
                  Default {WAKE_DEFAULT_INTERVAL_MS}.
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="vex-wake-batch">Batch size per tick</Label>
                <Input
                  id="vex-wake-batch"
                  type="number"
                  min={WAKE_RANGES.batchMin}
                  max={WAKE_RANGES.batchMax}
                  step={1}
                  value={form.batchSize}
                  onChange={(e) =>
                    setForm({ ...form, batchSize: e.target.value })
                  }
                />
                <p className="text-xs text-muted-foreground">
                  Range {WAKE_RANGES.batchMin}–{WAKE_RANGES.batchMax}. Default{" "}
                  {WAKE_DEFAULT_BATCH_SIZE}.
                </p>
              </div>
            </>
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
