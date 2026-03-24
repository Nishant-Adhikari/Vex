import { describe, expect, it } from "vitest";

const { AgentSticker } = await import("../agent/ui/src/components/AgentSticker.js");

describe("AgentSticker", () => {
  it("exports the sticker component", () => {
    expect(AgentSticker).toBeTypeOf("function");
  });
});
