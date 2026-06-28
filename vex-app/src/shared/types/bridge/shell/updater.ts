import type { Result } from "../../../ipc/result.js";
import type {
  ReleaseNotesOpened,
  UpdateCancelled,
  UpdateRestarting,
  UpdateStarted,
  UpdateStatus,
} from "../../../schemas/updater.js";

/**
 * `vex.updater.*` — user-triggered in-app update surface (M13).
 *
 * Business methods only (skill `vex-user-triggered-updates` §"IPC contract").
 * The renderer never imports `electron-updater`/`electron` and never calls an
 * updater API directly — it asks main through these typed methods, and main
 * decides whether an action is safe. `startUpdateNow` is the ONLY route that
 * may begin a download; `quitAndInstall` happens only after the download
 * completes AND a safe-restart gate passes (both enforced in main).
 */
export interface UpdaterBridge {
  /** Last-known status from main's cache (no network call). */
  readonly getStatus: () => Promise<Result<UpdateStatus>>;
  /** Trigger a check against the update feed; resolves to the new status. */
  readonly checkNow: () => Promise<Result<UpdateStatus>>;
  /** User clicked "Update now" — the only path that may start a download. */
  readonly startUpdateNow: () => Promise<Result<UpdateStarted>>;
  /** Cancel an in-flight download (allowed only while still safe). */
  readonly cancelDownload: () => Promise<Result<UpdateCancelled>>;
  /** Step 2: user explicitly restarts to install the already-downloaded update. */
  readonly restartAndInstallNow: () => Promise<Result<UpdateRestarting>>;
  /** Open the external release-notes page in the user's browser. */
  readonly openReleaseNotes: () => Promise<Result<ReleaseNotesOpened>>;
  /**
   * Subscribe to main-pushed status transitions. Returns an idempotent
   * unsubscribe — call it from the React effect cleanup (skill §11). The
   * renderer never sees the raw IPC channel.
   */
  readonly onStatus: (cb: (status: UpdateStatus) => void) => () => void;
}
