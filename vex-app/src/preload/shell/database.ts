import { CH, EV } from "../../shared/ipc/channels.js";
import { migrateProgressSchema } from "../../shared/schemas/database.js";
import type { DatabaseBridge } from "../../shared/types/bridge/shell/database.js";
import { invokeWithSchema, subscribe } from "../_dispatch.js";

export const database = {
  migrate() {
    return invokeWithSchema(CH.database.migrate, {});
  },
  onProgress(cb) {
    return subscribe(EV.database.migrateProgress, migrateProgressSchema, cb);
  },
} satisfies DatabaseBridge;
