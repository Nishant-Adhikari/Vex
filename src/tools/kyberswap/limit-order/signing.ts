/**
 * EIP-712 signing helpers for KyberSwap Limit Orders.
 *
 * SECURITY: Must only be called AFTER --yes confirmation.
 * Private key is NEVER logged. Passes directly to viem signTypedData.
 */

import { type Hex, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { LimitOrderEip712Message } from "./types.js";

/**
 * Sign an EIP-712 message (order creation or cancel) using viem.
 *
 * @param privateKey - Wallet private key (from requireWalletAndKeystore)
 * @param eip712 - Unsigned EIP-712 message from KyberSwap API
 * @returns Hex-encoded signature
 */
export async function signEip712Message(privateKey: Hex, eip712: LimitOrderEip712Message): Promise<Hex> {
  const account = privateKeyToAccount(privateKey);
  const client = createWalletClient({ account, transport: http() });

  // Remove EIP712Domain from types if present (viem adds it internally)
  const { EIP712Domain: _, ...typesWithoutDomain } = eip712.types;

  return client.signTypedData({
    domain: {
      name: eip712.domain.name,
      version: eip712.domain.version,
      chainId: eip712.domain.chainId,
      verifyingContract: eip712.domain.verifyingContract,
    },
    types: typesWithoutDomain,
    primaryType: eip712.primaryType,
    message: eip712.message,
  });
}
