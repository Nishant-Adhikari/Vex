/**
 * Runtime validators for Polymarket Relayer API responses.
 */

import { isRecord } from "../../utils/validation-helpers.js";
import type { RelayerSubmitResponse, RelayerTransaction, RelayerApiKey } from "./types.js";

export function validateSubmitResponse(raw: unknown): RelayerSubmitResponse {
  if (!isRecord(raw)) throw new Error("Expected submit response");
  return {
    transactionID: typeof raw.transactionID === "string" ? raw.transactionID : "",
    transactionHash: typeof raw.transactionHash === "string" ? raw.transactionHash : "",
    state: typeof raw.state === "string" ? raw.state : "STATE_NEW",
  };
}

export function validateTransactionsResponse(raw: unknown): RelayerTransaction[] {
  if (!Array.isArray(raw)) throw new Error("Expected transactions array");
  return raw.map((t) => {
    if (!isRecord(t)) throw new Error("transaction must be an object");
    return {
      transactionID: typeof t.transactionID === "string" ? t.transactionID : "",
      transactionHash: typeof t.transactionHash === "string" ? t.transactionHash : "",
      from: typeof t.from === "string" ? t.from : "",
      to: typeof t.to === "string" ? t.to : "",
      proxyAddress: typeof t.proxyAddress === "string" ? t.proxyAddress : "",
      data: typeof t.data === "string" ? t.data : "",
      nonce: typeof t.nonce === "string" ? t.nonce : "",
      state: typeof t.state === "string" ? t.state as RelayerTransaction["state"] : "STATE_NEW",
      type: t.type === "SAFE" ? "SAFE" : "PROXY",
      owner: typeof t.owner === "string" ? t.owner : "",
      createdAt: typeof t.createdAt === "string" ? t.createdAt : "",
      updatedAt: typeof t.updatedAt === "string" ? t.updatedAt : "",
    };
  });
}

export function validateApiKeysResponse(raw: unknown): RelayerApiKey[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((k) => {
    if (!isRecord(k)) return { apiKey: "", address: "", createdAt: "", updatedAt: "" };
    return {
      apiKey: typeof k.apiKey === "string" ? k.apiKey : "",
      address: typeof k.address === "string" ? k.address : "",
      createdAt: typeof k.createdAt === "string" ? k.createdAt : "",
      updatedAt: typeof k.updatedAt === "string" ? k.updatedAt : "",
    };
  });
}

export function validateNonceResponse(raw: unknown): { nonce: string } {
  if (!isRecord(raw)) return { nonce: "0" };
  return { nonce: typeof raw.nonce === "string" ? raw.nonce : "0" };
}

export function validateDeployedResponse(raw: unknown): { deployed: boolean } {
  if (!isRecord(raw)) return { deployed: false };
  return { deployed: raw.deployed === true };
}
