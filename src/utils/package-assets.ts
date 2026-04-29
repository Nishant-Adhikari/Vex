import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function getPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function resolveRequiredPath(label: string, candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(`Required ${label} is missing. Looked in: ${candidates.join(", ")}`);
}

function resolvePackageAsset(label: string, relativeCandidates: readonly string[]): string {
  return resolveRequiredPath(
    label,
    relativeCandidates.map((candidate) => join(PACKAGE_ROOT, candidate)),
  );
}

export function getDockerComposeDevPath(): string {
  return resolvePackageAsset("docker/vex-agent/docker-compose.dev.yml", [
    "docker/vex-agent/docker-compose.dev.yml",
  ]);
}

export function getEnvExamplePath(): string {
  return resolvePackageAsset("docker/vex-agent/.env.example", [
    "docker/vex-agent/.env.example",
  ]);
}

export function getVexAgentMigrationsDir(): string {
  return resolvePackageAsset("Vex Agent migrations directory", [
    "dist/vex-agent/db/migrations",
    "src/vex-agent/db/migrations",
  ]);
}

export function getMcpCliEntryPath(): string {
  return resolvePackageAsset("Vex MCP CLI entrypoint", [
    "dist/mcp/index.js",
  ]);
}
