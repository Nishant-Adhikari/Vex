import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockGetEchoAgentMigrationsDir = vi.fn();
const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();

vi.mock("@utils/package-assets.js", () => ({
  getEchoAgentMigrationsDir: () => mockGetEchoAgentMigrationsDir(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  getPool: () => ({
    query: (...args: unknown[]) => mockPoolQuery(...args),
    connect: async () => ({
      query: (...args: unknown[]) => mockClientQuery(...args),
      release: mockRelease,
    }),
  }),
}));

vi.mock("@utils/logger.js", () => ({
  default: {
    info: vi.fn(),
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

const { runMigrations } = await import("@echo-agent/db/migrate.js");

let testDir = "";

beforeEach(() => {
  vi.clearAllMocks();
  testDir = mkdtempSync(join(tmpdir(), "echoclaw-migrate-"));
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

describe("echo-agent/db/migrate", () => {
  it("reads migrations from the resolved asset directory", async () => {
    writeFileSync(join(testDir, "001_initial.sql"), "CREATE TABLE demo(id integer);");
    mockGetEchoAgentMigrationsDir.mockReturnValue(testDir);
    mockPoolQuery.mockResolvedValueOnce(undefined).mockResolvedValueOnce({ rows: [{ version: 0 }] });
    mockClientQuery.mockResolvedValue(undefined);

    await runMigrations();

    expect(mockGetEchoAgentMigrationsDir).toHaveBeenCalledTimes(1);
    expect(mockClientQuery).toHaveBeenNthCalledWith(2, "CREATE TABLE demo(id integer);");
    expect(mockRelease).toHaveBeenCalledTimes(1);
  });
});
