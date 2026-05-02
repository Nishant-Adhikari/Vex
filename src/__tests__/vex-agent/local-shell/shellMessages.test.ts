import { describe, it, expect } from "vitest";

import { formatMissionDraftUpdateSummary } from "../../../../local/vex-shell/app/lib/shellMessages.js";

describe("vex-shell mission draft message formatting", () => {
  it("surfaces mission_draft_update tool failures", () => {
    expect(
      formatMissionDraftUpdateSummary("Tool mission_draft_update failed: invalid input syntax for type json"),
    ).toBe("Mission draft update failed: invalid input syntax for type json.");
  });
});
