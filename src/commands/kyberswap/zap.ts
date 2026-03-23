/**
 * `echoclaw kyberswap zap` — subcommand assembly.
 */

import { Command } from "commander";
import { createZapSearchAction } from "./zap-search.js";
import { createZapInAction } from "./zap-in.js";
import { createZapOutAction } from "./zap-out.js";
import { createZapMigrateAction } from "./zap-migrate.js";

export function createZapSubcommand(): Command {
  const zap = new Command("zap")
    .description("Liquidity provisioning via KyberSwap ZaaS (Zap In/Out/Migrate)")
    .exitOverride();

  zap.addCommand(createZapSearchAction());
  zap.addCommand(createZapInAction());
  zap.addCommand(createZapOutAction());
  zap.addCommand(createZapMigrateAction());

  return zap;
}
