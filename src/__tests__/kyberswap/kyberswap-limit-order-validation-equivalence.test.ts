/**
 * Equivalence battery for the Zod conversion of the KyberSwap Limit Order
 * response validators (codex-002 Phase 2, full uniformity).
 *
 * Each assertion is derived from the ORIGINAL hand-written behaviour:
 *   - root-type mismatches throw a PLAIN `Error` with the exact original message
 *     (NOT a VexError);
 *   - required field failures throw `VexError(KYBER_API_ERROR, "Invalid
 *     KyberSwap Limit Order response: missing <field>")`;
 *   - optional/defaulting fields never throw and reproduce the exact default;
 *   - numeric fields (asNumber) ACCEPT ±Infinity but REJECT NaN (proves the
 *     conversion did not regress to Zod 4 `z.number()`, which rejects Infinity);
 *   - arrays are filtered element-wise (good elements kept).
 *
 * The pre-existing test file (kyberswap-limit-order-validation.test.ts) stays
 * green and is not modified.
 */

import { describe, it, expect } from "vitest";
import { VexError, ErrorCodes } from "../../errors.js";
import {
  validateEip712Message,
  validateOrdersResponse,
  validateCreateOrderResponse,
  validateActiveMakingAmount,
  validateOperatorSignature,
  validateEncodedCalldata,
  validateTradingPairsResponse,
  validateContractAddressResponse,
} from "@tools/kyberswap/limit-order/validation.js";

const KYBER = ErrorCodes.KYBER_API_ERROR;

/** Assert the thrown value is a PLAIN Error (not VexError) with an exact message. */
function expectPlainError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect(thrown).not.toBeInstanceOf(VexError);
  expect((thrown as Error).message).toBe(message);
}

/** Assert the thrown value is a VexError(KYBER_API_ERROR) with an exact message. */
function expectVexError(fn: () => unknown, message: string): void {
  let thrown: unknown;
  try {
    fn();
  } catch (e) {
    thrown = e;
  }
  expect(thrown).toBeInstanceOf(VexError);
  expect((thrown as VexError).code).toBe(KYBER);
  expect((thrown as VexError).message).toBe(message);
}

// ───────────────────────────────────────────────────────────────────────────
// validateEip712Message
// ───────────────────────────────────────────────────────────────────────────

describe("validateEip712Message — equivalence", () => {
  const VALID = {
    domain: {
      name: "KyberSwap",
      version: "1",
      chainId: 137,
      verifyingContract: "0xcab2FA2eeab7065B45CBcF6E3936dDE2506b4f6C",
    },
    types: { Order: [{ name: "makerAsset", type: "address" }] },
    primaryType: "Order",
    message: { salt: "12345", makerAsset: "0xabc", extra: { nested: true } },
  };

  it("root non-record → plain Error 'Expected EIP-712 message object'", () => {
    expectPlainError(() => validateEip712Message(null), "Expected EIP-712 message object");
    expectPlainError(() => validateEip712Message([1, 2]), "Expected EIP-712 message object");
    expectPlainError(() => validateEip712Message("x"), "Expected EIP-712 message object");
  });

  it("non-record message → plain Error 'EIP-712 message.message must be an object'", () => {
    expectPlainError(
      () => validateEip712Message({ ...VALID, message: "nope" }),
      "EIP-712 message.message must be an object",
    );
    // missing message is undefined → non-record
    expectPlainError(
      () => validateEip712Message({ domain: VALID.domain, types: {} }),
      "EIP-712 message.message must be an object",
    );
  });

  it("domain non-record → plain Error 'EIP-712 domain must be an object'", () => {
    expectPlainError(
      () => validateEip712Message({ ...VALID, domain: 42 }),
      "EIP-712 domain must be an object",
    );
  });

  it("domain field failures → VexError with field-path message", () => {
    expectVexError(
      () => validateEip712Message({ ...VALID, domain: { ...VALID.domain, name: "" } }),
      "Invalid KyberSwap Limit Order response: missing domain.name",
    );
    expectVexError(
      () => validateEip712Message({ ...VALID, domain: { ...VALID.domain, chainId: "137" } }),
      "Invalid KyberSwap Limit Order response: missing domain.chainId",
    );
  });

  it("missing primaryType → VexError missing primaryType", () => {
    const { primaryType, ...rest } = VALID;
    expectVexError(
      () => validateEip712Message(rest),
      "Invalid KyberSwap Limit Order response: missing primaryType",
    );
  });

  it("missing message.salt → VexError missing message.salt", () => {
    expectVexError(
      () => validateEip712Message({ ...VALID, message: { makerAsset: "0xabc" } }),
      "Invalid KyberSwap Limit Order response: missing message.salt",
    );
  });

  it("domain.chainId accepts Infinity (asNumber, NOT z.number())", () => {
    const result = validateEip712Message({
      ...VALID,
      domain: { ...VALID.domain, chainId: Infinity },
    });
    expect(result.domain.chainId).toBe(Infinity);
  });

  it("domain.chainId rejects NaN", () => {
    expectVexError(
      () => validateEip712Message({ ...VALID, domain: { ...VALID.domain, chainId: NaN } }),
      "Invalid KyberSwap Limit Order response: missing domain.chainId",
    );
  });

  it("preserves types default {} and all message keys + salt override", () => {
    const { types, ...noTypes } = VALID;
    const result = validateEip712Message(noTypes);
    expect(result.types).toEqual({});

    const full = validateEip712Message(VALID);
    expect(full.message.salt).toBe("12345");
    // extra message keys are preserved verbatim (spread of message)
    expect(full.message.makerAsset).toBe("0xabc");
    expect(full.message.extra).toEqual({ nested: true });
    expect(full.types).toEqual({ Order: [{ name: "makerAsset", type: "address" }] });
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateOrdersResponse / parseOrder
// ───────────────────────────────────────────────────────────────────────────

describe("validateOrdersResponse — equivalence", () => {
  const ORDER = {
    id: 1,
    chainId: "137",
    makerAsset: "0x1",
    takerAsset: "0x2",
    maker: "0x3",
    makingAmount: "100",
    takingAmount: "200",
    filledMakingAmount: "5",
    filledTakingAmount: "6",
    status: "active",
    expiredAt: 9999999999,
    salt: "salt",
    signature: "sig",
    createdAt: "2024-01-01",
    updatedAt: "2024-01-02",
    makerAssetSymbol: "AAA",
    takerAssetSymbol: "BBB",
    makerAssetDecimals: 18,
    takerAssetDecimals: 6,
  };

  it("parses { orders: [...] } envelope and a bare array", () => {
    expect(validateOrdersResponse({ orders: [ORDER] })).toHaveLength(1);
    expect(validateOrdersResponse([ORDER])).toHaveLength(1);
  });

  it("full valid order maps every field", () => {
    const [o] = validateOrdersResponse([ORDER]);
    expect(o).toEqual(ORDER);
  });

  it("record with non-array orders + non-array root → plain Error 'Expected orders response'", () => {
    expectPlainError(() => validateOrdersResponse({ orders: "nope" }), "Expected orders response");
    expectPlainError(() => validateOrdersResponse(null), "Expected orders response");
    expectPlainError(() => validateOrdersResponse("x"), "Expected orders response");
  });

  it("filled amounts default to '0' when not strings; decimals default to undefined", () => {
    const { filledMakingAmount, filledTakingAmount, makerAssetDecimals, takerAssetDecimals, ...partial } =
      ORDER;
    const [o] = validateOrdersResponse([{ ...partial, filledMakingAmount: 5, filledTakingAmount: null }]);
    expect(o.filledMakingAmount).toBe("0");
    expect(o.filledTakingAmount).toBe("0");
    expect(o.makerAssetDecimals).toBeUndefined();
    expect(o.takerAssetDecimals).toBeUndefined();
  });

  it("optional symbols default to undefined when absent/empty", () => {
    const { makerAssetSymbol, takerAssetSymbol, ...partial } = ORDER;
    const [o] = validateOrdersResponse([{ ...partial, makerAssetSymbol: "" }]);
    expect(o.makerAssetSymbol).toBeUndefined();
    expect(o.takerAssetSymbol).toBeUndefined();
  });

  it("non-record element → plain Error 'order must be an object'", () => {
    expectPlainError(() => validateOrdersResponse([42]), "order must be an object");
    expectPlainError(() => validateOrdersResponse([null]), "order must be an object");
  });

  it("missing required string field → VexError (order.chainId), id evaluated first", () => {
    const { chainId, ...noChain } = ORDER;
    expectVexError(
      () => validateOrdersResponse([noChain]),
      "Invalid KyberSwap Limit Order response: missing order.chainId",
    );
    // id failure wins when both id and chainId are bad (declaration order)
    expectVexError(
      () => validateOrdersResponse([{ ...noChain, id: "x" }]),
      "Invalid KyberSwap Limit Order response: missing order.id",
    );
  });

  it("order.id / order.expiredAt accept Infinity but reject NaN", () => {
    const [oInf] = validateOrdersResponse([{ ...ORDER, id: Infinity, expiredAt: -Infinity }]);
    expect(oInf.id).toBe(Infinity);
    expect(oInf.expiredAt).toBe(-Infinity);
    expectVexError(
      () => validateOrdersResponse([{ ...ORDER, id: NaN }]),
      "Invalid KyberSwap Limit Order response: missing order.id",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateCreateOrderResponse
// ───────────────────────────────────────────────────────────────────────────

describe("validateCreateOrderResponse — equivalence", () => {
  it("uses id, then orderId fallback", () => {
    expect(validateCreateOrderResponse({ id: 42 })).toEqual({ orderId: 42 });
    expect(validateCreateOrderResponse({ orderId: 99 })).toEqual({ orderId: 99 });
    // id present takes precedence over orderId (?? short-circuits on defined)
    expect(validateCreateOrderResponse({ id: 1, orderId: 2 })).toEqual({ orderId: 1 });
  });

  it("non-record → plain Error 'Expected create order response'", () => {
    expectPlainError(() => validateCreateOrderResponse(null), "Expected create order response");
    expectPlainError(() => validateCreateOrderResponse([1]), "Expected create order response");
  });

  it("neither id nor orderId a number → VexError missing orderId", () => {
    expectVexError(
      () => validateCreateOrderResponse({}),
      "Invalid KyberSwap Limit Order response: missing orderId",
    );
    expectVexError(
      () => validateCreateOrderResponse({ id: "x" }),
      "Invalid KyberSwap Limit Order response: missing orderId",
    );
  });

  it("orderId accepts Infinity, rejects NaN", () => {
    expect(validateCreateOrderResponse({ id: Infinity })).toEqual({ orderId: Infinity });
    expectVexError(
      () => validateCreateOrderResponse({ id: NaN }),
      "Invalid KyberSwap Limit Order response: missing orderId",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateActiveMakingAmount
// ───────────────────────────────────────────────────────────────────────────

describe("validateActiveMakingAmount — equivalence", () => {
  it("activeMakingAmount, then data fallback", () => {
    expect(validateActiveMakingAmount({ activeMakingAmount: "500" })).toBe("500");
    expect(validateActiveMakingAmount({ data: "300" })).toBe("300");
    expect(validateActiveMakingAmount({ activeMakingAmount: "a", data: "b" })).toBe("a");
  });

  it("non-record → plain Error 'Expected active making amount response'", () => {
    expectPlainError(() => validateActiveMakingAmount(null), "Expected active making amount response");
  });

  it("neither field a non-empty string → VexError missing activeMakingAmount", () => {
    expectVexError(
      () => validateActiveMakingAmount({}),
      "Invalid KyberSwap Limit Order response: missing activeMakingAmount",
    );
    expectVexError(
      () => validateActiveMakingAmount({ activeMakingAmount: "" }),
      "Invalid KyberSwap Limit Order response: missing activeMakingAmount",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateOperatorSignature
// ───────────────────────────────────────────────────────────────────────────

describe("validateOperatorSignature — equivalence", () => {
  it("element-wise filter keeps strings, drops non-strings", () => {
    expect(validateOperatorSignature({ operatorSignatures: ["a", "b"] }).operatorSignatures).toEqual([
      "a",
      "b",
    ]);
    expect(
      validateOperatorSignature({ operatorSignatures: ["sig1", 42, null, "sig2"] }).operatorSignatures,
    ).toEqual(["sig1", "sig2"]);
  });

  it("missing / non-array operatorSignatures → []", () => {
    expect(validateOperatorSignature({}).operatorSignatures).toEqual([]);
    expect(validateOperatorSignature({ operatorSignatures: "x" }).operatorSignatures).toEqual([]);
  });

  it("non-record root → plain Error 'Expected operator signature response'", () => {
    expectPlainError(() => validateOperatorSignature(null), "Expected operator signature response");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateEncodedCalldata
// ───────────────────────────────────────────────────────────────────────────

describe("validateEncodedCalldata — equivalence", () => {
  it("parses encodedData and optional routerAddress", () => {
    expect(validateEncodedCalldata({ encodedData: "0xabc" })).toEqual({
      encodedData: "0xabc",
      routerAddress: undefined,
    });
    expect(
      validateEncodedCalldata({ encodedData: "0xabc", routerAddress: "0xrouter" }).routerAddress,
    ).toBe("0xrouter");
  });

  it("non-string / empty routerAddress → undefined (never throws on that field)", () => {
    expect(validateEncodedCalldata({ encodedData: "0xabc", routerAddress: 42 }).routerAddress).toBeUndefined();
    expect(validateEncodedCalldata({ encodedData: "0xabc", routerAddress: "" }).routerAddress).toBeUndefined();
  });

  it("non-record root → plain Error 'Expected encoded calldata response'", () => {
    expectPlainError(() => validateEncodedCalldata(null), "Expected encoded calldata response");
  });

  it("missing encodedData → VexError missing encodedData", () => {
    expectVexError(
      () => validateEncodedCalldata({}),
      "Invalid KyberSwap Limit Order response: missing encodedData",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateTradingPairsResponse / parseTradingPair
// ───────────────────────────────────────────────────────────────────────────

describe("validateTradingPairsResponse — equivalence", () => {
  const PAIR = { makerAsset: "0x1", takerAsset: "0x2", chainId: "1" };

  it("bare array, { pairs } envelope, { data } envelope", () => {
    expect(validateTradingPairsResponse([PAIR])).toEqual([PAIR]);
    expect(validateTradingPairsResponse({ pairs: [PAIR] })).toEqual([PAIR]);
    expect(validateTradingPairsResponse({ data: [{ ...PAIR, chainId: "56" }] })[0].chainId).toBe("56");
  });

  it("non-array/non-envelope record and non-record → plain Error 'Expected trading pairs response'", () => {
    expectPlainError(() => validateTradingPairsResponse("bad"), "Expected trading pairs response");
    expectPlainError(() => validateTradingPairsResponse({}), "Expected trading pairs response");
    expectPlainError(() => validateTradingPairsResponse({ pairs: "x" }), "Expected trading pairs response");
  });

  it("non-record element → plain Error 'trading pair must be an object'", () => {
    expectPlainError(() => validateTradingPairsResponse([42]), "trading pair must be an object");
  });

  it("missing pair field → VexError (pair.makerAsset first)", () => {
    const { makerAsset, ...noMaker } = PAIR;
    expectVexError(
      () => validateTradingPairsResponse([noMaker]),
      "Invalid KyberSwap Limit Order response: missing pair.makerAsset",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
// validateContractAddressResponse
// ───────────────────────────────────────────────────────────────────────────

describe("validateContractAddressResponse — equivalence", () => {
  it("keeps string values, drops non-string values element-wise", () => {
    const result = validateContractAddressResponse({ "1": "0xabc", "137": "0xdef", bad: 42, also: null });
    expect(result).toEqual({ "1": "0xabc", "137": "0xdef" });
  });

  it("empty record → {}", () => {
    expect(validateContractAddressResponse({})).toEqual({});
  });

  it("non-record root → plain Error 'Expected contract address response'", () => {
    expectPlainError(() => validateContractAddressResponse(null), "Expected contract address response");
    expectPlainError(() => validateContractAddressResponse([1, 2]), "Expected contract address response");
  });
});
