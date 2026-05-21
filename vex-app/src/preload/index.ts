/**
 * Preload bridge — exposes typed `window.vex` API to renderer.
 *
 * Bundled to CommonJS at `dist/preload/index.cjs` (Vite preload config) —
 * sandboxed preload requires CJS per Electron docs.
 *
 * Composer-only file: assembles `shellBridge` (vex-app desktop integration
 * domains) and `agentBridge` (vex-agent runtime integration domains) into
 * a single object and exposes it on `window.vex`. Per-domain implementations
 * live under:
 *
 *   - `preload/shell/*.ts`  — capabilities, system, docker, database, secrets,
 *                              wallet, onboarding, settings, telemetry, support
 *   - `preload/agent/*.ts`  — sessions, chat, messages, runtime, mission,
 *                              approvals, wallets, models, usage
 *   - `preload/_dispatch.ts` — `invokeWithSchema`, `abortableInvoke`,
 *                              `subscribe` (internal helpers, never exposed)
 *
 * Exposes ONLY whitelisted business methods. NEVER `ipcRenderer`, `send`,
 * `invoke`, or raw channel names. Every payload validated:
 *   1. Preload-side Zod schema (catches programmer error early in renderer)
 *   2. Main-side Zod schema in registerHandler (defense-in-depth)
 *
 * Outputs are typed `Result<T, VexError>`. The `satisfies VexBridge` gate
 * on `api` catches any drift between the assembled namespaces and the
 * source-of-truth contract under `shared/types/bridge/`.
 */

import { contextBridge } from "electron";
import type { VexBridge } from "../shared/types/bridge.js";
import { agentBridge } from "./agent/index.js";
import { shellBridge } from "./shell/index.js";

const api = { ...shellBridge, ...agentBridge } satisfies VexBridge;

contextBridge.exposeInMainWorld("vex", api);
