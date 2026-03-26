/**
 * `echoclaw polymarket positions/orders/profile` — user data commands.
 */

import { Command } from "commander";
import { getPolyDataClient } from "../../tools/polymarket/data/client.js";
import { getPolyClobClient } from "../../tools/polymarket/clob/client.js";
import { getPolyGammaClient } from "../../tools/polymarket/gamma/client.js";
import { requirePolyAuth, formatUsd, formatProbability } from "./helpers.js";
import { requireWalletAndKeystore } from "../../tools/wallet/auth.js";
import { isHeadless, writeJsonSuccess } from "../../utils/output.js";
import { spinner, infoBox, colors } from "../../utils/ui.js";
import { parseIntSafe } from "../../utils/validation.js";

export function createPositionsSubcommand(): Command {
  return new Command("positions")
    .description("View Polymarket positions and PnL (own or other user)")
    .option("--user <address>", "User address to track (defaults to own wallet)")
    .option("--market <id>", "Filter by condition ID")
    .option("--redeemable", "Only redeemable positions")
    .option("--mergeable", "Only mergeable positions")
    .option("--limit <n>", "Max results", "20")
    .exitOverride()
    .action(async (options: { user?: string; market?: string; redeemable?: boolean; mergeable?: boolean; limit: string }) => {
      let userAddr = options.user;
      if (!userAddr) {
        const { address } = requireWalletAndKeystore();
        userAddr = address;
      }

      const data = getPolyDataClient();
      const spin = spinner("Fetching positions...");
      spin.start();

      const positions = await data.getPositions({
        user: userAddr,
        market: options.market,
        redeemable: options.redeemable,
        mergeable: options.mergeable,
        limit: parseIntSafe(options.limit, "limit"),
      });

      spin.succeed(`Found ${positions.length} position(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ positions, user: userAddr });
        return;
      }

      if (positions.length === 0) {
        infoBox("Positions", `No positions found for ${userAddr}`);
        return;
      }

      const lines = positions.map((p) => {
        const pnlColor = p.cashPnl >= 0 ? colors.value : colors.error;
        return [
          `${p.title ?? p.conditionId} — ${colors.info(p.outcome ?? "?")}`,
          `  Size: ${p.size.toFixed(2)} @ ${formatProbability(p.avgPrice)} avg | Cur: ${formatProbability(p.curPrice)}`,
          `  Value: ${formatUsd(p.currentValue)} | PnL: ${pnlColor(`${formatUsd(p.cashPnl)} (${(p.percentPnl * 100).toFixed(1)}%)`)}`,
          p.redeemable ? `  ${colors.value("REDEEMABLE")}` : "",
        ].filter(Boolean).join("\n");
      });

      infoBox(`Positions: ${userAddr.slice(0, 10)}...`, lines.join("\n\n"));
    });
}

export function createOrdersSubcommand(): Command {
  return new Command("orders")
    .description("List open Polymarket orders")
    .option("--market <id>", "Filter by condition ID")
    .exitOverride()
    .action(async (options: { market?: string }) => {
      requirePolyAuth();
      const clob = getPolyClobClient();

      const spin = spinner("Fetching orders...");
      spin.start();

      const result = await clob.getOrders({ market: options.market });
      spin.succeed(`Found ${result.count} order(s)`);

      if (isHeadless()) {
        writeJsonSuccess({ limit: result.limit, next_cursor: result.next_cursor, count: result.count, data: result.data });
        return;
      }

      if (result.data.length === 0) {
        infoBox("Open Orders", "No open orders.");
        return;
      }

      const lines = result.data.map((o) =>
        `${o.id.slice(0, 16)}... ${o.side} ${o.outcome} @ ${o.price}\n  Size: ${o.original_size} | Matched: ${o.size_matched} | ${o.order_type} | ${o.status}`
      );

      infoBox("Open Orders", lines.join("\n\n"));
    });
}

export function createProfileSubcommand(): Command {
  return new Command("profile")
    .description("View Polymarket user profile")
    .argument("<address>", "Wallet address or proxy wallet")
    .exitOverride()
    .action(async (address: string) => {
      const gamma = getPolyGammaClient();
      const data = getPolyDataClient();

      const spin = spinner("Fetching profile...");
      spin.start();

      const [profile, value, traded] = await Promise.all([
        gamma.getPublicProfile(address),
        data.getValue(address).catch(() => ({ user: address, value: 0 })),
        data.getTraded(address).catch(() => ({ user: address, traded: 0 })),
      ]);

      spin.succeed("Profile loaded");

      if (isHeadless()) {
        writeJsonSuccess({ profile, portfolioValue: value.value, marketsTraded: traded.traded });
        return;
      }

      const name = profile.name ?? profile.pseudonym ?? "Anonymous";
      infoBox(`Profile: ${name}`, [
        profile.name ? `Name: ${colors.info(profile.name)}` : "",
        profile.pseudonym ? `Pseudonym: ${profile.pseudonym}` : "",
        profile.bio ? `Bio: ${profile.bio}` : "",
        profile.xUsername ? `X: @${profile.xUsername}` : "",
        profile.verifiedBadge ? `${colors.value("VERIFIED")}` : "",
        `Wallet: ${colors.muted(profile.proxyWallet ?? address)}`,
        `Portfolio: ${formatUsd(value.value)}`,
        `Markets Traded: ${traded.traded}`,
      ].filter(Boolean).join("\n"));
    });
}
