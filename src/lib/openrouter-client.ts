/**
 * Cross-boundary re-export of the OpenRouter SDK so vex-app (Electron
 * main) can construct a client via `@vex-lib/openrouter-client.js`
 * without dragging in the engine's `OpenRouterProvider` class — which
 * pulls `loadEnvConfig` + `@utils/logger.js` + a bunch of transitive
 * engine deps that have no place in vex-app main.
 *
 * Both the SDK class AND the HTTP-client error classes are exported
 * as RUNTIME VALUES (not `export type {}`) because `mapSdkError` in
 * vex-app uses `instanceof` checks — those require a runtime
 * reference (codex turn 4 implementation caveat).
 *
 * Used by:
 *   - `vex-app/src/main/onboarding/openrouter-test-client.ts` (M10)
 */

export { OpenRouter } from "@openrouter/sdk";
export {
  ConnectionError,
  InvalidRequestError,
  RequestAbortedError,
  RequestTimeoutError,
  UnexpectedClientError,
} from "@openrouter/sdk/models/errors/httpclienterrors.js";
export { OpenRouterError } from "@openrouter/sdk/models/errors/openroutererror.js";
