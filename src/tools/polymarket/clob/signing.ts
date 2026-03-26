/**
 * Polymarket CTF Exchange EIP-712 order signing.
 *
 * Signs orders for the Conditional Token Framework Exchange on Polygon.
 * Reuses viem signTypedData pattern from KyberSwap limit-order signing.
 *
 * SECURITY: Must only be called AFTER --yes confirmation.
 */

import { type Hex, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygon } from "viem/chains";
import { CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, POLYGON_CHAIN_ID } from "../constants.js";
import type { ClobOrder } from "./types.js";

const CTF_EXCHANGE_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
  verifyingContract: CTF_EXCHANGE,
} as const;

const NEG_RISK_CTF_EXCHANGE_DOMAIN = {
  name: "Polymarket CTF Exchange",
  version: "1",
  chainId: POLYGON_CHAIN_ID,
  verifyingContract: NEG_RISK_CTF_EXCHANGE,
} as const;

const ORDER_TYPES = {
  Order: [
    { name: "salt", type: "uint256" },
    { name: "maker", type: "address" },
    { name: "signer", type: "address" },
    { name: "taker", type: "address" },
    { name: "tokenId", type: "uint256" },
    { name: "makerAmount", type: "uint256" },
    { name: "takerAmount", type: "uint256" },
    { name: "expiration", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "feeRateBps", type: "uint256" },
    { name: "side", type: "uint8" },
    { name: "signatureType", type: "uint8" },
  ],
} as const;

/**
 * Build a CLOB order object ready for signing.
 */
export function buildClobOrder(params: {
  maker: string;
  signer: string;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: "BUY" | "SELL";
  feeRateBps: string;
  nonce?: string;
  expiration?: string;
  signatureType?: 0 | 1 | 2;
}): Omit<ClobOrder, "signature" | "salt"> & { salt: number } {
  const salt = Math.floor(Math.random() * 2 ** 32);
  return {
    maker: params.maker,
    signer: params.signer,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: params.tokenId,
    makerAmount: params.makerAmount,
    takerAmount: params.takerAmount,
    side: params.side,
    expiration: params.expiration ?? "0",
    nonce: params.nonce ?? "0",
    feeRateBps: params.feeRateBps,
    signatureType: params.signatureType ?? 0,
    salt,
  };
}

/**
 * Sign a CLOB order using EIP-712 typed data via viem.
 *
 * @param privateKey - Wallet private key
 * @param order - Order to sign (without signature)
 * @param negRisk - Whether this is a negative risk market
 * @returns Hex signature
 */
export async function signClobOrder(
  privateKey: Hex,
  order: Omit<ClobOrder, "signature">,
  negRisk = false,
): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({
    account,
    chain: polygon,
    transport: http(),
  });

  const domain = negRisk ? NEG_RISK_CTF_EXCHANGE_DOMAIN : CTF_EXCHANGE_DOMAIN;
  const sideNum = order.side === "BUY" ? 0 : 1;

  return client.signTypedData({
    domain,
    types: ORDER_TYPES,
    primaryType: "Order",
    message: {
      salt: BigInt(order.salt),
      maker: order.maker as `0x${string}`,
      signer: order.signer as `0x${string}`,
      taker: order.taker as `0x${string}`,
      tokenId: BigInt(order.tokenId),
      makerAmount: BigInt(order.makerAmount),
      takerAmount: BigInt(order.takerAmount),
      expiration: BigInt(order.expiration),
      nonce: BigInt(order.nonce),
      feeRateBps: BigInt(order.feeRateBps),
      side: sideNum,
      signatureType: order.signatureType,
    },
  });
}
