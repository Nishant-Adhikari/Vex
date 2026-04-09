import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGeneratedArtifact, writeConnectorArtifacts } from "../../cli/echo/connectors.js";
import { getMcpCliEntryPath } from "../../cli/echo/package-assets.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "echoclaw-connectors-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("echo connector generation", () => {
  it("writes ready artifacts for all supported AI agent targets", () => {
    const outputDir = createTempDir();
    const generated = writeConnectorArtifacts(outputDir);
    const mcpEntryPath = getMcpCliEntryPath();

    expect(generated.bundles.map((bundle) => bundle.id)).toEqual([
      "cursor",
      "claude",
      "codex",
      "openclaw",
      "default",
    ]);

    expect(existsSync(generated.readmePath)).toBe(true);
    expect(readGeneratedArtifact(join(outputDir, "cursor.mcp.json"))).toContain(`"command": "${process.execPath}"`);
    expect(readGeneratedArtifact(join(outputDir, "cursor.mcp.json"))).toContain(`"${mcpEntryPath}"`);
    expect(readGeneratedArtifact(join(outputDir, "claude.add-json.txt"))).toContain(
      "claude mcp add-json --scope local echoclaw",
    );
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(
      "codex mcp add echoclaw --",
    );
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(process.execPath);
    expect(readGeneratedArtifact(join(outputDir, "codex.add.txt"))).toContain(mcpEntryPath);
    expect(readGeneratedArtifact(join(outputDir, "openclaw.set.txt"))).toContain(
      "openclaw mcp set echoclaw",
    );
    expect(readGeneratedArtifact(join(outputDir, "default-http.txt"))).toContain(
      "http://127.0.0.1:4203/mcp",
    );
  });

  it("builds a connector index readme with all target names", () => {
    const outputDir = createTempDir();
    const generated = writeConnectorArtifacts(outputDir);
    const readme = readFileSync(generated.readmePath, "utf-8");

    expect(readme).toContain("# EchoClaw MCP connectors");
    expect(readme).toContain("## Cursor");
    expect(readme).toContain("## Claude Code");
    expect(readme).toContain("## Codex");
    expect(readme).toContain("## OpenClaw");
    expect(readme).toContain("## Default MCP Client");
  });
});
