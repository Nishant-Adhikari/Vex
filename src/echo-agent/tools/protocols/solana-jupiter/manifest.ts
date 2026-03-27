/**
 * Solana/Jupiter protocol manifest — aggregates all module manifests.
 *
 * Each module has its own file in manifests/ for maintainability.
 * This file re-exports the combined array for the catalog.
 */

import type { ProtocolToolManifest } from "../types.js";
import { CORE_TOOLS } from "./manifests/core.js";
import { SWAP_TOOLS } from "./manifests/swap.js";
import { PERPS_TOOLS } from "./manifests/perps.js";
import { PREDICT_TOOLS } from "./manifests/predict.js";
import { DCA_TOOLS, LIMIT_TOOLS } from "./manifests/orders.js";
import { LEND_TOOLS } from "./manifests/lend.js";
import { STAKE_TOOLS } from "./manifests/stake.js";
import { SEND_TOOLS } from "./manifests/send.js";
import { STUDIO_TOOLS } from "./manifests/studio.js";
import { ACCOUNT_TOOLS } from "./manifests/account.js";
import { HISTORY_TOOLS } from "./manifests/history.js";

export const SOLANA_JUPITER_TOOLS: readonly ProtocolToolManifest[] = [
  ...CORE_TOOLS,
  ...SWAP_TOOLS,
  ...PERPS_TOOLS,
  ...PREDICT_TOOLS,
  ...DCA_TOOLS,
  ...LIMIT_TOOLS,
  ...LEND_TOOLS,
  ...STAKE_TOOLS,
  ...SEND_TOOLS,
  ...STUDIO_TOOLS,
  ...ACCOUNT_TOOLS,
  ...HISTORY_TOOLS,
];
