import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectEnvFieldStatuses, parseDotenvContent, readAppEnvMap } from "../../cli/setup/status.js";

const tempDirs: string[] = [];
const secretEnvKeys = ["VEX_KEYSTORE_PASSWORD", "JUPITER_API_KEY", "TAVILY_API_KEY"] as const;
const originalSecretEnv = new Map<string, string | undefined>();

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "vex-status-"));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalSecretEnv.clear();
  for (const key of secretEnvKeys) {
    originalSecretEnv.set(key, process.env[key]);
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of secretEnvKeys) {
    const originalValue = originalSecretEnv.get(key);
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("setup env status helpers", () => {
  it("parses dotenv content with quoted and unquoted values", () => {
    const parsed = parseDotenvContent([
      "VEX_DB_URL=postgres://local",
      'EMBEDDING_MODEL="ai/embeddinggemma:300M-Q8_0"',
      "",
    ].join("\n"));

    expect(parsed.VEX_DB_URL).toBe("postgres://local");
    expect(parsed.EMBEDDING_MODEL).toBe("ai/embeddinggemma:300M-Q8_0");
  });

  it("marks configured and missing env keys for the launcher status view", () => {
    const envDir = createTempDir();
    const envPath = join(envDir, ".env");

    writeFileSync(envPath, [
      "VEX_DB_URL=postgres://local",
      "EMBEDDING_BASE_URL=http://localhost:12434/v1",
      "EMBEDDING_MODEL=ai/embeddinggemma:300M-Q8_0",
      "VEX_KEYSTORE_PASSWORD=legacy-ignored",
      "JUPITER_API_KEY=legacy-ignored",
      "TAVILY_API_KEY=legacy-ignored",
    ].join("\n"));

    process.env.VEX_KEYSTORE_PASSWORD = "supersecret";
    process.env.JUPITER_API_KEY = "test-jupiter-key";
    process.env.TAVILY_API_KEY = "test-key";

    const parsed = readAppEnvMap(envPath);
    const statuses = collectEnvFieldStatuses(envPath);
    const statusByKey = new Map(statuses.map((status) => [status.key, status]));

    expect(parsed.VEX_DB_URL).toBe("postgres://local");
    expect(parsed.VEX_KEYSTORE_PASSWORD).toBe("supersecret");
    expect(parsed.JUPITER_API_KEY).toBe("test-jupiter-key");
    expect(parsed.TAVILY_API_KEY).toBe("test-key");
    expect(statusByKey.get("VEX_DB_URL")?.status).toBe("configured");
    expect(statusByKey.get("EMBEDDING_PROVIDER")?.status).toBe("missing");
    expect(statusByKey.get("VEX_KEYSTORE_PASSWORD")?.status).toBe("configured");
    expect(statusByKey.get("JUPITER_API_KEY")?.status).toBe("configured");
    expect(statusByKey.get("TAVILY_API_KEY")?.status).toBe("configured");
    expect(statusByKey.has("POLYMARKET_API_KEY")).toBe(false);
  });
});
