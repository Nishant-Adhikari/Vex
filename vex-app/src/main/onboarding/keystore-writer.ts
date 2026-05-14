/**
 * Master password writer.
 *
 * The password is not persisted in `.env`. It creates or unlocks the
 * encrypted local secret vault and stays only in main-process memory for
 * wallet operations until the app exits.
 */

import type { Result } from "@shared/ipc/result.js";
import type { KeystoreSetResult } from "@shared/schemas/wizard.js";
import { initializeMasterPassword } from "../secrets/session.js";
import { withEnvWriteLock } from "./env-write-mutex.js";

export interface SetKeystorePasswordOptions {
  readonly envFile?: string;
}

export async function setKeystorePassword(
  password: string,
  _options: SetKeystorePasswordOptions = {},
): Promise<Result<KeystoreSetResult>> {
  return withEnvWriteLock(async () => initializeMasterPassword(password));
}
