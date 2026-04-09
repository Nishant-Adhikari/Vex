import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEnvFieldStatuses, parseDotenvContent, readAppEnvMap } from "../../cli/echo/status.js";

const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "echoclaw-status-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("echo env status helpers", () => {
  it("parses dotenv content with quoted and unquoted values", () => {
    const parsed = parseDotenvContent([
      "ECHO_AGENT_DB_URL=postgres://local",
      'EMBEDDING_MODEL="ai/embeddinggemma:300M-Q8_0"',
      "",
    ].join("\n"));

    expect(parsed.ECHO_AGENT_DB_URL).toBe("postgres://local");
    expect(parsed.EMBEDDING_MODEL).toBe("ai/embeddinggemma:300M-Q8_0");
  });

  it("marks configured and missing env keys for the launcher status view", () => {
    const envDir = createTempDir();
    const envPath = join(envDir, ".env");

    writeFileSync(envPath, [
      "ECHO_AGENT_DB_URL=postgres://local",
      "EMBEDDING_BASE_URL=http://localhost:12434/v1",
      "EMBEDDING_MODEL=ai/embeddinggemma:300M-Q8_0",
      "ECHO_KEYSTORE_PASSWORD=supersecret",
      "JUPITER_API_KEY=test-jupiter-key",
      "TAVILY_API_KEY=test-key",
    ].join("\n"));

    const parsed = readAppEnvMap(envPath);
    const statuses = collectEnvFieldStatuses(envPath);
    const statusByKey = new Map(statuses.map((status) => [status.key, status]));

    expect(parsed.ECHO_AGENT_DB_URL).toBe("postgres://local");
    expect(statusByKey.get("ECHO_AGENT_DB_URL")?.status).toBe("configured");
    expect(statusByKey.get("EMBEDDING_PROVIDER")?.status).toBe("missing");
    expect(statusByKey.get("ECHO_KEYSTORE_PASSWORD")?.status).toBe("configured");
    expect(statusByKey.get("JUPITER_API_KEY")?.status).toBe("configured");
    expect(statusByKey.get("TAVILY_API_KEY")?.status).toBe("configured");
    expect(statusByKey.has("POLYMARKET_API_KEY")).toBe(false);
  });
});
