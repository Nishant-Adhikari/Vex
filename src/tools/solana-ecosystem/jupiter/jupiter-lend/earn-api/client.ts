/**
 * Low-level Jupiter Lend Earn REST client.
 * Source-of-truth for stable /lend/v1/earn endpoints only.
 */

import { fetchJson } from "../../../../../utils/http.js";
import { JUPITER_LEND_EARN_API_BASE_URL } from "./types.js";
import type {
  JupiterLendEarnAmountRequest,
  JupiterLendEarnEarningsParams,
  JupiterLendEarnEarningsResponse,
  JupiterLendEarnInstructionResponse,
  JupiterLendEarnPositionsParams,
  JupiterLendEarnPositionsResponse,
  JupiterLendEarnSharesRequest,
  JupiterLendEarnTokensResponse,
  JupiterLendEarnTransactionResponse,
} from "./types.js";
import {
  getJupiterLendHeaders,
  normalizeJupiterLendPositionsQuery,
  normalizeJupiterLendUsersQuery,
  validateJupiterLendAmountRequest,
  validateJupiterLendEarningsParams,
  validateJupiterLendSharesRequest,
} from "./validation.js";

function toQueryString(query: Record<string, string>): string {
  return new URLSearchParams(query).toString();
}

export async function jupiterLendEarnTokens(): Promise<JupiterLendEarnTokensResponse> {
  return fetchJson<JupiterLendEarnTokensResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/tokens`,
    { headers: getJupiterLendHeaders() },
  );
}

export async function jupiterLendEarnPositions(
  params: JupiterLendEarnPositionsParams,
): Promise<JupiterLendEarnPositionsResponse> {
  return fetchJson<JupiterLendEarnPositionsResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/positions?${toQueryString({
      users: normalizeJupiterLendUsersQuery(params.users),
    })}`,
    { headers: getJupiterLendHeaders() },
  );
}

export async function jupiterLendEarnEarnings(
  params: JupiterLendEarnEarningsParams,
): Promise<JupiterLendEarnEarningsResponse> {
  const validated = validateJupiterLendEarningsParams(params);

  return fetchJson<JupiterLendEarnEarningsResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/earnings?${toQueryString({
      user: validated.user,
      positions: normalizeJupiterLendPositionsQuery(validated.positions),
    })}`,
    { headers: getJupiterLendHeaders() },
  );
}

export async function jupiterLendEarnDepositTransaction(
  request: JupiterLendEarnAmountRequest,
): Promise<JupiterLendEarnTransactionResponse> {
  return fetchJson<JupiterLendEarnTransactionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/deposit`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendAmountRequest(request)),
    },
  );
}

export async function jupiterLendEarnWithdrawTransaction(
  request: JupiterLendEarnAmountRequest,
): Promise<JupiterLendEarnTransactionResponse> {
  return fetchJson<JupiterLendEarnTransactionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/withdraw`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendAmountRequest(request)),
    },
  );
}

export async function jupiterLendEarnMintTransaction(
  request: JupiterLendEarnSharesRequest,
): Promise<JupiterLendEarnTransactionResponse> {
  return fetchJson<JupiterLendEarnTransactionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/mint`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendSharesRequest(request)),
    },
  );
}

export async function jupiterLendEarnRedeemTransaction(
  request: JupiterLendEarnSharesRequest,
): Promise<JupiterLendEarnTransactionResponse> {
  return fetchJson<JupiterLendEarnTransactionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/redeem`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendSharesRequest(request)),
    },
  );
}

export async function jupiterLendEarnDepositInstructions(
  request: JupiterLendEarnAmountRequest,
): Promise<JupiterLendEarnInstructionResponse> {
  return fetchJson<JupiterLendEarnInstructionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/deposit-instructions`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendAmountRequest(request)),
    },
  );
}

export async function jupiterLendEarnWithdrawInstructions(
  request: JupiterLendEarnAmountRequest,
): Promise<JupiterLendEarnInstructionResponse> {
  return fetchJson<JupiterLendEarnInstructionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/withdraw-instructions`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendAmountRequest(request)),
    },
  );
}

export async function jupiterLendEarnMintInstructions(
  request: JupiterLendEarnSharesRequest,
): Promise<JupiterLendEarnInstructionResponse> {
  return fetchJson<JupiterLendEarnInstructionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/mint-instructions`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendSharesRequest(request)),
    },
  );
}

export async function jupiterLendEarnRedeemInstructions(
  request: JupiterLendEarnSharesRequest,
): Promise<JupiterLendEarnInstructionResponse> {
  return fetchJson<JupiterLendEarnInstructionResponse>(
    `${JUPITER_LEND_EARN_API_BASE_URL}/redeem-instructions`,
    {
      method: "POST",
      headers: getJupiterLendHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(validateJupiterLendSharesRequest(request)),
    },
  );
}
