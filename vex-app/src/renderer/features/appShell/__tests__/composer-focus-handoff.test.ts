/**
 * Pure transition rule behind the composer focus handoff (fix/hypervexing-exit-focus,
 * item b): the shell must hand focus back to the normal chat composer on the
 * ONE visual transition where the Hypervexing exit drain just finished, and
 * on no other render. Tested in isolation, no component mount required.
 */

import { describe, expect, it } from "vitest";
import { shouldFocusComposerAfterWorkspaceExit } from "../composer-focus-handoff.js";

describe("shouldFocusComposerAfterWorkspaceExit", () => {
  it("requests focus exactly on the hypervexing → normal visual transition", () => {
    expect(shouldFocusComposerAfterWorkspaceExit("hypervexing", "normal")).toBe(
      true,
    );
  });

  it("does not request focus while entering (normal → hypervexing)", () => {
    expect(
      shouldFocusComposerAfterWorkspaceExit("normal", "hypervexing"),
    ).toBe(false);
  });

  it("does not request focus on a no-op re-render while normal", () => {
    expect(shouldFocusComposerAfterWorkspaceExit("normal", "normal")).toBe(
      false,
    );
  });

  it("does not request focus while still draining (hypervexing → hypervexing)", () => {
    expect(
      shouldFocusComposerAfterWorkspaceExit("hypervexing", "hypervexing"),
    ).toBe(false);
  });
});
