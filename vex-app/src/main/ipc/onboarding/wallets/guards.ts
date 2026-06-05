/**
 * vex.onboarding.wallet* — shared guard surface.
 *
 * Single import point for the three guards every wallet handler routes
 * through: the global wallet mutex (`withWalletLock`) and the fresh-keystore-
 * password wrapper (`withFreshKeystorePassword` / `isPasswordSetupError`).
 * The canonical implementations stay in their owning modules; this module only
 * re-exports them so the per-family registers depend on one guard surface
 * without duplicating logic.
 */

export {
  isPasswordSetupError,
  withFreshKeystorePassword,
} from "../../../onboarding/wallet-password.js";
export { withWalletLock } from "../../../onboarding/wallet-mutex.js";
