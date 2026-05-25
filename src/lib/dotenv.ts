/**
 * Cross-boundary re-export so vex-app (Electron main) can pull the
 * canonical dotenv helpers via `@vex-lib/dotenv.js` without reaching
 * outside the alias scope.
 *
 * The implementation lives in `/mnt/x/Vex/src/utils/dotenv.ts` and
 * stays the single source of truth for the `${CONFIG_DIR}/.env`
 * format used by vex-app and the local agent runtime.
 */

export {
  appendMultipleToDotenvFile,
  appendToDotenvFile,
  loadDotenvFileIntoProcess,
  readDotenvFileValue,
  removeFromDotenvFile,
} from "../utils/dotenv.js";
