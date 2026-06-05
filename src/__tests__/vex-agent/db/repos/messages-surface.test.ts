/**
 * Façade-surface guard for the messages repo structural split (A-012).
 *
 * `src/vex-agent/db/repos/messages.ts` was split into sibling modules under
 * `./messages/` (columns, types, mappers, write, read, archive-prefix) while
 * the original path stays a compatibility façade. This test pins the EXACT
 * public runtime surface so a later edit cannot silently drop, rename, or add
 * an export. Behavior of each symbol is covered by the dedicated
 * messages*.test.ts suites; here we only assert presence + runtime typeof +
 * the exact runtime export-key set. Type-only re-exports
 * (`MessageRow`/`Message`/`MessageWithId`/`MessageMetadata`/`ArchivePrefixPlan`)
 * are imported below so `tsc --noEmit` rejects any signature drift.
 */

import { describe, it, expect } from "vitest";

import * as messagesFacade from "../../../../vex-agent/db/repos/messages.js";

import {
  MESSAGE_DB_COLUMNS,
  MESSAGE_ARCHIVE_DB_COLUMNS,
  addMessageReturningId,
  addMessage,
  addEngineMessage,
  getLiveMessages,
  getLiveMessagesWithId,
  getOperatorInstructionsAfter,
  getAllMessages,
  selectArchivePrefix,
} from "../../../../vex-agent/db/repos/messages.js";

// Type-only imports must compile against the façade re-exports.
import type {
  MessageRow,
  Message,
  MessageWithId,
  MessageMetadata,
  ArchivePrefixPlan,
} from "../../../../vex-agent/db/repos/messages.js";

describe("messages façade — public surface", () => {
  it("exposes every expected const/function with the correct runtime typeof", () => {
    expect(Array.isArray(MESSAGE_DB_COLUMNS)).toBe(true);
    expect(Array.isArray(MESSAGE_ARCHIVE_DB_COLUMNS)).toBe(true);
    expect(typeof addMessageReturningId).toBe("function");
    expect(typeof addMessage).toBe("function");
    expect(typeof addEngineMessage).toBe("function");
    expect(typeof getLiveMessages).toBe("function");
    expect(typeof getLiveMessagesWithId).toBe("function");
    expect(typeof getOperatorInstructionsAfter).toBe("function");
    expect(typeof getAllMessages).toBe("function");
    expect(typeof selectArchivePrefix).toBe("function");
  });

  it("named re-exports are identity-equal to the namespace import", () => {
    expect(messagesFacade.MESSAGE_DB_COLUMNS).toBe(MESSAGE_DB_COLUMNS);
    expect(messagesFacade.MESSAGE_ARCHIVE_DB_COLUMNS).toBe(
      MESSAGE_ARCHIVE_DB_COLUMNS,
    );
    expect(messagesFacade.addMessageReturningId).toBe(addMessageReturningId);
    expect(messagesFacade.addMessage).toBe(addMessage);
    expect(messagesFacade.addEngineMessage).toBe(addEngineMessage);
    expect(messagesFacade.getLiveMessages).toBe(getLiveMessages);
    expect(messagesFacade.getLiveMessagesWithId).toBe(getLiveMessagesWithId);
    expect(messagesFacade.getOperatorInstructionsAfter).toBe(
      getOperatorInstructionsAfter,
    );
    expect(messagesFacade.getAllMessages).toBe(getAllMessages);
    expect(messagesFacade.selectArchivePrefix).toBe(selectArchivePrefix);
  });

  it("type-only re-exports compile against the façade", () => {
    // Compile-time assertions only — exercise each re-exported type so the
    // file fails `tsc --noEmit` if any interface/type drops off the façade.
    const row: MessageRow | null = null;
    const msg: Message | null = null;
    const withId: MessageWithId | null = null;
    const meta: MessageMetadata | null = null;
    const plan: ArchivePrefixPlan | null = null;
    expect(row).toBeNull();
    expect(msg).toBeNull();
    expect(withId).toBeNull();
    expect(meta).toBeNull();
    expect(plan).toBeNull();
  });

  it("exports EXACTLY the expected runtime keys — no more, no less", () => {
    const keys = Object.keys(messagesFacade).sort();
    expect(keys).toEqual(
      [
        "MESSAGE_DB_COLUMNS",
        "MESSAGE_ARCHIVE_DB_COLUMNS",
        "addMessageReturningId",
        "addMessage",
        "addEngineMessage",
        "getLiveMessages",
        "getLiveMessagesWithId",
        "getOperatorInstructionsAfter",
        "getAllMessages",
        "selectArchivePrefix",
      ].sort(),
    );
  });
});
