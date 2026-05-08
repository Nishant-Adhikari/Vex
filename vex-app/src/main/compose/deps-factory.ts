/**
 * Builds the production `RenderDeps` object for vex-app's main process.
 * Wraps Node's `crypto` for `randomBytes` / `randomUUID` / base64url
 * encoding, and uses Electron `safeStorage` for at-rest encryption.
 *
 * vex-shell builds its own deps factory (POSIX adapters only) — that
 * lives in `local/vex-shell/platform/` once M5 migration lands.
 */

import { app, safeStorage } from "electron";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { CONFIG_DIR } from "../paths/config-dir.js";
import { makeElectronSecretAdapter } from "./electron-secret-adapter.js";
import type {
  CryptoAdapter,
  RandomAdapter,
  RenderDeps,
} from "./render.js";

const randomAdapter: RandomAdapter = {
  uuid: () => randomUUID(),
  randomBytes: (size) => randomBytes(size),
};

const cryptoAdapter: CryptoAdapter = {
  base64url: (input) => Buffer.from(input).toString("base64url"),
};

function getResourcesDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "compose")
    : path.resolve(import.meta.dirname, "../../../resources/compose");
}

export function buildRenderDeps(): RenderDeps {
  return {
    userDataDir: CONFIG_DIR,
    resourcesDir: getResourcesDir(),
    secretAdapter: makeElectronSecretAdapter({ safeStorage }),
    randomAdapter,
    cryptoAdapter,
  };
}
