import { afterEach, describe, expect, it, vi } from "vitest";
import { ErrorCodes } from "../../errors.js";

const runSetupCli = vi.fn();
const runMcpCli = vi.fn();
const suppressDep0040Warnings = vi.fn();

vi.mock("../../cli/setup/index.js", () => ({
  runSetupCli,
}));

vi.mock("../../cli/shared/warnings.js", () => ({
  suppressDep0040Warnings,
}));

vi.mock("../../mcp/index.js", () => ({
  runMcpCli,
}));

const { buildRootHelpText, runRootCli } = await import("../../cli/index.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("root CLI router", () => {
  it("documents the setup and mcp entrypoints", () => {
    const helpText = buildRootHelpText();

    expect(helpText).toContain("vex <command>");
    expect(helpText).toContain("setup");
    expect(helpText).toContain("mcp");
  });

  it("does not advertise echoclaw as an npm CLI surface", () => {
    const helpText = buildRootHelpText();

    expect(helpText.toLowerCase()).not.toContain("echoclaw");
  });

  it("delegates setup arguments to the setup router", async () => {
    await runRootCli(["setup", "connect"]);
    expect(suppressDep0040Warnings).toHaveBeenCalledTimes(1);
    expect(runSetupCli).toHaveBeenCalledWith(["connect"]);
  });

  it("delegates mcp arguments to the MCP runtime", async () => {
    await runRootCli(["mcp", "--transport", "stdio"]);
    expect(suppressDep0040Warnings).not.toHaveBeenCalled();
    expect(runMcpCli).toHaveBeenCalledWith(["--transport", "stdio"]);
  });

  it("rejects echoclaw as an unknown command", async () => {
    await expect(runRootCli(["echoclaw"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });

  it("rejects unknown root commands with a structured CLI error", async () => {
    await expect(runRootCli(["unknown"])).rejects.toMatchObject({
      code: ErrorCodes.INTERACTIVE_COMMAND_NOT_SUPPORTED,
    });
  });
});
