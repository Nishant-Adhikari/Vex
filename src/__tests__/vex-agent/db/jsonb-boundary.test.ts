import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

function listTypeScriptFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listTypeScriptFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("DB JSONB boundary", () => {
  it("keeps JSONB serialization centralized in db/params", () => {
    const reposDir = join(process.cwd(), "src/vex-agent/db/repos");
    const offenders = listTypeScriptFiles(reposDir).flatMap((file) => {
      const rel = relative(process.cwd(), file);
      return readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, index) => line.includes("JSON.stringify(") ? [`${rel}:${index + 1}`] : []);
    });

    expect(offenders).toEqual([]);
  });
});
