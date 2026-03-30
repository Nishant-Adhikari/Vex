import { Command } from "commander";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createCliPreAction, maybeStartUpdateCheck, resetUpdateCheckStartedForTests } from "../../cli-auto-update.js";
import * as updaterModule from "../../update/updater.js";

function buildMinimalProgram(
  startUpdateCheck: (currentVersion: string) => void,
  maybeResurrectDaemons = vi.fn(),
) {
  const program = new Command("echoclaw");
  const wallet = new Command("wallet");
  wallet.addCommand(new Command("balance").action(() => {}));

  const update = new Command("update");
  update.addCommand(new Command("status").action(() => {}));

  program.addCommand(wallet);
  program.addCommand(update);
  program.hook("preAction", createCliPreAction(program, "1.2.3", {
    retireLegacyUpdateDaemon: vi.fn(async () => undefined),
    ensureAutoUpdateDefault: vi.fn(),
    startUpdateCheck,
    maybeResurrectDaemons,
  }));

  return { program, maybeResurrectDaemons };
}

async function parse(program: Command, argv: string[]): Promise<void> {
  const originalArgv = process.argv;
  process.argv = ["node", "echoclaw", ...argv];

  try {
    await program.parseAsync(process.argv);
  } finally {
    process.argv = originalArgv;
  }
}

describe.sequential("cli auto-update wiring", () => {
  afterEach(() => {
    resetUpdateCheckStartedForTests();
    vi.restoreAllMocks();
    delete process.env.ECHO_NO_RESURRECT;
  });

  it("starts the background update check for ordinary commands", async () => {
    const startUpdateCheck = vi.fn();
    const maybeResurrectDaemons = vi.fn();
    const { program } = buildMinimalProgram(startUpdateCheck, maybeResurrectDaemons);

    await parse(program, ["wallet", "balance"]);

    expect(startUpdateCheck).toHaveBeenCalledTimes(1);
    expect(startUpdateCheck).toHaveBeenCalledWith("1.2.3");
    expect(maybeResurrectDaemons).toHaveBeenCalledTimes(1);
  });

  it("skips the background update check for the update subtree", async () => {
    const startUpdateCheck = vi.fn();
    const maybeResurrectDaemons = vi.fn();
    const { program } = buildMinimalProgram(startUpdateCheck, maybeResurrectDaemons);

    await parse(program, ["update", "status"]);

    expect(startUpdateCheck).not.toHaveBeenCalled();
    expect(maybeResurrectDaemons).not.toHaveBeenCalled();
  });

  it("deduplicates repeated update-check starts within one process", () => {
    const checkForUpdates = vi.spyOn(updaterModule, "checkForUpdates").mockResolvedValue({
      checked: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      isNewer: false,
      action: "up-to-date",
    });

    maybeStartUpdateCheck("1.2.3");
    maybeStartUpdateCheck("1.2.3");

    expect(checkForUpdates).toHaveBeenCalledTimes(1);
    expect(checkForUpdates).toHaveBeenCalledWith("1.2.3");
  });
});
