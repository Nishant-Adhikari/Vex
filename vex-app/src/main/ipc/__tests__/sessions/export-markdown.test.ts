/**
 * sessions.exportMarkdown IPC handler.
 *
 * Contract under test: the native save dialog is opened only after the
 * session is resolved; a cancelled dialog never reads history or writes a
 * file; a successful write returns `saved` WITHOUT the chosen path
 * anywhere in the response or in logs; a write failure returns a safe,
 * redacted error (also without the path).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IpcMainInvokeEvent } from "electron";
import { CH } from "@shared/ipc/channels.js";
import { createTestWebContents, createTrustedSender } from "../test-sender.js";

const mocks = vi.hoisted(() => ({
  showSaveDialog: vi.fn(),
  fromWebContents: vi.fn(() => undefined),
  getSessionById: vi.fn(),
  getSessionExportMessages: vi.fn(),
  writeMarkdownAtomically: vi.fn(),
  renderSessionMarkdown: vi.fn(() => "# transcript"),
  defaultFilename: vi.fn(() => "Research-2026-07-12.md"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("electron", () => {
  const handlers = new Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>();
  return {
    ipcMain: {
      handle: vi.fn((channel: string, fn: (e: IpcMainInvokeEvent, p: unknown) => unknown) =>
        handlers.set(channel, fn)),
      removeHandler: vi.fn((ch: string) => handlers.delete(ch)),
    },
    BrowserWindow: { fromWebContents: mocks.fromWebContents },
    dialog: { showSaveDialog: mocks.showSaveDialog },
    __handlers: handlers,
  };
});
vi.mock("../../../database/sessions-db.js", () => ({
  getSessionById: mocks.getSessionById,
  getSessionExportMessages: mocks.getSessionExportMessages,
}));
vi.mock("../../../sessions/markdown-export.js", () => ({
  writeMarkdownAtomically: mocks.writeMarkdownAtomically,
  renderSessionMarkdown: mocks.renderSessionMarkdown,
  defaultSessionMarkdownFilename: mocks.defaultFilename,
}));
vi.mock("../../../logger/index.js", () => ({ log: mocks.log }));

const { registerSessionsExportMarkdownHandler } = await import(
  "../../sessions/export-markdown.js"
);
const electronMock = (await import("electron")) as unknown as {
  __handlers: Map<string, (e: IpcMainInvokeEvent, p: unknown) => unknown>;
};

const SESSION_ID = "00000000-0000-4000-8000-0000000000e1";
const SESSION = {
  id: SESSION_ID,
  mode: "agent",
  permission: "restricted",
  title: "Research",
  initialGoal: null,
  startedAt: "2026-07-12T10:00:00.000Z",
  endedAt: null,
  missionStatus: null,
  pinnedAt: null,
};
const sender = createTrustedSender({ sender: createTestWebContents() });

async function invoke(payload: unknown): Promise<any> {
  const handler = electronMock.__handlers.get(CH.sessions.exportMarkdown);
  if (!handler) throw new Error("No handler for sessions.exportMarkdown");
  return handler(sender as unknown as IpcMainInvokeEvent, {
    requestId: "11111111-1111-4111-8111-111111111111",
    payload,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  electronMock.__handlers.clear();
  registerSessionsExportMarkdownHandler();
  mocks.getSessionById.mockResolvedValue({ ok: true, data: SESSION });
  mocks.getSessionExportMessages.mockResolvedValue({ ok: true, data: [] });
  mocks.writeMarkdownAtomically.mockResolvedValue(undefined);
});

describe("sessions.exportMarkdown IPC", () => {
  it("returns cancelled without reading history or writing a file", async () => {
    mocks.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });

    const result = await invoke({ id: SESSION_ID });
    expect(result).toEqual({ ok: true, data: { outcome: "cancelled" } });
    expect(mocks.getSessionExportMessages).not.toHaveBeenCalled();
    expect(mocks.writeMarkdownAtomically).not.toHaveBeenCalled();
  });

  it("writes the selected file but never returns its path", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/private/transcript.md",
    });

    const result = await invoke({ id: SESSION_ID });
    expect(result).toEqual({ ok: true, data: { outcome: "saved" } });
    expect(JSON.stringify(result)).not.toContain("/private/transcript.md");
    expect(mocks.writeMarkdownAtomically).toHaveBeenCalledWith(
      "/private/transcript.md",
      "# transcript",
    );
  });

  it("rejects malformed renderer input before opening the dialog", async () => {
    const result = await invoke({ id: "not-a-uuid" });
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("validation.invalid_input");
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it("returns 'Session not found' without opening the dialog when the session is missing", async () => {
    mocks.getSessionById.mockResolvedValue({ ok: true, data: null });

    const result = await invoke({ id: SESSION_ID });
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Session not found.");
    expect(mocks.showSaveDialog).not.toHaveBeenCalled();
  });

  it("returns a safe error when the atomic write fails", async () => {
    mocks.showSaveDialog.mockResolvedValue({
      canceled: false,
      filePath: "/private/transcript.md",
    });
    mocks.writeMarkdownAtomically.mockRejectedValue(
      new Error("EACCES /private/transcript.md"),
    );

    const result = await invoke({ id: SESSION_ID });
    expect(result.ok).toBe(false);
    expect(result.error.message).toBe("Unable to save the session transcript.");
    expect(JSON.stringify(result)).not.toContain("/private/transcript.md");
    for (const call of mocks.log.warn.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("/private/transcript.md");
    }
  });
});
