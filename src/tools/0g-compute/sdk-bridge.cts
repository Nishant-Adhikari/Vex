/**
 * CJS bridge module — ethers resolves to lib.commonjs here, matching SDK types.
 * This eliminates the #private nominal type mismatch between ESM and CJS Wallet.
 *
 * All parameters are plain strings — no ethers types cross the ESM/CJS boundary.
 *
 * Consumer contract: ESM callers use a CJS-default-import + destructure —
 *   `import sdkBridge from "./sdk-bridge.cjs"; const { createBrokerFromKey } = sdkBridge;`
 * Named `import { createBrokerFromKey } from "./sdk-bridge.cjs"` is NOT safe
 * because Node's cjs-module-lexer does not reliably detect named exports when
 * tsx transpiles `.cts` on-the-fly. Keep these as named exports — do NOT switch
 * to `export default { ... }`; the dist build (`sdk-bridge.cjs`) still uses
 * `exports.foo = foo`, and the ESM-side default synthesis picks it up via
 * `module.exports`.
 */

import { Wallet, JsonRpcProvider } from "ethers";
import { createZGComputeNetworkBroker } from "@0glabs/0g-serving-broker";

export async function createBrokerFromKey(
  privateKey: string,
  rpcUrl: string
) {
  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return createZGComputeNetworkBroker(wallet);
}
