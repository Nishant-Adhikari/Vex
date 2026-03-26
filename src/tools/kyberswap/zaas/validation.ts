/**
 * Runtime validators for KyberSwap ZaaS API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type { ZapRouteResponse, ZapBuildResponse } from "./types.js";

const { asString, asOptionalString } = createFieldValidators(
  ErrorCodes.KYBER_API_ERROR, "KyberSwap ZaaS",
);

export function validateZapRouteResponse(raw: unknown): ZapRouteResponse {
  if (!isRecord(raw)) {
    throw new Error("Expected ZaaS route response object");
  }
  const code = typeof raw.code === "number" ? raw.code : 0;
  const data = isRecord(raw.data) ? raw.data : {};

  return {
    code,
    message: asOptionalString(raw.message),
    data: {
      routeSummary: data.routeSummary ?? undefined,
      zapDetails: isRecord(data.zapDetails) ? data.zapDetails as unknown as ZapRouteResponse["data"]["zapDetails"] : undefined,
      route: typeof data.route === "string" ? data.route : undefined,
      routerAddress: typeof data.routerAddress === "string"
        ? data.routerAddress as ZapRouteResponse["data"]["routerAddress"]
        : undefined,
    },
    requestId: asOptionalString(raw.requestId),
  };
}

export function validateZapBuildResponse(raw: unknown): ZapBuildResponse {
  if (!isRecord(raw)) {
    throw new Error("Expected ZaaS build response object");
  }
  const code = typeof raw.code === "number" ? raw.code : 0;
  const data = isRecord(raw.data) ? raw.data : {};

  return {
    code,
    message: asOptionalString(raw.message),
    data: {
      callData: asString(data.callData ?? data.data, "data.callData"),
      routerAddress: asString(data.routerAddress, "data.routerAddress") as ZapBuildResponse["data"]["routerAddress"],
      value: typeof data.value === "string" ? data.value : "0",
    },
    requestId: asOptionalString(raw.requestId),
  };
}
