/**
 * Slop helpers — re-exports from canonical src/tools/slop/validation.ts.
 * Kept for CLI backward compat. New code should import from @tools/slop/validation.
 */

export {
  parseUnitsSafe,
  validateUserSalt,
  validateOfficialToken,
  checkNotGraduated,
  checkTradingEnabled,
  getTokenState,
  type TokenState,
} from "../../tools/slop/validation.js";
