/**
 * Local services helpers — start / stop the docker compose stack the agent
 * needs (Postgres + embeddings proxy) without leaving the shell. These helpers
 * never write directly to stderr because Ink owns the terminal frame.
 *
 * As of M5 (2026-05-08), services.ts renders the canonical compose template
 * via `compose-bridge.ts` instead of pointing at the (deleted)
 * `docker/vex-agent/docker-compose.dev.yml`. The render gives every
 * install a per-install project name + generated pg_password, matching
 * what vex-app does in main process.
 */

import { spawnSync } from "node:child_process";
import { renderShellCompose } from "./compose-bridge.js";
import { servicesLog } from "./log.js";

export interface ServicesActionResult {
  ok: boolean;
  message: string;
  detail?: string;
}

export async function startServices(): Promise<ServicesActionResult> {
  const startedAt = Date.now();
  const rendered = await renderShellCompose();
  servicesLog.info("services.start.begin", {
    composeFile: rendered.outPath,
    installId: rendered.installId,
  });
  const project = `vex-${rendered.installId}`;
  const result = spawnSync(
    "docker",
    ["compose", "-f", rendered.outPath, "-p", project, "up", "-d"],
    { encoding: "utf-8" }
  );

  if (!result.error && result.status === 0) {
    const durationMs = Date.now() - startedAt;
    servicesLog.info("services.start.completed", { durationMs });
    return { ok: true, message: `Local services started (${durationMs}ms).` };
  }

  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const message =
    result.error?.message ?? `docker compose up failed (status ${result.status})`;
  servicesLog.error("services.start.failed", { error: message, detail });
  return {
    ok: false,
    message: `Failed to start services: ${message}`,
    detail: detail || undefined,
  };
}

export async function stopServices(): Promise<ServicesActionResult> {
  const rendered = await renderShellCompose();
  servicesLog.info("services.stop.begin", {
    composeFile: rendered.outPath,
    installId: rendered.installId,
  });
  const project = `vex-${rendered.installId}`;
  // Use `stop` (not `down --volumes`) per skill §10 — preserves DB content.
  const result = spawnSync(
    "docker",
    ["compose", "-f", rendered.outPath, "-p", project, "stop"],
    { encoding: "utf-8" }
  );

  if (!result.error && result.status === 0) {
    servicesLog.info("services.stop.completed");
    return { ok: true, message: "Local services stopped." };
  }

  const detail = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  const message =
    result.error?.message ?? `docker compose stop failed (status ${result.status})`;
  servicesLog.error("services.stop.failed", { error: message, detail });
  return {
    ok: false,
    message: `Failed to stop services: ${message}`,
    detail: detail || undefined,
  };
}
