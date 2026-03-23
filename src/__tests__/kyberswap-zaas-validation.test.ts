import { describe, it, expect } from "vitest";
import { validateZapRouteResponse, validateZapBuildResponse } from "../kyberswap/zaas/validation.js";

describe("validateZapRouteResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateZapRouteResponse(null)).toThrow();
  });

  it("parses valid response", () => {
    const raw = { code: 0, data: { route: "encoded_route", routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05" } };
    const result = validateZapRouteResponse(raw);
    expect(result.code).toBe(0);
    expect(result.data.route).toBe("encoded_route");
    expect(result.data.routerAddress).toBe("0x0e97c887b61ccd952a53578b04763e7134429e05");
  });

  it("handles missing optional fields", () => {
    const raw = { code: 0, data: {} };
    const result = validateZapRouteResponse(raw);
    expect(result.data.routeSummary).toBeUndefined();
    expect(result.data.zapDetails).toBeUndefined();
    expect(result.data.route).toBeUndefined();
    expect(result.data.routerAddress).toBeUndefined();
  });

  it("defaults code to 0 when missing", () => {
    const raw = { data: {} };
    const result = validateZapRouteResponse(raw);
    expect(result.code).toBe(0);
  });
});

describe("validateZapBuildResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateZapBuildResponse(null)).toThrow();
  });

  it("parses callData from data.callData", () => {
    const raw = {
      code: 0,
      data: { callData: "0xabcdef", routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05", value: "1000" },
    };
    const result = validateZapBuildResponse(raw);
    expect(result.data.callData).toBe("0xabcdef");
    expect(result.data.value).toBe("1000");
  });

  it("falls back to data.data for callData", () => {
    const raw = {
      code: 0,
      data: { data: "0x123456", routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05" },
    };
    const result = validateZapBuildResponse(raw);
    expect(result.data.callData).toBe("0x123456");
  });

  it("defaults value to '0' when missing", () => {
    const raw = {
      code: 0,
      data: { callData: "0xabc", routerAddress: "0x0e97c887b61ccd952a53578b04763e7134429e05" },
    };
    const result = validateZapBuildResponse(raw);
    expect(result.data.value).toBe("0");
  });
});
