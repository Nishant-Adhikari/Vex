import { describe, it, expect } from "vitest";
import {
  TOOL_OUTPUT_OVERFLOW_BYTES,
  TOOL_OUTPUT_TTL_MIN,
} from "@vex-agent/engine/core/tool-output-policy.js";

describe("tool-output-policy", () => {
  it("overflow threshold is 16 KiB (looser than the 8 KB compaction heuristic)", () => {
    expect(TOOL_OUTPUT_OVERFLOW_BYTES).toBe(16 * 1024);
  });

  it("blob TTL is 15 minutes", () => {
    expect(TOOL_OUTPUT_TTL_MIN).toBe(15);
  });
});
