/**
 * Jupiter Send service — send tokens to anyone via invite code.
 * Recipients claim via Jupiter Mobile. Self-custodial recovery via clawback.
 */

import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { fetchJson } from "../../../utils/http.js";
import { getJupiterBaseUrl, getJupiterHeaders } from "./jupiter-client.js";
import { resolveToken } from "./token-registry.js";
import { signAndSendVersionedTx } from "./tx.js";
import { solanaExplorerUrl, uiToTokenAmount } from "./validation.js";
import { SOL_MINT, SOL_DECIMALS } from "./constants.js";
import { EchoError, ErrorCodes } from "../../../errors.js";
import type { TransferResult } from "../types.js";
import { createHash } from "node:crypto";

const SEND_PROGRAM = "inv1tEtSwRMtM44tbvJGNiTxMvDfPVnX9StyqXfDfks";

function generateInviteCode(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let code = "";
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (const b of bytes) code += chars[b % chars.length];
  return code;
}

function deriveKeypairFromCode(code: string): Keypair {
  const hash = createHash("sha256").update(`invite:${code}`).digest();
  return Keypair.fromSeed(hash);
}

export interface PendingInvite {
  invitePDA: string;
  amount: string;
  mint: string;
  createdAt: string;
}

export async function craftSend(
  secretKey: Uint8Array,
  amount: number,
  mint?: string,
): Promise<{ inviteCode: string; signature: string; explorerUrl: string }> {
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const inviteCode = generateInviteCode();
  const inviteKeypair = deriveKeypairFromCode(inviteCode);

  // Convert UI amount to atomic units (Jupiter Send expects atomic)
  const decimals = mint ? (await resolveToken(mint))?.decimals ?? 9 : SOL_DECIMALS;
  const atomicAmount = String(uiToTokenAmount(amount, decimals));

  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ tx?: string; transaction?: string }>(
    `${base}/send/v1/craft-send`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        inviteSigner: inviteKeypair.publicKey.toBase58(),
        sender: walletKeypair.publicKey.toBase58(),
        amount: atomicAmount,
        ...(mint ? { mint } : {}),
      }),
    },
  );

  // API may return either `tx` (per docs) or `transaction` (per live testing)
  const txBase64 = resp.tx ?? resp.transaction;
  if (!txBase64) {
    throw new EchoError(ErrorCodes.SOLANA_SEND_INVITE_FAILED, "No transaction returned from Send API");
  }

  // Sign with BOTH sender and invite keypair
  const signature = await signAndSendVersionedTx(txBase64, [walletKeypair, inviteKeypair]);

  return {
    inviteCode,
    signature,
    explorerUrl: solanaExplorerUrl(signature),
  };
}

export async function craftClawback(
  secretKey: Uint8Array,
  inviteCode: string,
): Promise<TransferResult> {
  const walletKeypair = Keypair.fromSecretKey(secretKey);
  const inviteKeypair = deriveKeypairFromCode(inviteCode);

  // Derive PDA: seeds ["invite", pubkey] with Send program
  const [invitePDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("invite"), inviteKeypair.publicKey.toBuffer()],
    new PublicKey(SEND_PROGRAM),
  );

  const base = getJupiterBaseUrl();
  const headers = { ...getJupiterHeaders(), "Content-Type": "application/json" };

  const resp = await fetchJson<{ tx?: string; transaction?: string }>(
    `${base}/send/v1/craft-clawback`,
    {
      method: "POST", headers,
      body: JSON.stringify({
        invitePDA: invitePDA.toBase58(),
        sender: walletKeypair.publicKey.toBase58(),
      }),
    },
  );

  const txBase64 = resp.tx ?? resp.transaction;
  if (!txBase64) {
    throw new EchoError(ErrorCodes.SOLANA_SEND_CLAWBACK_FAILED, "No transaction returned from Send API");
  }

  const signature = await signAndSendVersionedTx(txBase64, [walletKeypair]);
  return { signature, explorerUrl: solanaExplorerUrl(signature) };
}

export async function getPendingInvites(address: string): Promise<PendingInvite[]> {
  const base = getJupiterBaseUrl();
  const headers = getJupiterHeaders();

  try {
    // Response is { invites: [...], hasMoreData: boolean }, NOT a raw array
    const result = await fetchJson<{ invites: PendingInvite[]; hasMoreData: boolean }>(
      `${base}/send/v1/pending-invites?address=${address}`,
      { headers },
    );
    return result.invites ?? [];
  } catch {
    return [];
  }
}
