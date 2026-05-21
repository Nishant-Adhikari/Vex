/**
 * Main-process agent-integration bridges — orchestrator.
 *
 * Each puzzle adds one bridge here (transcript event spine in puzzle 02,
 * runtime control plane in puzzle 03, mission contract in puzzle 04,
 * etc.). `setupAgentBridges` is the single entry point that
 * `register-all.ts` wires into `globalCleanup` so the teardowns flow
 * through the same lifecycle path as IPC handlers.
 */

import { setupTranscriptBridge } from "./transcript-bridge.js";

/**
 * Mount every agent-side bridge and return a single teardown that
 * unsubscribes all of them. Order does not matter — bridges are
 * independent subscribers on disjoint event buses.
 */
export function setupAgentBridges(): () => void {
  const teardowns: Array<() => void> = [];

  teardowns.push(setupTranscriptBridge());

  return () => {
    for (const teardown of teardowns) {
      try {
        teardown();
      } catch {
        // a misbehaving teardown must not poison the others
      }
    }
  };
}
