import { CH } from "../../shared/ipc/channels.js";
import {
  signalGradeInputSchema,
  signalsListTodayInputSchema,
} from "../../shared/schemas/signals.js";
import type {
  SignalGradeInput,
  SignalsListTodayInput,
} from "../../shared/schemas/signals.js";
import type { SignalsBridge } from "../../shared/types/bridge/agent/signals.js";
import { invokeWithSchema } from "../_dispatch.js";

export const signals = {
  listToday(input: SignalsListTodayInput) {
    return invokeWithSchema(
      CH.signals.listToday,
      input,
      signalsListTodayInputSchema,
    );
  },
  grade(input: SignalGradeInput) {
    return invokeWithSchema(CH.signals.grade, input, signalGradeInputSchema);
  },
} satisfies SignalsBridge;
