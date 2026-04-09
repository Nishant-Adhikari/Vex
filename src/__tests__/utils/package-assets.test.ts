import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getEchoAgentMigrationsDir,
  resolveRequiredPath,
} from "@utils/package-assets.js";

describe("utils/package-assets", () => {
  it("returns the first existing candidate path", () => {
    const baseDir = join(tmpdir(), `echoclaw-package-assets-${Date.now()}`);
    const missingDir = join(baseDir, "missing");
    const existingDir = join(baseDir, "existing");

    mkdirSync(existingDir, { recursive: true });

    try {
      expect(resolveRequiredPath("test asset", [missingDir, existingDir])).toBe(existingDir);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it("throws with context when no candidate exists", () => {
    expect(() =>
      resolveRequiredPath("test asset", ["/definitely/missing/one", "/definitely/missing/two"])
    ).toThrow(/Required test asset is missing/);
  });

  it("resolves an existing migrations directory for the current package layout", () => {
    const migrationsDir = getEchoAgentMigrationsDir();

    expect(existsSync(migrationsDir)).toBe(true);
    expect(migrationsDir.endsWith("echo-agent/db/migrations")).toBe(true);
  });
});
