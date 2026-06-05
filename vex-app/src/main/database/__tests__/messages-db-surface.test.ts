/**
 * Façade surface lock for `messages-db.ts`.
 *
 * `messages-db.ts` was split into `./messages/*` sibling modules and now
 * re-exports the identical public surface. This test pins that surface so a
 * future structural change cannot silently drop, rename, or re-type an export
 * that the IPC layer (`ipc/messages.ts`) imports from the old path.
 *
 * It asserts:
 *   - every expected runtime export is present with the correct `typeof`,
 *   - the EXACT set of runtime export keys (no extras, none missing).
 *
 * The façade re-exports only functions; the message DTO/page types it operates
 * on live in `@shared/schemas/messages.js` and are NOT part of this surface.
 * The type-only import below documents the contract those functions resolve to
 * and must compile (`Promise<Result<MessagePage, VexError>>`).
 */

import { describe, expect, it } from "vitest";
import * as messagesDb from "../messages-db.js";
// Type-only imports: must compile. These are the shapes the façade functions
// resolve to; they are not runtime export keys of `messages-db.ts`.
import type { MessagePage } from "@shared/schemas/messages.js";
import type { Result, VexError } from "@shared/ipc/result.js";

// Compile-time assertion that the façade function signatures stay aligned with
// the shared page DTO contract.
type _AssertTailReturn = ReturnType<typeof messagesDb.getMessageTail> extends
  Promise<Result<MessagePage, VexError>>
  ? true
  : never;
const _assertTailReturn: _AssertTailReturn = true;
void _assertTailReturn;

const EXPECTED_FUNCTION_EXPORTS = [
  "getMessageTail",
  "listMessages",
  "getMessageAround",
] as const;

describe("messages-db façade surface", () => {
  it("exposes every expected function export with typeof === 'function'", () => {
    for (const key of EXPECTED_FUNCTION_EXPORTS) {
      expect(typeof (messagesDb as Record<string, unknown>)[key]).toBe("function");
    }
  });

  it("exposes EXACTLY the expected runtime export keys", () => {
    const runtimeKeys = Object.keys(messagesDb).sort();
    expect(runtimeKeys).toEqual([...EXPECTED_FUNCTION_EXPORTS].sort());
  });
});
