import { CH } from "../../shared/ipc/channels.js";
import {
  compactionHistoryInputSchema,
  compactionRetryInputSchema,
  compactionStatusInputSchema,
} from "../../shared/schemas/compaction.js";
import type {
  CompactionHistoryInput,
  CompactionRetryInput,
  CompactionStatusInput,
} from "../../shared/schemas/compaction.js";
import type { CompactionBridge } from "../../shared/types/bridge/agent/compaction.js";
import { invokeWithSchema } from "../_dispatch.js";

export const compaction = {
  getStatus(input: CompactionStatusInput) {
    return invokeWithSchema(
      CH.compaction.getStatus,
      input,
      compactionStatusInputSchema,
    );
  },
  listHistory(input: CompactionHistoryInput) {
    return invokeWithSchema(
      CH.compaction.listHistory,
      input,
      compactionHistoryInputSchema,
    );
  },
  retry(input: CompactionRetryInput) {
    return invokeWithSchema(
      CH.compaction.retry,
      input,
      compactionRetryInputSchema,
    );
  },
} satisfies CompactionBridge;
