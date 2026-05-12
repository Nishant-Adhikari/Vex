/**
 * Shared mock factory for `useStepAdvance` used by every wizard-step
 * test (M11). Routes the helper's advance call through the provided
 * `setWizardMutate` spy so existing assertions on the wizard-state
 * payload continue to work.
 */

import type { Result } from "@shared/ipc/result.js";

type MutateSpy = (input: {
  currentStepId: string;
  completedSteps: ReadonlyArray<string>;
  completed?: boolean;
}) => Promise<Result<unknown>>;

export interface MockStepAdvanceArgs {
  flowMode: "first-pass" | "back-edit";
  completedSteps: ReadonlyArray<string>;
  current: string;
  forwardNext: string;
  onAdvance: (next: string) => void;
  markCompleted?: boolean;
}

export function makeMockUseStepAdvance(setWizardMutate: MutateSpy) {
  return () => ({
    isPending: false,
    advance: async (
      args: MockStepAdvanceArgs,
    ): Promise<{ ok: true } | { ok: false; message: string }> => {
      if (args.flowMode === "back-edit") {
        args.onAdvance("review");
        return { ok: true };
      }
      const result = await setWizardMutate({
        currentStepId: args.forwardNext,
        completedSteps: args.completedSteps.includes(args.current)
          ? [...args.completedSteps]
          : [...args.completedSteps, args.current],
        ...(args.markCompleted ? { completed: true } : {}),
      });
      if (!result.ok) {
        return { ok: false, message: result.error.message };
      }
      args.onAdvance(args.forwardNext);
      return { ok: true };
    },
  });
}
