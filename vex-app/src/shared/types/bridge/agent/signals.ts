import type { Result } from "../../../ipc/result.js";
import type {
  SignalGradeInput,
  SignalGradeResult,
  SignalsListTodayInput,
  SignalsListTodayResult,
} from "../../../schemas/signals.js";

/**
 * Signals section (minimal wiring).
 *  - `listToday`: read-only sanitized list of today's ingested TrendRadar
 *    signals (no raw provider jsonb crossing the boundary).
 *  - `grade`: the LLM-as-judge verdict for ONE signal, graded on its own
 *    features. Fail-soft — an inference error surfaces as an error Result and
 *    the panel keeps listing signals ungraded.
 *
 * Deliberately read-only w.r.t. trading: nothing here places a trade or
 * mutates wallet state.
 */
export interface SignalsBridge {
  readonly listToday: (
    input: SignalsListTodayInput,
  ) => Promise<Result<SignalsListTodayResult>>;
  readonly grade: (
    input: SignalGradeInput,
  ) => Promise<Result<SignalGradeResult>>;
}
