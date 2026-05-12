/**
 * Bridge between vex-shell (tsx CLI) and the canonical compose render
 * module that lives under vex-app's main process. Both clients share
 * the same template + render logic so a wallet/session created in one
 * is bit-identical to the other (main plan §39-43).
 *
 * vex-shell doesn't have Electron available, so it injects the POSIX
 * secret adapter (no DPAPI / safeStorage) and the standard Node
 * `crypto` random/base64url helpers. The render module's pure-core
 * design (codex turn 4 RED #1) accepts these without dragging Electron
 * deps into the tsx require graph.
 */

import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR } from "../../../src/config/paths.js";
import { posixSecretAdapter } from "../../../vex-app/src/main/compose/posix-secret-adapter.js";
import {
  renderCompose,
  type CryptoAdapter,
  type RandomAdapter,
  type RenderDeps,
  type RenderResult,
} from "../../../vex-app/src/main/compose/render.js";

const VEX_APP_RESOURCES = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../vex-app/resources/compose"
);

const randomAdapter: RandomAdapter = {
  uuid: () => randomUUID(),
  randomBytes: (size) => randomBytes(size),
};

const cryptoAdapter: CryptoAdapter = {
  base64url: (input) => Buffer.from(input).toString("base64url"),
};

export function buildShellRenderDeps(): RenderDeps {
  return {
    userDataDir: CONFIG_DIR,
    resourcesDir: VEX_APP_RESOURCES,
    secretAdapter: posixSecretAdapter,
    randomAdapter,
    cryptoAdapter,
  };
}

export async function renderShellCompose(opts?: {
  pgPort?: number;
}): Promise<RenderResult> {
  const deps = buildShellRenderDeps();
  return renderCompose(deps, opts);
}
