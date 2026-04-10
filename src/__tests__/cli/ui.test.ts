import { afterEach, describe, expect, it, vi } from "vitest";

const writeStderr = vi.fn();

vi.mock("../../utils/output.js", () => ({
  isHeadless: () => false,
  writeStderr,
}));

const { renderConnectorDetails } = await import("../../cli/echo/ui.js");

afterEach(() => {
  vi.clearAllMocks();
});

describe("echo connector UI rendering", () => {
  it("prints action-first shell and AI guidance for connector details", () => {
    renderConnectorDetails(
      {
        id: "claude",
        title: "Claude Code",
        description: "Ready Claude connector.",
        clientConfigPath: "Managed by Claude Code.",
        docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
        commandPreview: "claude mcp add-json --scope local echoclaw ...",
        nextSteps: ["Run the generated command."],
        quickstartPrompt: "Use the connected EchoClaw MCP in read-only mode first.\nRead docs://overview.",
        artifacts: [
          {
            fileName: "claude.server.json",
            content: "{}",
            description: "Server definition.",
          },
          {
            fileName: "quickstart.prompt.md",
            content: "Use the connected EchoClaw MCP in read-only mode first.\n",
            description: "Starter text to paste into the AI after the MCP is connected.",
          },
        ],
      },
      "/tmp/connectors",
    );

    const output = writeStderr.mock.calls.map(([line]) => String(line)).join("\n");

    expect(writeStderr).toHaveBeenCalledWith("Order: 1. Run in shell  2. Confirm MCP connected  3. Paste into AI");
    expect(writeStderr).toHaveBeenCalledWith("Run In Shell");
    expect(writeStderr).toHaveBeenCalledWith(
      "Paste this into your shell. You can run it in this same terminal after echoclaw echo exits, or open a second terminal if you prefer.",
    );
    expect(writeStderr).toHaveBeenCalledWith("Paste Into AI");
    expect(writeStderr).toHaveBeenCalledWith(
      "After the MCP is connected, paste this directly into your AI agent chat.",
    );
    expect(output).not.toContain("RUN IN SHELL");
    expect(output).not.toContain("PASTE INTO AI");
    expect(output).toContain("Use the connected EchoClaw MCP in read-only mode first.");
    expect(output).toContain("Read docs://overview.");
    expect(output).not.toContain("| RUN IN SHELL |");
    expect(output).not.toContain("| PASTE INTO AI |");
    expect(output).not.toContain("| Use the connected EchoClaw MCP in read-only mode first.");
    expect(output).not.toContain("+---");
  });
});
