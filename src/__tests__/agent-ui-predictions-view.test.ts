import { describe, expect, it } from "vitest";

const { PredictionsView } = await import("../agent/ui/src/views/PredictionsView.js");

describe("PredictionsView", () => {
  it("exports the predictions widget view", () => {
    expect(PredictionsView).toBeTypeOf("function");
  });
});
