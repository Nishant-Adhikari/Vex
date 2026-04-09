import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const runConnectFlow = vi.fn();
const runLauncherMenu = vi.fn();

vi.mock("../../cli/echo/flow.js", () => ({
  runConnectFlow,
  runLauncherMenu,
}));

const { buildEchoHelpText, runEchoCli } = await import("../../cli/echo/index.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("echo CLI router", () => {
  it("documents the direct connect entrypoint", () => {
    expect(buildEchoHelpText()).toContain("echoclaw echo connect");
  });

  it("opens the launcher menu when no subcommand is passed", async () => {
    await runEchoCli();
    expect(runLauncherMenu).toHaveBeenCalledTimes(1);
  });

  it("runs the connect flow directly for the connect subcommand", async () => {
    await runEchoCli(["connect"]);
    expect(runConnectFlow).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown subcommands with a structured CLI error", async () => {
    await expect(runEchoCli(["unknown"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });
});
