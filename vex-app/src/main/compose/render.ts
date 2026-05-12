/**
 * Pure compose render core (codex turn 4 RED #1). NO Electron imports
 * here — vex-shell tsx CLI must be able to consume this module to keep
 * the two clients on a single rendered template (main plan §39-43).
 *
 * Dependencies are injected via `RenderDeps` so:
 *   - vex-app main process passes `electronSecretAdapter` (DPAPI-backed
 *     on Windows, plain mode-0o600 on POSIX)
 *   - vex-shell passes `posixSecretAdapter` (POSIX file with mode 0o600)
 *   - tests pass deterministic adapters that capture writes in-memory
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { DEFAULT_EMBED_PORT } from "../onboarding/embedding-defaults.js";

export interface SecretAdapter {
  /** Returns the absolute path that compose should mount via `secrets:`. */
  readonly write: (
    targetPath: string,
    value: string
  ) => Promise<{ composePath: string }>;
  /** Reads back the (decrypted, if applicable) secret value. */
  readonly read: (targetPath: string) => Promise<string | null>;
  /** Best-effort cleanup of any transient/decrypted artifacts. */
  readonly cleanup: () => Promise<void>;
  /**
   * Boot-time cleanup of stale transient artifacts. The host can pass a
   * predicate that returns `true` if the corresponding compose project
   * is *running*; if not, the transient is removed.
   */
  readonly bootCleanup: (
    isProjectActive: () => Promise<boolean>
  ) => Promise<void>;
}

export interface RandomAdapter {
  readonly uuid: () => string;
  readonly randomBytes: (size: number) => Uint8Array;
}

export interface CryptoAdapter {
  readonly base64url: (input: Uint8Array) => string;
}

export interface RenderDeps {
  readonly userDataDir: string;
  readonly resourcesDir: string;
  readonly secretAdapter: SecretAdapter;
  readonly randomAdapter: RandomAdapter;
  readonly cryptoAdapter: CryptoAdapter;
}

export interface RenderOptions {
  readonly pgPort?: number;
  readonly embedPort?: number;
}

export interface RenderResult {
  readonly outPath: string;
  readonly installId: string;
  readonly pgPasswordComposePath: string;
  /**
   * Port the compose template will publish for the embeddings runtime
   * on the loopback interface. Forwarded to `ensureEmbeddingDefaults`
   * and host-side health probes so we never disagree on the URL.
   */
  readonly embedPort: number;
}

const TEMPLATE_NAME = "docker-compose.template.yml";
const COMPOSE_OUT_DIR_NAME = "compose";
const COMPOSE_OUT_FILE_NAME = "docker-compose.yml";
const INSTALL_ID_FILE_NAME = ".install-id";
const SECRETS_DIR_NAME = path.join("local-infra", "secrets");
const PG_PASSWORD_FILE_NAME = "pg_password";

const DEFAULT_PG_PORT = 55432;

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads or generates the install id. Once written, it is immutable for
 * the lifetime of this `userDataDir` so per-install resource names
 * (volumes, secrets, compose project) stay stable across launches.
 */
export async function getInstallId(deps: RenderDeps): Promise<string> {
  const target = path.join(deps.userDataDir, INSTALL_ID_FILE_NAME);
  if (await fileExists(target)) {
    const existing = (await fs.readFile(target, "utf8")).trim();
    if (existing.length > 0) return existing;
  }
  await fs.mkdir(deps.userDataDir, { recursive: true });
  const id = deps.randomAdapter.uuid();
  await fs.writeFile(target, id, { encoding: "utf8" });
  return id;
}

export async function getPgPassword(
  deps: RenderDeps
): Promise<{ composePath: string }> {
  const targetDir = path.join(deps.userDataDir, SECRETS_DIR_NAME);
  const targetPath = path.join(targetDir, PG_PASSWORD_FILE_NAME);

  const existing = await deps.secretAdapter.read(targetPath);
  if (existing !== null && existing.length > 0) {
    // Re-write so the secret adapter has a fresh transient file (the
    // previous transient may have been cleaned up by `bootCleanup`).
    return deps.secretAdapter.write(targetPath, existing);
  }

  const password = deps.cryptoAdapter.base64url(
    deps.randomAdapter.randomBytes(32)
  );
  return deps.secretAdapter.write(targetPath, password);
}

export async function renderCompose(
  deps: RenderDeps,
  options: RenderOptions = {}
): Promise<RenderResult> {
  const installId = await getInstallId(deps);
  const pgPassword = await getPgPassword(deps);

  const templatePath = path.join(deps.resourcesDir, TEMPLATE_NAME);
  const template = await fs.readFile(templatePath, "utf8");

  const pgPort = options.pgPort ?? DEFAULT_PG_PORT;
  const embedPort = options.embedPort ?? DEFAULT_EMBED_PORT;
  const rendered = template
    .replaceAll("${VEX_INSTALL_ID}", installId)
    .replaceAll("${VEX_PG_PASSWORD_FILE}", pgPassword.composePath)
    .replaceAll(`\${VEX_PG_PORT:-${DEFAULT_PG_PORT}}`, String(pgPort))
    .replaceAll(
      `\${VEX_EMBED_PORT:-${DEFAULT_EMBED_PORT}}`,
      String(embedPort)
    );

  const outDir = path.join(deps.userDataDir, COMPOSE_OUT_DIR_NAME);
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, COMPOSE_OUT_FILE_NAME);

  // Atomic write — temp + rename so a crash mid-write never leaves
  // compose with an unparseable file.
  const tempPath = `${outPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tempPath, rendered, "utf8");
  await fs.rename(tempPath, outPath);

  return {
    outPath,
    installId,
    pgPasswordComposePath: pgPassword.composePath,
    embedPort,
  };
}
