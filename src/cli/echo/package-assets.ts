import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function getPackageRoot(): string {
  return PACKAGE_ROOT;
}

export function getDockerComposeDevPath(): string {
  return join(PACKAGE_ROOT, "docker", "echo-agent", "docker-compose.dev.yml");
}

export function getEnvExamplePath(): string {
  return join(PACKAGE_ROOT, "docker", "echo-agent", ".env.example");
}
