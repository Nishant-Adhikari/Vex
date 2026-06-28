/**
 * vex.updater.* — user-triggered in-app update IPC surface (M13).
 *
 * All six handlers route through `registerHandler` (sender validation + strict
 * empty input envelope + output Zod validation + redacted Result). The actual
 * `electron-updater` work lives in `../updates/updateActions.ts`; this module
 * is the thin boundary that maps channels -> actions with the request's
 * correlation id.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  releaseNotesOpenedSchema,
  updateCancelledSchema,
  updateRestartingSchema,
  updateStartedSchema,
  updateStatusSchema,
  type ReleaseNotesOpened,
  type UpdateCancelled,
  type UpdateRestarting,
  type UpdateStarted,
  type UpdateStatus,
} from "@shared/schemas/updater.js";
import {
  cancelDownload,
  checkNow,
  getStatus,
  openReleaseNotes,
  restartAndInstallNow,
  startUpdateNow,
} from "../updates/updateActions.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

export function registerUpdaterHandlers(): Array<() => void> {
  const teardowns: Array<() => void> = [];

  teardowns.push(
    registerHandler({
      channel: CH.updater.getStatus,
      domain: "updater",
      inputSchema: empty,
      outputSchema: updateStatusSchema,
      handle: (): Promise<Result<UpdateStatus>> => getStatus(),
    }),
  );

  teardowns.push(
    registerHandler({
      channel: CH.updater.check,
      domain: "updater",
      inputSchema: empty,
      outputSchema: updateStatusSchema,
      handle: (_input, ctx): Promise<Result<UpdateStatus>> =>
        checkNow(ctx.requestId),
    }),
  );

  teardowns.push(
    registerHandler({
      channel: CH.updater.startUpdateNow,
      domain: "updater",
      inputSchema: empty,
      outputSchema: updateStartedSchema,
      handle: (_input, ctx): Promise<Result<UpdateStarted>> =>
        startUpdateNow(ctx.requestId),
    }),
  );

  teardowns.push(
    registerHandler({
      channel: CH.updater.cancelDownload,
      domain: "updater",
      inputSchema: empty,
      outputSchema: updateCancelledSchema,
      handle: (): Promise<Result<UpdateCancelled>> => cancelDownload(),
    }),
  );

  teardowns.push(
    registerHandler({
      channel: CH.updater.restartAndInstallNow,
      domain: "updater",
      inputSchema: empty,
      outputSchema: updateRestartingSchema,
      handle: (_input, ctx): Promise<Result<UpdateRestarting>> =>
        restartAndInstallNow(ctx.requestId),
    }),
  );

  teardowns.push(
    registerHandler({
      channel: CH.updater.openReleaseNotes,
      domain: "updater",
      inputSchema: empty,
      outputSchema: releaseNotesOpenedSchema,
      handle: (_input, ctx): Promise<Result<ReleaseNotesOpened>> =>
        openReleaseNotes(ctx.requestId),
    }),
  );

  return teardowns;
}
