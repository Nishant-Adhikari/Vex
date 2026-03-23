/**
 * `echoclaw kyberswap limit-order` — subcommand assembly.
 */

import { Command } from "commander";
import { createLimitOrderCreateAction } from "./limit-order-create.js";
import { createLimitOrderListAction } from "./limit-order-list.js";
import { createLimitOrderCancelAction, createLimitOrderHardCancelAction } from "./limit-order-cancel.js";

export function createLimitOrderSubcommand(): Command {
  const lo = new Command("limit-order")
    .description("Gasless limit orders via KyberSwap (EIP-712 signed, off-chain relay)")
    .exitOverride();

  lo.addCommand(createLimitOrderCreateAction());
  lo.addCommand(createLimitOrderListAction());
  lo.addCommand(createLimitOrderCancelAction());
  lo.addCommand(createLimitOrderHardCancelAction());

  return lo;
}
