/**
 * Pendle broadcast fund-safety extractor (LOCKED G2#1 — calldata intent binding,
 * FULL ABI decode per Codex final review).
 *
 * Before ANY Pendle broadcast, the chosen Convert route is validated against the
 * caller's intent. Nothing is signed unless EVERY check passes; a failure throws
 * `PENDLE_UNSAFE_TX` (our own fixed text — the upstream body never leaks here).
 *
 * Checks (fail → ZERO approve, ZERO send):
 *   1. Router pin       : tx.to === PENDLE_ROUTER (checksummed).
 *   2. Sender bind      : tx.from absent OR equals the session wallet.
 *   3. Value bind       : tx.value present+non-zero ONLY for native input; the
 *                         value must equal the input amount. Non-native → absent/0.
 *   4. Approvals bind   : requiredApprovals EXACTLY match the expected set and
 *                         contain NOTHING else — buy/sell AND py-mint: the single
 *                         input token at the input amount (native → empty);
 *                         redeem AND py-redeem: the {YT, PT} pair (Convert asks
 *                         both), each at the input amount. Spender is IMPLICIT =
 *                         the pinned Router.
 *   5. Calldata bind    : FULL `decodeFunctionData` against the complete Router
 *                         ABI (structs from IPAllActionTypeV3) and assert EVERY
 *                         intent-relevant param:
 *                           - the method is valid for the action,
 *                           - decoded receiver == the session wallet,
 *                           - decoded market/YT == the quoted market/YT,
 *                           - the ACTUAL spend inside the dynamic tuples binds:
 *                             buy  → TokenInput.tokenIn == the intent input token
 *                                    (zero address for native) AND
 *                                    TokenInput.netTokenIn == the input wei,
 *                             sell → exactPtIn == the input wei AND
 *                                    TokenOutput.tokenOut == the quoted output,
 *                             redeem → netPyIn == the input wei AND (for
 *                                    redeemPyToToken) TokenOutput.tokenOut ==
 *                                    the quoted output.
 *                         The echoed contractParamInfo is cross-checked against
 *                         the DECODED values so a spoofed echo is caught too.
 */

import { decodeFunctionData, getAddress, type Address, type Hex } from "viem";

import { VexError, ErrorCodes } from "../../../../errors.js";
import {
  PENDLE_CLAIM_ABI,
  PENDLE_NATIVE_TOKEN,
  PENDLE_ROUTER,
  PENDLE_ROUTER_ABI,
  PENDLE_SWAP_HELPER,
  type PendleRouterMethod,
} from "@tools/pendle/constants.js";
import type {
  PendleClaimResponse,
  PendleConvertResponse,
  PendleConvertRoute,
} from "@tools/pendle/types.js";

export type PendleAction =
  | "buy"
  | "sell"
  | "yt-buy"
  | "yt-sell"
  | "redeem"
  // PY mint (token → PT+YT) and PRE-EXPIRY PY redeem (PT+YT → token). Distinct
  // from the matured-PT `redeem` (PT only, redeemPyToToken OR redeemPyToSy):
  // py-redeem is redeemPyToToken ONLY and burns an EQUAL PT+YT pair (approves
  // both), while py-mint acquires the pair (approves only the input token).
  | "py-mint"
  | "py-redeem"
  // LP single-token add (token → LP) and remove (LP → token). Both bind arg1 ==
  // the MARKET (which IS the LP token). Add approves the INPUT token and carries
  // a TokenInput (like a buy); remove approves the LP/MARKET token and carries a
  // TokenOutput (like a sell), with the LP amount as the actual spend.
  | "lp-add"
  | "lp-remove";

export interface PendleTxIntent {
  action: PendleAction;
  /** Session wallet — the ONLY allowed receiver + sender. */
  wallet: Address;
  /** Input token (native sentinel for native ETH input). */
  inputToken: Address;
  /** Input amount in wei (matches Convert `inputs[0].amount`). */
  inputAmountWei: bigint;
  isNative: boolean;
  /** Buy/sell: the PT's canonical market. Asserted against the decoded market. */
  expectedMarket?: Address;
  /** Redeem: the PT's canonical YT. Asserted against the decoded YT. */
  expectedYt?: Address;
  /** PT contract — part of the redeem approval set. */
  ptAddress?: Address;
  /** Sell/redeem: the quoted output token — asserted against TokenOutput.tokenOut. */
  expectedOutputToken?: Address;
}

/** Method(s) a given action may legitimately carry. */
const ACTION_METHODS: Record<PendleAction, readonly PendleRouterMethod[]> = {
  buy: ["swapExactTokenForPt"],
  sell: ["swapExactPtForToken"],
  // YT buy/sell reuse the PT swap-route validation with their own methods
  // (IPActionSwapYTV3 — identical ApproxParams/TokenInput/TokenOutput layout).
  "yt-buy": ["swapExactTokenForYt"],
  "yt-sell": ["swapExactYtForToken"],
  redeem: ["redeemPyToToken", "redeemPyToSy"],
  // PY mint is mintPyFromToken ONLY; pre-expiry PY redeem is redeemPyToToken ONLY
  // (never the SY fallback — that is the matured-PT `redeem` path).
  "py-mint": ["mintPyFromToken"],
  "py-redeem": ["redeemPyToToken"],
  // LP single-token add/remove each carry their OWN method (never a swap).
  "lp-add": ["addLiquiditySingleToken"],
  "lp-remove": ["removeLiquiditySingleToken"],
};

function unsafe(reason: string): never {
  throw new VexError(
    ErrorCodes.PENDLE_UNSAFE_TX,
    `Pendle refused to sign: ${reason}.`,
    "The quoted transaction did not match the requested trade. Re-quote and retry; do not approve.",
  );
}

/** Try to checksum an address; unsafe() on a malformed value. */
function requireAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    return unsafe(`${label} is not a valid address`);
  }
}

// ── Full calldata decode ────────────────────────────────────────────

interface TokenTupleBind {
  /** TokenInput.tokenIn or TokenOutput.tokenOut. */
  token: Address;
}

export interface DecodedRouterCall {
  method: PendleRouterMethod;
  /** Where the proceeds land (arg 0 on all four methods). */
  receiver: Address;
  /** Market (buy/sell) or YT (redeem) — arg 1 on all four methods. */
  marketOrYt: Address;
  /**
   * The ACTUAL spend amount the Router will pull: TokenInput.netTokenIn (buy),
   * exactPtIn (sell), netPyIn (redeem).
   */
  spendWei: bigint;
  /** Buy: the decoded TokenInput.tokenIn (zero address for native). */
  input?: TokenTupleBind;
  /** Sell / redeemPyToToken: the decoded TokenOutput.tokenOut. */
  output?: TokenTupleBind;
}

/**
 * FULL-decode a Pendle Router call. An unknown selector, a truncated body, or a
 * layout that does not decode against the complete ABI → unsafe. Returns the
 * normalized intent-relevant params. (ABI selectors are pinned by tests that
 * decode LIVE-probed calldata.)
 */
/**
 * The convert body always sends `useLimitOrder: false`, so a route's decoded
 * `limit` tuple must carry ZERO fills — injected maker-order fills would change
 * the tx/approval semantics behind the quote (Codex hardening: pins the
 * "maker limit orders excluded" posture at the calldata level, not just the
 * request body).
 */
function assertNoLimitFills(args: readonly unknown[], index: number): void {
  const limit = args[index] as { normalFills: readonly unknown[]; flashFills: readonly unknown[] };
  if (limit.normalFills.length !== 0 || limit.flashFills.length !== 0) {
    unsafe("route carries limit-order fills — useLimitOrder is disabled");
  }
}

export function decodeRouterCall(data: string): DecodedRouterCall {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data)) {
    return unsafe("transaction calldata is malformed");
  }
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: PENDLE_ROUTER_ABI, data: data as Hex }) as {
      functionName: string;
      args: readonly unknown[];
    };
  } catch {
    return unsafe("transaction does not decode as a known Router method");
  }
  const args = decoded.args;
  const receiver = getAddress(args[0] as string);
  const marketOrYt = getAddress(args[1] as string);

  switch (decoded.functionName) {
    case "swapExactTokenForPt":
    case "swapExactTokenForYt": {
      // Both carry the TokenInput at arg 4 with the same layout — bind the
      // actual netTokenIn spend + the input token.
      assertNoLimitFills(args, 5);
      const input = args[4] as { tokenIn: string; netTokenIn: bigint };
      return {
        method: decoded.functionName as PendleRouterMethod,
        receiver,
        marketOrYt,
        spendWei: input.netTokenIn,
        input: { token: getAddress(input.tokenIn) },
      };
    }
    case "swapExactPtForToken":
    case "swapExactYtForToken": {
      // Both carry exactPtIn/exactYtIn at arg 2 and the TokenOutput at arg 3.
      assertNoLimitFills(args, 4);
      const output = args[3] as { tokenOut: string };
      return {
        method: decoded.functionName as PendleRouterMethod,
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
        output: { token: getAddress(output.tokenOut) },
      };
    }
    case "mintPyFromToken": {
      // mintPyFromToken(receiver, YT, minPyOut, TokenInput) — the TokenInput is at
      // arg 3 (no ApproxParams/guess tuple), and arg 1 is the YT. Bind the actual
      // netTokenIn spend + the input token, like the token→PT/YT buys.
      const input = args[3] as { tokenIn: string; netTokenIn: bigint };
      return {
        method: "mintPyFromToken",
        receiver,
        marketOrYt,
        spendWei: input.netTokenIn,
        input: { token: getAddress(input.tokenIn) },
      };
    }
    case "redeemPyToToken": {
      const output = args[3] as { tokenOut: string };
      return {
        method: "redeemPyToToken",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
        output: { token: getAddress(output.tokenOut) },
      };
    }
    case "redeemPyToSy":
      return {
        method: "redeemPyToSy",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
      };
    case "addLiquiditySingleToken": {
      // addLiquiditySingleToken(receiver, market, minLpOut, guessPtReceivedFromSy,
      // input(TokenInput), limit) — the TokenInput is at arg 4 (after the
      // ApproxParams guess tuple). Bind the actual netTokenIn spend + input token,
      // like the token→PT/YT buys; arg1 is the MARKET (== the LP token).
      assertNoLimitFills(args, 5);
      const input = args[4] as { tokenIn: string; netTokenIn: bigint };
      return {
        method: "addLiquiditySingleToken",
        receiver,
        marketOrYt,
        spendWei: input.netTokenIn,
        input: { token: getAddress(input.tokenIn) },
      };
    }
    case "removeLiquiditySingleToken": {
      // removeLiquiditySingleToken(receiver, market, netLpToRemove, output(TokenOutput),
      // limit) — arg2 is the ACTUAL LP burned and the TokenOutput at arg 3 carries
      // the quoted output token; arg1 is the MARKET (the LP being redeemed).
      assertNoLimitFills(args, 4);
      const output = args[3] as { tokenOut: string };
      return {
        method: "removeLiquiditySingleToken",
        receiver,
        marketOrYt,
        spendWei: args[2] as bigint,
        output: { token: getAddress(output.tokenOut) },
      };
    }
    default:
      return unsafe("transaction calls an unknown Router method");
  }
}

// ── Approval-set binding ────────────────────────────────────────────

function assertApprovals(intent: PendleTxIntent, response: PendleConvertResponse): void {
  const approvals = response.requiredApprovals;
  const amount = intent.inputAmountWei.toString();

  // Matured redeem AND pre-expiry py-redeem burn the PT+YT pair, so Convert asks
  // for allowances on BOTH — the set must be EXACTLY {YT, PT}, each at the input
  // amount, and nothing else.
  if (intent.action === "redeem" || intent.action === "py-redeem") {
    const yt = intent.expectedYt ? getAddress(intent.expectedYt) : null;
    const pt = intent.ptAddress ? getAddress(intent.ptAddress) : null;
    if (!yt || !pt) return unsafe("redeem approval check missing PT/YT");
    const allowed = new Set([yt, pt]);
    const seen = new Set<string>();
    for (const a of approvals) {
      const token = requireAddress(a.token, "approval token");
      if (!allowed.has(token)) return unsafe("an approval targets an unexpected token");
      if (seen.has(token)) return unsafe("duplicate approval token");
      if (a.amount !== amount) return unsafe("an approval amount does not match the input");
      seen.add(token);
    }
    return;
  }

  // Buy/sell AND py-mint: native input needs no approval; otherwise EXACTLY one,
  // for the input token, at the input amount, and nothing else.
  if (intent.isNative) {
    if (approvals.length !== 0) return unsafe("native input must not require any token approval");
    return;
  }
  if (approvals.length !== 1) return unsafe("expected exactly one token approval");
  const only = approvals[0]!;
  if (requireAddress(only.token, "approval token") !== getAddress(intent.inputToken)) {
    return unsafe("the approval targets a token other than the input");
  }
  if (only.amount !== amount) return unsafe("the approval amount does not match the input");
}

// ── Route validation ────────────────────────────────────────────────

/**
 * Validate ONE Convert route against the intent. Returns the route when safe;
 * throws `PENDLE_UNSAFE_TX` otherwise. `response` carries the requiredApprovals
 * (approvals are response-level, not per-route).
 */
export function assertRouteSafe(
  intent: PendleTxIntent,
  response: PendleConvertResponse,
  route: PendleConvertRoute,
): PendleConvertRoute {
  // 1. Router pin.
  if (requireAddress(route.tx.to, "tx.to") !== PENDLE_ROUTER) {
    return unsafe("transaction target is not the pinned Pendle Router");
  }

  // 2. Sender bind.
  if (route.tx.from !== null && route.tx.from !== "") {
    if (requireAddress(route.tx.from, "tx.from") !== getAddress(intent.wallet)) {
      return unsafe("transaction sender is not the session wallet");
    }
  }

  // 3. Value bind. A missing/empty value (some responses omit it) is zero native.
  const rawValue = route.tx.value;
  const value = typeof rawValue === "string" && rawValue !== "" ? BigInt(rawValue) : 0n;
  if (intent.isNative) {
    if (value !== intent.inputAmountWei) return unsafe("native value does not match the input amount");
  } else if (value !== 0n) {
    return unsafe("a non-native trade must not send native value");
  }

  // 4. Approvals bind (response-level).
  assertApprovals(intent, response);

  // 5. Calldata bind — FULL decode; every intent-relevant param asserted.
  const call = decodeRouterCall(route.tx.data);
  if (!ACTION_METHODS[intent.action].includes(call.method)) {
    return unsafe(`transaction method ${call.method} is not valid for a ${intent.action}`);
  }
  if (call.receiver !== getAddress(intent.wallet)) {
    return unsafe("transaction receiver is not the session wallet");
  }
  // Redeem, py-redeem AND py-mint all carry the YT at arg 1 (mint/redeem operate
  // on the market's YT, not the market/LP address); the swaps AND the LP add/remove
  // carry the market at arg 1, bound against intent.expectedMarket.
  const bindsYt =
    intent.action === "redeem" || intent.action === "py-redeem" || intent.action === "py-mint";
  const expectedTarget = bindsYt ? intent.expectedYt : intent.expectedMarket;
  if (expectedTarget && call.marketOrYt !== getAddress(expectedTarget)) {
    return unsafe(
      bindsYt
        ? "transaction YT does not match the position"
        : "transaction market does not match the quote",
    );
  }

  // The ACTUAL spend inside the calldata must equal the intent amount — an
  // inflated netTokenIn/exactPtIn/netPyIn can never reach a signature.
  if (call.spendWei !== intent.inputAmountWei) {
    return unsafe("transaction spend amount does not match the quoted input");
  }
  // Buy (PT or YT), py-mint AND lp-add: the tuple's spend token must be the intent
  // input (zero addr for native). swapExactTokenForPt, swapExactTokenForYt,
  // mintPyFromToken and addLiquiditySingleToken all carry TokenInput.
  if (
    call.method === "swapExactTokenForPt" ||
    call.method === "swapExactTokenForYt" ||
    call.method === "mintPyFromToken" ||
    call.method === "addLiquiditySingleToken"
  ) {
    const expectedIn = intent.isNative ? PENDLE_NATIVE_TOKEN : getAddress(intent.inputToken);
    if (!call.input || call.input.token !== expectedIn) {
      return unsafe("transaction input token does not match the quoted input");
    }
  }
  // Sell / redeemPyToToken / lp-remove: the tuple's output token must be the
  // quoted output (removeLiquiditySingleToken also carries a TokenOutput).
  if (call.output && intent.expectedOutputToken) {
    if (call.output.token !== getAddress(intent.expectedOutputToken)) {
      return unsafe("transaction output token does not match the quote");
    }
  }

  // Cross-check the echoed contractParamInfo against the DECODED values so a
  // spoofed echo cannot mislead downstream logging/UX.
  const params = route.contractParamInfo.contractCallParams;
  const echoReceiver = typeof params[0] === "string" ? params[0] : "";
  const echoTarget = typeof params[1] === "string" ? params[1] : "";
  if (echoReceiver !== "" && requireAddress(echoReceiver, "echoed receiver") !== call.receiver) {
    return unsafe("echoed receiver disagrees with the calldata");
  }
  if (echoTarget !== "" && requireAddress(echoTarget, "echoed market/YT") !== call.marketOrYt) {
    return unsafe("echoed market/YT disagrees with the calldata");
  }

  return route;
}

/**
 * Pick the SAFEST usable route from a Convert response for the intent: the first
 * route (best-ranked by Pendle) that passes every fund-safety check. Throws
 * `PENDLE_UNSAFE_TX` when none is safe (never falls back to an unchecked route).
 */
export function selectSafeRoute(
  intent: PendleTxIntent,
  response: PendleConvertResponse,
): PendleConvertRoute {
  let lastErr: unknown;
  for (const route of response.routes) {
    try {
      return assertRouteSafe(intent, response, route);
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr instanceof VexError) throw lastErr;
  return unsafe("no route passed the fund-safety checks");
}

// ── Claim (income sweep) fund-safety binding ─────────────────────────
//
// `pendle.claim` calls `redeemDueInterestAndRewardsV2` (IPActionMiscV3), whose
// response is FLAT (no routes[]) and whose calldata has NO `receiver` arg —
// every output lands on msg.sender by protocol (SOURCE-verified 2026-07-06:
// pendle-core-v2-public ActionMiscV3.sol:92-130). Execution facts the binding
// rests on:
//   - `swaps == []` → the NoSwap path; `pendleSwap` is NEVER used there
//     (ActionMiscV3.sol:99-103) — still pinned as defense-in-depth.
//   - Per YT tuple: `yt.redeemDueInterestAndRewards(msg.sender, doRedeemInterest,
//     doRedeemRewards)`; when interest accrued, the Router `_transferFrom`s the
//     freshly-redeemed SY from the wallet and calls `SY.redeem(msg.sender, …,
//     tokenRedeemSy, minTokenRedeemOut, true)` (ActionMiscV3.sol:117-126). So a
//     REAL claim with accrued interest legitimately requires an EXACT allowance
//     on the market's own SY (LIVE-verified with populated holder probes), and
//     `tokenRedeemSy` selects the redemption token.
// Binding (fail → ZERO approve, ZERO send):
//   tx.to == Router; tx.from absent-or-wallet; value == 0; `SYs`/`swaps` EMPTY;
//   `pendleSwap` ∈ {zero, PENDLE_SWAP_HELPER}; every YT tuple: yt ⊆ intended,
//   NOT a no-op (at least one redeem flag), tokenRedeemSy == the market's
//   underlyingAsset from OUR chain-scoped lookup (never the response);
//   `minTokenRedeemOut` is the SDK's slippage PROTECTION on an output that goes
//   to msg.sender — decoded but not value-bound (forcing 0 would REMOVE the
//   protection); markets ⊆ intended; every approval token must be the SY of a
//   decoded tuple with doRedeemInterest, amount a positive integer, no
//   duplicates (granted exactly, Router-pinned, by the handler).

/** Per-YT bind material resolved from OUR market lookup (lowercase addresses). */
export interface PendleClaimYtBind {
  /** The market's underlyingAsset — the ONLY allowed tokenRedeemSy. */
  readonly tokenRedeemSy: string;
  /** The market's SY — the ONLY token an interest claim may approve. */
  readonly sy: string;
}

export interface PendleClaimIntent {
  /** Session wallet — the only allowed sender (funds land here by protocol). */
  wallet: Address;
  /** Lowercase YT address → its bind material (the wallet's held YT markets). */
  intendedYts: ReadonlyMap<string, PendleClaimYtBind>;
  /** Lowercase market addresses the wallet intends to claim LP rewards from. */
  intendedMarkets: ReadonlySet<string>;
}

/** One decoded RedeemYtIncomeToTokenStruct (IPAllActionTypeV3.sol:134-140). */
export interface DecodedClaimYt {
  yt: Address;
  doRedeemInterest: boolean;
  doRedeemRewards: boolean;
  tokenRedeemSy: Address;
  minTokenRedeemOut: bigint;
}

/** The effective (server-pruned) claim set the Router will actually sweep. */
export interface DecodedClaimCall {
  yts: DecodedClaimYt[];
  markets: Address[];
  pendleSwap: Address;
}

/**
 * FULL-decode a claim call against `PENDLE_CLAIM_ABI`. An unknown selector or a
 * layout that does not decode → unsafe. Asserts the pure-sweep invariants that
 * are NOT position-specific: `SYs` empty, `swaps` empty, `pendleSwap` known.
 * Returns the decoded YT tuples + market list for the position-specific binds.
 */
export function decodeClaimCall(data: string): DecodedClaimCall {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data)) {
    return unsafe("claim calldata is malformed");
  }
  let decoded: { functionName: string; args: readonly unknown[] };
  try {
    decoded = decodeFunctionData({ abi: PENDLE_CLAIM_ABI, data: data as Hex }) as {
      functionName: string;
      args: readonly unknown[];
    };
  } catch {
    return unsafe("claim does not decode as redeemDueInterestAndRewardsV2");
  }
  if (decoded.functionName !== "redeemDueInterestAndRewardsV2") {
    return unsafe("claim calls an unexpected Router method");
  }
  const sys = decoded.args[0] as readonly string[];
  const ytStructs = decoded.args[1] as readonly {
    yt: string;
    doRedeemInterest: boolean;
    doRedeemRewards: boolean;
    tokenRedeemSy: string;
    minTokenRedeemOut: bigint;
  }[];
  const markets = decoded.args[2] as readonly string[];
  const pendleSwap = getAddress(decoded.args[3] as string);
  const swaps = decoded.args[4] as readonly unknown[];
  // The ONLY external-call/fund-routing surface is `swaps`; a pure claim has none.
  if (swaps.length !== 0) return unsafe("claim carries an external swap — not a pure income sweep");
  // The tool scopes to YT + LP income; a claim must never sweep SY interest.
  if (sys.length !== 0) return unsafe("claim carries an unexpected SY leg");
  // pendleSwap is source-proven inert when swaps == [] — pin it anyway.
  if (pendleSwap !== PENDLE_NATIVE_TOKEN && pendleSwap !== PENDLE_SWAP_HELPER) {
    return unsafe("claim uses an unverified pendleSwap helper");
  }
  return {
    yts: ytStructs.map((s) => ({
      yt: getAddress(s.yt),
      doRedeemInterest: s.doRedeemInterest === true,
      doRedeemRewards: s.doRedeemRewards === true,
      tokenRedeemSy: getAddress(s.tokenRedeemSy),
      minTokenRedeemOut: s.minTokenRedeemOut,
    })),
    markets: markets.map((m) => getAddress(m)),
    pendleSwap,
  };
}

/**
 * Validate a claim response against the intent. Returns the decoded (effective)
 * claim set when safe; throws `PENDLE_UNSAFE_TX` otherwise. Nothing is signed
 * unless EVERY check passes.
 */
export function assertClaimSafe(
  intent: PendleClaimIntent,
  response: PendleClaimResponse,
): DecodedClaimCall {
  // 1. Router pin.
  if (requireAddress(response.tx.to, "tx.to") !== PENDLE_ROUTER) {
    return unsafe("claim target is not the pinned Pendle Router");
  }
  // 2. Sender bind.
  if (response.tx.from !== null && response.tx.from !== "") {
    if (requireAddress(response.tx.from, "tx.from") !== getAddress(intent.wallet)) {
      return unsafe("claim sender is not the session wallet");
    }
  }
  // 3. Value bind — a claim never sends native value. Missing/empty → zero.
  const rawValue = response.tx.value;
  const value = typeof rawValue === "string" && rawValue !== "" ? BigInt(rawValue) : 0n;
  if (value !== 0n) return unsafe("a claim must not send native value");

  // 4. Calldata bind — decode + pure-sweep invariants (SYs/swaps/pendleSwap).
  const call = decodeClaimCall(response.tx.data);

  // 5. Per-tuple bind — yt ⊆ intended, no no-op tuples, tokenRedeemSy == OUR
  //    resolved underlyingAsset (a divergent redemption token → BLOCK).
  for (const tuple of call.yts) {
    const bind = intent.intendedYts.get(tuple.yt.toLowerCase());
    if (!bind) return unsafe("claim includes a YT outside the intended positions");
    if (!tuple.doRedeemInterest && !tuple.doRedeemRewards) {
      return unsafe("claim includes a no-op YT tuple");
    }
    if (tuple.tokenRedeemSy.toLowerCase() !== bind.tokenRedeemSy) {
      return unsafe("claim redeems interest into an unexpected token");
    }
  }
  // 6. Market subset bind.
  for (const market of call.markets) {
    if (!intent.intendedMarkets.has(market.toLowerCase())) return unsafe("claim includes a market outside the intended positions");
  }

  // 7. Approvals bind — a real interest claim legitimately approves the market's
  //    own SY (the Router pulls the freshly-redeemed SY interest — source), so
  //    the allowed set is EXACTLY the SYs of decoded tuples with doRedeemInterest.
  //    Anything else, a duplicate, or a non-positive amount → BLOCK. The handler
  //    grants each exactly (spender hard-pinned to the Router downstream).
  const allowedSys = new Set<string>();
  for (const tuple of call.yts) {
    if (!tuple.doRedeemInterest) continue;
    const bind = intent.intendedYts.get(tuple.yt.toLowerCase());
    if (bind) allowedSys.add(bind.sy);
  }
  const seen = new Set<string>();
  for (const approval of response.tokenApprovals) {
    const token = requireAddress(approval.token, "claim approval token").toLowerCase();
    if (!allowedSys.has(token)) return unsafe("a claim approval targets a token outside the intended SYs");
    if (seen.has(token)) return unsafe("duplicate claim approval token");
    if (!/^[0-9]+$/.test(approval.amount) || BigInt(approval.amount) <= 0n) {
      return unsafe("a claim approval amount is not a positive integer");
    }
    seen.add(token);
  }
  return call;
}
