/**
 * Shared per-command Zod primitives. Extracted so command-group
 * files (`contract.ts`, `run-lifecycle.ts`, `transcript.ts`) share
 * a single field definition for sessionId / missionId.
 */

import { z } from "zod";

export const sessionIdField = z.string().uuid();
export const missionIdField = z.string().min(1);
