/**
 * Engine -> renderer control-state bridge (puzzle 03).
 *
 * Mirror of `transcript-bridge.ts` from puzzle 02: subscribes to the
 * in-process `controlStateBus`, revalidates with the shared
 * `controlStateEventSchema`, broadcasts to all windows.
 *
 * Import discipline (matches the puzzle-02 codex constraint):
 * importing the bus directly from `control-bus.ts` avoids pulling the
 * `lease-and-status` / IPC handler graph into the bridge module at
 * load time. The bridge only needs the bus singleton + the event type.
 */

import { EV } from "@shared/ipc/channels.js";
import { controlStateEventSchema } from "@shared/schemas/runtime.js";
import {
  controlStateBus,
  type ControlStateEvent,
} from "@vex-agent/engine/runtime/control-bus.js";
import { broadcastToAllWindows } from "../lifecycle/broadcast.js";
import { log } from "../logger/index.js";

export function setupControlBridge(): () => void {
  const off = controlStateBus.subscribe((event: ControlStateEvent) => {
    const parsed = controlStateEventSchema.safeParse(event);
    if (!parsed.success) {
      log.warn(
        "[agent:control-bridge] dropped invalid engine.controlState payload",
        { issues: parsed.error.issues },
      );
      return;
    }
    broadcastToAllWindows(EV.engine.controlState, parsed.data);
  });

  return () => {
    off();
  };
}
