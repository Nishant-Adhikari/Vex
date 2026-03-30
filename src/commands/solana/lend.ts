/**
 * Jupiter Lend Earn commands — deposit, withdraw, view rates and positions.
 */

import { Command } from "commander";
import { requireSolanaWallet } from "../../tools/wallet/multi-auth.js";
import {
  getJupiterLendEarnTokens,
  getJupiterLendEarnPositions,
  getJupiterLendEarnEarnings,
  executeJupiterLendEarnDeposit,
  executeJupiterLendEarnWithdraw,
} from "../../tools/solana-ecosystem/jupiter/jupiter-lend/earn-api/service.js";
import { resolveJupiterToken } from "../../tools/solana-ecosystem/jupiter/jupiter-tokens/service.js";
import { uiToTokenAmount } from "../../tools/solana-ecosystem/shared/solana-validation.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { successBox, infoBox, spinner, printTable, colors } from "../../utils/ui.js";
import { EchoError, ErrorCodes } from "../../errors.js";

export function createLendSubcommand(): Command {
  const lend = new Command("lend")
    .description("Jupiter Lend — earn yield by depositing tokens")
    .exitOverride();

  // echoclaw solana lend rates [token]
  lend
    .command("rates")
    .description("Compare lending rates across Jupiter pools")
    .argument("[token]", "Filter by token symbol")
    .action(async (token?: string) => {
      const spin = spinner("Fetching lending rates...");
      spin.start();

      try {
        let tokens = await getJupiterLendEarnTokens();
        if (token) {
          const lower = token.toLowerCase();
          tokens = tokens.filter((t) => t.symbol.toLowerCase().includes(lower));
        }
        spin.succeed(`${tokens.length} lending pool(s)`);

        if (isHeadless()) {
          writeJsonSuccess({ rates: tokens });
          return;
        }

        if (tokens.length === 0) {
          infoBox("Lend Rates", "No pools found.");
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Supply APY", width: 12 },
            { header: "Total APY", width: 12 },
            { header: "Total Supply", width: 18 },
          ],
          tokens.map((t) => [
            t.symbol,
            `${(Number(t.supplyRate) * 100).toFixed(2)}%`,
            `${(Number(t.totalRate) * 100).toFixed(2)}%`,
            t.totalAssets,
          ]),
        );
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // echoclaw solana lend positions
  lend
    .command("positions")
    .description("Your lending positions")
    .action(async () => {
      const wallet = requireSolanaWallet();
      const spin = spinner("Loading positions...");
      spin.start();

      try {
        const positions = await getJupiterLendEarnPositions(wallet.address);

        // Fetch earnings for positions that have asset addresses
        const posAddresses = positions.map((p) => p.token.assetAddress).filter(Boolean);
        const earningsResult = posAddresses.length > 0
          ? await getJupiterLendEarnEarnings(wallet.address, posAddresses)
          : null;
        const earningsMap = new Map(
          (earningsResult?.earnings ?? []).map((e) => [e.address, e.earnings]),
        );

        spin.succeed(`${positions.length} position(s)`);

        if (isHeadless()) {
          writeJsonSuccess({
            positions: positions.map((p) => ({
              ...p,
              earnings: earningsMap.get(p.token.assetAddress) ?? 0,
            })),
            ...(earningsResult ? { earningsRaw: earningsResult.raw } : {}),
          });
          return;
        }

        if (positions.length === 0) {
          infoBox("Lend Positions", "No lending positions. Deposit: echoclaw solana lend deposit <token> --amount <n> --yes");
          return;
        }

        printTable(
          [
            { header: "Token", width: 10 },
            { header: "Shares", width: 16 },
            { header: "Assets", width: 16 },
            { header: "Earnings", width: 16 },
          ],
          positions.map((p) => [
            p.token.symbol,
            p.shares,
            p.underlyingAssets,
            String(earningsMap.get(p.token.assetAddress) ?? 0),
          ]),
        );
      } catch (err) { spin.fail("Failed"); throw err; }
    });

  // echoclaw solana lend deposit <token> --amount <n> --yes
  lend
    .command("deposit <token>")
    .description("Deposit tokens to earn yield")
    .requiredOption("--amount <n>", "Amount to deposit")
    .option("--yes", "Skip confirmation")
    .action(async (token: string, options: { amount: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const tokenMeta = await resolveJupiterToken(token);
      if (!tokenMeta) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${token}`);

      const atomicAmount = uiToTokenAmount(Number(options.amount), tokenMeta.decimals);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Deposit ${colors.info(`${options.amount} ${tokenMeta.symbol}`)} to Jupiter Lend\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Depositing ${options.amount} ${tokenMeta.symbol}...`);
      spin.start();

      try {
        const result = await executeJupiterLendEarnDeposit(wallet.secretKey, tokenMeta.address, atomicAmount.toString());
        spin.succeed("Deposited");

        if (isHeadless()) {
          writeJsonSuccess({ action: "deposit", token: tokenMeta.symbol, amount: options.amount, ...result });
        } else {
          successBox("Deposit Complete", `${colors.info(`${options.amount} ${tokenMeta.symbol}`)} deposited\nSignature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Deposit failed"); throw err; }
    });

  // echoclaw solana lend withdraw <token> --amount <n> --yes
  lend
    .command("withdraw <token>")
    .description("Withdraw from lending pool")
    .requiredOption("--amount <n>", "Amount to withdraw")
    .option("--yes", "Skip confirmation")
    .action(async (token: string, options: { amount: string; yes?: boolean }) => {
      const wallet = requireSolanaWallet();
      const tokenMeta = await resolveJupiterToken(token);
      if (!tokenMeta) throw new EchoError(ErrorCodes.SOLANA_TOKEN_NOT_FOUND, `Token not found: ${token}`);

      const atomicAmount = uiToTokenAmount(Number(options.amount), tokenMeta.decimals);

      if (!options.yes && !isHeadless()) {
        process.stderr.write(`\n  Withdraw ${colors.info(`${options.amount} ${tokenMeta.symbol}`)} from Jupiter Lend\n  Use ${colors.muted("--yes")} to execute.\n\n`);
        throw new EchoError(ErrorCodes.CONFIRMATION_REQUIRED, "Add --yes to proceed.");
      }

      const spin = spinner(`Withdrawing ${options.amount} ${tokenMeta.symbol}...`);
      spin.start();

      try {
        const result = await executeJupiterLendEarnWithdraw(wallet.secretKey, tokenMeta.address, atomicAmount.toString());
        spin.succeed("Withdrawn");

        if (isHeadless()) {
          writeJsonSuccess({ action: "withdraw", token: tokenMeta.symbol, amount: options.amount, ...result });
        } else {
          successBox("Withdrawal Complete", `${colors.info(`${options.amount} ${tokenMeta.symbol}`)} withdrawn\nSignature: ${colors.muted(result.signature)}\nExplorer: ${colors.muted(result.explorerUrl)}`);
        }
      } catch (err) { spin.fail("Withdrawal failed"); throw err; }
    });

  return lend;
}
