import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CONNECTORS_DIR } from "../../config/paths.js";
import { getHttpTokenPath } from "../../mcp/auth/token.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export type ConnectorTarget = "cursor" | "claude" | "codex" | "openclaw" | "default";

export interface ConnectorArtifact {
  fileName: string;
  content: string;
  description: string;
}

export interface ConnectorBundle {
  id: ConnectorTarget;
  title: string;
  description: string;
  docsUrl?: string;
  clientConfigPath: string;
  commandPreview?: string;
  nextSteps: string[];
  artifacts: ConnectorArtifact[];
}

const MCP_SERVER_NAME = "echoclaw";
const STDIO_COMMAND = "echoclaw-mcp";

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function buildRootMcpConfig(): { mcpServers: Record<string, { command: string; args?: string[] }> } {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        command: STDIO_COMMAND,
      },
    },
  };
}

function buildClaudeServerConfig(): { type: "stdio"; command: string; args: string[]; env: Record<string, string> } {
  return {
    type: "stdio",
    command: STDIO_COMMAND,
    args: [],
    env: {},
  };
}

function buildOpenClawServerConfig(): { command: string; args: string[] } {
  return {
    command: STDIO_COMMAND,
    args: [],
  };
}

function buildConnectorBundles(baseDir: string = CONNECTORS_DIR): ConnectorBundle[] {
  const cursorPath = join(baseDir, "cursor.mcp.json");
  const claudeServerPath = join(baseDir, "claude.server.json");
  const claudeCommandPath = join(baseDir, "claude.add-json.txt");
  const codexCommandPath = join(baseDir, "codex.add.txt");
  const openClawServerPath = join(baseDir, "openclaw.server.json");
  const openClawCommandPath = join(baseDir, "openclaw.set.txt");
  const defaultPath = join(baseDir, "default.mcp.json");
  const defaultHttpPath = join(baseDir, "default-http.txt");
  const tokenPath = getHttpTokenPath();

  const cursorConfig = stableJson(buildRootMcpConfig());
  const claudeServerConfig = stableJson(buildClaudeServerConfig());
  const openClawServerConfig = stableJson(buildOpenClawServerConfig());
  const defaultConfig = stableJson(buildRootMcpConfig());

  const claudeCommand =
    `claude mcp add-json --scope local ${MCP_SERVER_NAME} "$(cat ${shellQuote(claudeServerPath)})"\n`;
  const codexCommand = `codex mcp add ${MCP_SERVER_NAME} -- ${STDIO_COMMAND}\n`;
  const openClawCommand =
    `openclaw mcp set ${MCP_SERVER_NAME} "$(cat ${shellQuote(openClawServerPath)})"\n`;
  const defaultHttpNotes =
    `HTTP endpoint: http://127.0.0.1:4203/mcp\n` +
    `Bearer token file: ${tokenPath}\n` +
    `Use this only with clients that explicitly support streamable HTTP MCP.\n`;

  return [
    {
      id: "cursor",
      title: "Cursor",
      description:
        "Ready stdio MCP config for Cursor. Merge or copy this file into .cursor/mcp.json or ~/.cursor/mcp.json.",
      docsUrl: "https://docs.cursor.com/en/context/mcp",
      clientConfigPath: ".cursor/mcp.json or ~/.cursor/mcp.json",
      nextSteps: [
        "Open Cursor MCP settings or place the generated file in your preferred Cursor MCP config path.",
        "Reload Cursor after saving the config so the new server is picked up.",
      ],
      artifacts: [
        {
          fileName: "cursor.mcp.json",
          content: cursorConfig,
          description: "Project/global Cursor MCP config snippet.",
        },
      ],
    },
    {
      id: "claude",
      title: "Claude Code",
      description:
        "Ready Claude Code connector for local stdio MCP. Uses the Claude CLI add-json flow with a generated server definition.",
      docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
      clientConfigPath: "Managed by Claude Code local scope via `claude mcp add-json --scope local`.",
      commandPreview: claudeCommand.trim(),
      nextSteps: [
        "Run the generated command from your shell.",
        "Use `claude mcp list` to verify EchoClaw was registered.",
      ],
      artifacts: [
        {
          fileName: "claude.server.json",
          content: claudeServerConfig,
          description: "Server definition consumed by `claude mcp add-json`.",
        },
        {
          fileName: "claude.add-json.txt",
          content: claudeCommand,
          description: "Exact Claude Code command to register EchoClaw locally.",
        },
      ],
    },
    {
      id: "codex",
      title: "Codex",
      description:
        "Ready Codex CLI connector verified against the local `codex mcp add` command contract for stdio MCP servers.",
      clientConfigPath: "~/.codex/config.toml (managed by `codex mcp add`).",
      commandPreview: codexCommand.trim(),
      nextSteps: [
        "Run the generated `codex mcp add` command from your shell.",
        "Use `codex mcp list` to confirm that EchoClaw is configured.",
      ],
      artifacts: [
        {
          fileName: "codex.add.txt",
          content: codexCommand,
          description: "Exact Codex CLI command to register EchoClaw.",
        },
      ],
    },
    {
      id: "openclaw",
      title: "OpenClaw",
      description:
        "Ready OpenClaw connector for the client-side MCP registry. This uses the `openclaw mcp set` flow, not `openclaw mcp serve`.",
      docsUrl: "https://docs.openclaw.ai/cli/mcp",
      clientConfigPath: "Managed by OpenClaw via `openclaw mcp set`.",
      commandPreview: openClawCommand.trim(),
      nextSteps: [
        "Run the generated `openclaw mcp set` command from your shell.",
        "Verify the server in your OpenClaw MCP registry before starting a session.",
      ],
      artifacts: [
        {
          fileName: "openclaw.server.json",
          content: openClawServerConfig,
          description: "Server definition consumed by `openclaw mcp set`.",
        },
        {
          fileName: "openclaw.set.txt",
          content: openClawCommand,
          description: "Exact OpenClaw command to register EchoClaw.",
        },
      ],
    },
    {
      id: "default",
      title: "Default MCP Client",
      description:
        "Generic stdio MCP config for clients that accept the common `mcpServers` JSON shape. Includes advanced HTTP notes for clients that need streamable HTTP.",
      clientConfigPath: "Client-specific MCP config file or settings screen.",
      nextSteps: [
        "Use the generated stdio JSON as the default connector for generic MCP clients.",
        "Use the HTTP notes only if your client explicitly supports streamable HTTP MCP.",
      ],
      artifacts: [
        {
          fileName: "default.mcp.json",
          content: defaultConfig,
          description: "Generic stdio MCP config using the common `mcpServers` shape.",
        },
        {
          fileName: "default-http.txt",
          content: defaultHttpNotes,
          description: "Advanced HTTP endpoint and bearer token details.",
        },
      ],
    },
  ];
}

function writeTextFileAtomic(path: string, content: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const tmpPath = `${path}.tmp.${Date.now()}`;
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, path);

  try {
    chmodSync(path, 0o644);
  } catch {
    // Non-fatal on platforms without POSIX permissions.
  }
}

function buildConnectorReadme(bundles: readonly ConnectorBundle[]): string {
  const lines: string[] = [
    "# EchoClaw MCP connectors",
    "",
    `Generated for local MCP setup. Server command: \`${STDIO_COMMAND}\`.`,
    "",
  ];

  for (const bundle of bundles) {
    lines.push(`## ${bundle.title}`);
    lines.push("");
    lines.push(bundle.description);
    lines.push("");
    lines.push(`Client config target: ${bundle.clientConfigPath}`);
    if (bundle.docsUrl) {
      lines.push(`Docs: ${bundle.docsUrl}`);
    }
    if (bundle.commandPreview) {
      lines.push("");
      lines.push("Command:");
      lines.push("```bash");
      lines.push(bundle.commandPreview);
      lines.push("```");
    }
    lines.push("");
    lines.push("Artifacts:");
    for (const artifact of bundle.artifacts) {
      lines.push(`- ${artifact.fileName} — ${artifact.description}`);
    }
    lines.push("");
  }

  return lines.join("\n") + "\n";
}

export interface GeneratedConnectorOutput {
  directory: string;
  bundles: ConnectorBundle[];
  readmePath: string;
}

export function writeConnectorArtifacts(baseDir: string = CONNECTORS_DIR): GeneratedConnectorOutput {
  const bundles = buildConnectorBundles(baseDir);

  try {
    mkdirSync(baseDir, { recursive: true });

    for (const bundle of bundles) {
      for (const artifact of bundle.artifacts) {
        writeTextFileAtomic(join(baseDir, artifact.fileName), artifact.content);
      }
    }

    const readmePath = join(baseDir, "README.md");
    writeTextFileAtomic(readmePath, buildConnectorReadme(bundles));

    return { directory: baseDir, bundles, readmePath };
  } catch (err) {
    throw new EchoError(
      ErrorCodes.CONNECTOR_WRITE_FAILED,
      err instanceof Error ? err.message : String(err),
      "Check permissions for the EchoClaw config directory.",
    );
  }
}

export function readGeneratedArtifact(path: string): string {
  return readFileSync(path, "utf-8");
}
