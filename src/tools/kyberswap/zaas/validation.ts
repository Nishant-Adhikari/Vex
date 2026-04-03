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

  // Extract poolDetails if present
  const poolDetails = isRecord(data.poolDetails) ? {
    category: typeof data.poolDetails.category === "string" ? data.poolDetails.category : undefined,
    token0: typeof data.poolDetails.token0 === "string" ? data.poolDetails.token0 : undefined,
    token1: typeof data.poolDetails.token1 === "string" ? data.poolDetails.token1 : undefined,
    fee: typeof data.poolDetails.fee === "number" ? data.poolDetails.fee : undefined,
    address: typeof data.poolDetails.address === "string" ? data.poolDetails.address : undefined,
  } : undefined;

  // Extract positionDetails if present
  const positionDetails = isRecord(data.positionDetails) ? {
    tokenId: typeof data.positionDetails.tokenId === "string" ? data.positionDetails.tokenId : undefined,
    tickLower: typeof data.positionDetails.tickLower === "number" ? data.positionDetails.tickLower : undefined,
    tickUpper: typeof data.positionDetails.tickUpper === "number" ? data.positionDetails.tickUpper : undefined,
    liquidity: typeof data.positionDetails.liquidity === "string" ? data.positionDetails.liquidity : undefined,
  } : undefined;

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
      poolDetails,
      positionDetails,
      gas: typeof data.gas === "string" ? data.gas : undefined,
      gasUsd: typeof data.gasUsd === "string" ? data.gasUsd : undefined,
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
