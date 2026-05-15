/**
 * Shared types for the BootstrapPanel state machine.
 *
 * `Branch` enumerates the rendered states (loading, ready, daemon-stopped,
 * needs-desktop-install, needs-linux-install, failure). `ManualFetchState`
 * tracks the lifecycle of the auto-fetched Linux manual install
 * instructions; the renderer owns this state because the underlying
 * `useDockerInstall()` mutation is shared with the real `desktop_download`
 * install flow and would otherwise conflate progress visibility.
 */

export type Branch =
  | "loading"
  | "A"
  | "B"
  | "C-desktop"
  | "C-linux"
  | "D";

export type ActiveInstallMethod =
  | "desktop_download"
  | "linux_manual_instructions"
  | null;

export type ManualFetchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready"; instructions: string }
  | { kind: "error"; message: string };
