/**
 * Quick-action chips shown in the agent-mode composer (extracted from
 * `SessionComposer.tsx` to keep that file under the size budget). Pure data —
 * each chip seeds the draft with a prompt. Hidden in mission mode.
 */

import type { IconSvgElement } from "@hugeicons/react";
import {
  BitcoinWalletIcon,
  BridgeIcon,
  ChartCandlestickIcon,
  Exchange01Icon,
  Knowledge01Icon,
  Search01Icon,
} from "@hugeicons/core-free-icons";

export interface QuickAction {
  readonly label: string;
  readonly prompt: string;
  readonly icon: IconSvgElement;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  {
    label: "Swap",
    prompt:
      "Swap USDC to ETH with tight slippage and explain the route before execution.",
    icon: Exchange01Icon,
  },
  {
    label: "Bridge",
    prompt:
      "Bridge funds to Base and check fees before proposing the transaction.",
    icon: BridgeIcon,
  },
  {
    label: "Open position",
    prompt:
      "Open a small BTC perp position only after risk and liquidation checks.",
    icon: ChartCandlestickIcon,
  },
  {
    label: "Research token",
    prompt: "Research $TAO and summarize catalysts, liquidity, and on-chain risk.",
    icon: Search01Icon,
  },
  {
    label: "Portfolio check",
    prompt: "Check portfolio exposure across chains and flag urgent risks.",
    icon: BitcoinWalletIcon,
  },
  {
    label: "Save knowledge",
    prompt:
      "Save the current MEV protection notes into the local knowledge base.",
    icon: Knowledge01Icon,
  },
];
