/**
 * Map a `StrategyVersionRow` (DB) to the `StrategyVersionDto` transport shape,
 * clamping to the schema bounds so a persisted row can never overflow the IPC
 * schema and 500 a read.
 */

import type { StrategyVersionRow } from "@vex-agent/db/repos/strategy-versions.js";
import {
  STRATEGY_CONTENT_MAX,
  STRATEGY_LESSON_MAX,
  STRATEGY_LESSON_LIST_MAX,
  type StrategyVersionDto,
} from "@shared/schemas/mission/strategy.js";

export function toStrategyVersionDto(row: StrategyVersionRow): StrategyVersionDto {
  return {
    id: row.id,
    versionNo: row.versionNo,
    content: row.content.slice(0, STRATEGY_CONTENT_MAX),
    status: row.status,
    isBaseline: row.isBaseline,
    active: row.active,
    drivingMissionRunId: row.drivingMissionRunId,
    drivingLessons: row.drivingLessons
      .slice(0, STRATEGY_LESSON_LIST_MAX)
      .map((l) => l.slice(0, STRATEGY_LESSON_MAX)),
    rejectionReason: row.rejectionReason,
    audit: row.audit,
    model: row.model,
    createdAt: row.createdAt,
    activatedAt: row.activatedAt,
  };
}
