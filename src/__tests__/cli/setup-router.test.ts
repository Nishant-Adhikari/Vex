import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const runConnectFlow = vi.fn();
const runLauncherMenu = vi.fn();

vi.mock("../../cli/setup/flow.js", () => ({
  runConnectFlow,
  runLauncherMenu,
}));

const { buildSetupHelpText, runSetupCli } = await import("../../cli/setup/index.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("setup CLI router", () => {
  it("documents the direct connect entrypoint", () => {
    expect(buildSetupHelpText()).toContain("vex setup connect");
  });

  it("opens the launcher menu when no subcommand is passed", async () => {
    await runSetupCli();
    expect(runLauncherMenu).toHaveBeenCalledTimes(1);
  });

  it("runs the connect flow directly for the connect subcommand", async () => {
    await runSetupCli(["connect"]);
    expect(runConnectFlow).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown subcommands with a structured CLI error", async () => {
    await expect(runSetupCli(["unknown"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });
});
