/**
 * Sessions schemas for the multi-session app shell.
 *
 * Mirrors the `sessions` row contract established by the base Vex Agent
 * migrations and the engine repo (`src/vex-agent/db/repos/sessions.ts`).
 *
 * Invariants (immutable per session):
 *   - `mode` ∈ { "agent", "mission" }
 *   - `permission` ∈ { "restricted", "full" }
 *   - `initialGoal` required + non-empty (trimmed) when `mode === "mission"`,
 *     forbidden otherwise (DB CHECK enforces non-empty on mission rows).
 *
 * The `sessionCreateInputSchema` is a discriminated union on `mode` so the
 * Goal textarea in the renderer is structurally tied to mission mode —
 * preload + main can't accept a goal on an agent row by mistake.
 */

import { z } from "zod";

export const VEX_APP_SESSION_SCOPE = "vex_app" as const;
export const INITIAL_GOAL_MAX_LENGTH = 2000;

export const sessionModeSchema = z.enum(["agent", "mission"]);
export type SessionMode = z.infer<typeof sessionModeSchema>;

export const sessionPermissionSchema = z.enum(["restricted", "full"]);
export type SessionPermission = z.infer<typeof sessionPermissionSchema>;

/**
 * IPC input for `vex.sessions.create`. Discriminated union on `mode`:
 *   - agent: no goal field at all (typed `never` blocks accidental sends)
 *   - mission: `initialGoal` REQUIRED, trimmed, bounded
 */
export const sessionCreateInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("agent"),
      permission: sessionPermissionSchema,
    })
    .strict(),
  z
    .object({
      mode: z.literal("mission"),
      permission: sessionPermissionSchema,
      initialGoal: z
        .string()
        .trim()
        .min(1, "Goal is required for missions.")
        .max(INITIAL_GOAL_MAX_LENGTH, `Goal must be ${INITIAL_GOAL_MAX_LENGTH} characters or less.`),
    })
    .strict(),
]);
export type SessionCreateInput = z.infer<typeof sessionCreateInputSchema>;

/**
 * IPC input for `vex.sessions.get`. Session ids are UUIDv4 minted by the
 * main process at create time — renderer never minted ids in this build.
 */
export const sessionGetInputSchema = z
  .object({
    id: z.string().uuid(),
  })
  .strict();
export type SessionGetInput = z.infer<typeof sessionGetInputSchema>;

/**
 * Single row in the sidebar list. Carries enough metadata for the
 * sidebar to render mode/permission badges + optional mission-run
 * status pill without a second IPC roundtrip.
 */
export const sessionListItemSchema = z
  .object({
    id: z.string().uuid(),
    mode: sessionModeSchema,
    permission: sessionPermissionSchema,
    initialGoal: z.string().nullable(),
    startedAt: z.string().datetime(),
    endedAt: z.string().datetime().nullable(),
    /**
     * Active mission_run.status when `mode === "mission"` AND a run is
     * active/paused. Null for agent sessions, mission sessions that haven't
     * started a run yet, and completed/cancelled runs.
     */
    missionStatus: z.string().nullable(),
  })
  .strict();
export type SessionListItem = z.infer<typeof sessionListItemSchema>;

export const sessionListSchema = z.array(sessionListItemSchema);
export type SessionList = z.infer<typeof sessionListSchema>;

/**
 * Result of `vex.sessions.create`. We return the newly minted id plus the
 * fields we just persisted so the renderer can optimistically insert into
 * the sidebar query cache.
 */
export const sessionCreateResultSchema = sessionListItemSchema;
export type SessionCreateResult = z.infer<typeof sessionCreateResultSchema>;
