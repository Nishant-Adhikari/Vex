import { existsSync, readFileSync } from "node:fs";
import { Command } from "commander";
import { printLogo } from "./utils/ui.js";
import { setJsonMode } from "./utils/output.js";
import { checkForUpdates } from "./update/updater.js";
import { ensureAutoUpdateDefault } from "./update/auto-update-preference.js";
import { runAutoUpdateBootstrap } from "./update/cli-bootstrap.js";
import { retireLegacyUpdateDaemon } from "./update/legacy-runtime.js";
import { maybeResurrectDaemons } from "./utils/daemon-resurrect.js";
import { spawnMonitorFromState, spawnBotDaemon } from "./utils/daemon-spawn.js";
import { ZG_MONITOR_PID_FILE, ZG_MONITOR_STATE_FILE, ZG_MONITOR_STOPPED_FILE } from "./tools/0g-compute/constants.js";
import { BOT_PID_FILE, BOT_ORDERS_FILE, BOT_STOPPED_FILE } from "./config/paths.js";

let updateCheckStarted = false;

export function resetUpdateCheckStartedForTests(): void {
  updateCheckStarted = false;
}

export function maybeStartUpdateCheck(currentVersion: string): void {
  if (updateCheckStarted) return;
  updateCheckStarted = true;
  void checkForUpdates(currentVersion);
}

export interface CliPreActionDependencies {
  retireLegacyUpdateDaemon: typeof retireLegacyUpdateDaemon;
  ensureAutoUpdateDefault: typeof ensureAutoUpdateDefault;
  startUpdateCheck: (currentVersion: string) => void;
  maybeResurrectDaemons: typeof maybeResurrectDaemons;
}

const defaultCliPreActionDependencies: CliPreActionDependencies = {
  retireLegacyUpdateDaemon,
  ensureAutoUpdateDefault,
  startUpdateCheck: maybeStartUpdateCheck,
  maybeResurrectDaemons,
};

export function createCliPreAction(
  program: Command,
  currentVersion: string,
  dependencies: CliPreActionDependencies = defaultCliPreActionDependencies,
): (thisCommand: Command, actionCommand: Command) => Promise<void> {
  return async (thisCommand, actionCommand) => {
    const opts = program.opts();
    if (opts.json) {
      setJsonMode(true);
    }
    if (!opts.json && (process.argv.includes("--help") || process.argv.includes("-h") || process.argv.length <= 2)) {
      printLogo();
    }

    const ranAutoUpdateBootstrap = await runAutoUpdateBootstrap({
      thisCommand,
      actionCommand,
      retireLegacyUpdateDaemon: dependencies.retireLegacyUpdateDaemon,
      ensureAutoUpdateDefault: dependencies.ensureAutoUpdateDefault,
      startUpdateCheck: () => dependencies.startUpdateCheck(currentVersion),
    });

    if (process.env.ECHO_NO_RESURRECT !== "1" && ranAutoUpdateBootstrap) {
      dependencies.maybeResurrectDaemons([
        {
          name: "BalanceMonitor",
          pidFile: ZG_MONITOR_PID_FILE,
          shouldBeRunning: () => {
            if (existsSync(ZG_MONITOR_STOPPED_FILE)) return false;
            return existsSync(ZG_MONITOR_STATE_FILE);
          },
          resurrect: () => spawnMonitorFromState(),
        },
        {
          name: "MarketMaker",
          pidFile: BOT_PID_FILE,
          shouldBeRunning: () => {
            if (existsSync(BOT_STOPPED_FILE)) return false;
            if (!existsSync(BOT_ORDERS_FILE)) return false;
            try {
              const data = JSON.parse(readFileSync(BOT_ORDERS_FILE, "utf-8"));
              return Array.isArray(data.orders) && data.orders.some((o: any) => o.state === "armed");
            } catch {
              return false;
            }
          },
          resurrect: () => spawnBotDaemon(),
        },
      ]);
    }
  };
}
