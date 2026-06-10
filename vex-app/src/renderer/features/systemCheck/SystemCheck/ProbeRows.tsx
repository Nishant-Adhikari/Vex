/**
 * The four System Check probe rows (`<ol>`), revealed one-by-one by the
 * cascade timer owned by the parent. Pure presentation: every status,
 * the resolved platform, and the live reveal count arrive as props — this
 * module derives nothing and performs no IO.
 *
 * Reuses the shared `StepRow` (one level up) so the row chrome and the
 * `data-step-status` test selector stay single-sourced.
 *
 * Type-only imports for the query hooks (`typeof useX`) derive the data
 * shape without pulling a runtime hook into a presentational module;
 * `verbatimModuleSyntax` elides them at compile time.
 */

import { HugeiconsIcon } from "@hugeicons/react";
import { Settings02Icon, Wifi02Icon } from "@hugeicons/core-free-icons";
import { Docker } from "@thesvg/react";

import { StepRow, type StepStatus } from "../StepRow.js";
import { OperatingSystemIcon, type Platform } from "./OperatingSystemIcon.js";
import {
  formatDockerDetail,
  formatEnvDetail,
  formatPlatform,
} from "./format.js";
import type { useSystemHealth } from "../../../lib/api/system.js";
import type { useDockerStatus } from "../../../lib/api/docker.js";
import type { useEnvState } from "../../../lib/api/onboarding.js";

interface ProbeRowsProps {
  readonly revealCount: number;
  readonly platform: Platform;
  readonly osStatus: StepStatus;
  readonly networkStatus: StepStatus;
  readonly dockerStatus: StepStatus;
  readonly envStatus: StepStatus;
  readonly health: ReturnType<typeof useSystemHealth>;
  readonly docker: ReturnType<typeof useDockerStatus>;
  readonly env: ReturnType<typeof useEnvState>;
}

export function ProbeRows({
  revealCount,
  platform,
  osStatus,
  networkStatus,
  dockerStatus,
  envStatus,
  health,
  docker,
  env,
}: ProbeRowsProps): JSX.Element {
  return (
    // Closing rule: rows carry 6% hairlines; the list's own 10% bottom
    // border under row 04 is the ledger's heavier closing rule.
    <ol className="flex w-full flex-col border-b border-white/[0.10]">
      {revealCount >= 1 ? (
        <StepRow
          index={1}
          label="Operating system"
          status={osStatus}
          icon={<OperatingSystemIcon platform={platform} />}
          detail={
            health.data?.ok
              ? `${formatPlatform(health.data.data.os.platform, health.data.data.os.distro)} · Electron ${health.data.data.os.electronVersion}`
              : null
          }
        />
      ) : null}
      {revealCount >= 2 ? (
        <StepRow
          index={2}
          label="Network connectivity"
          status={networkStatus}
          icon={<HugeiconsIcon icon={Wifi02Icon} size={20} aria-hidden />}
          detail={
            health.data?.ok
              ? health.data.data.network.online
                ? `online · ${health.data.data.network.latencyMs ?? "?"} ms`
                : "offline — agent will run with limited capabilities"
              : null
          }
        />
      ) : null}
      {revealCount >= 3 ? (
        <StepRow
          index={3}
          label="Docker Engine"
          status={dockerStatus}
          icon={<Docker width={20} height={20} aria-hidden />}
          // "READY" reads more accurately than "OK" for an engine
          // that's installed + daemon running + container available.
          // Other states fall back to StepRow defaults (CHECKING…/WARN/FAIL).
          badgeLabel={dockerStatus === "ok" ? "READY" : undefined}
          detail={
            docker.data?.ok
              ? formatDockerDetail(docker.data.data)
              : null
          }
        />
      ) : null}
      {revealCount >= 4 ? (
        <StepRow
          index={4}
          label="Vex configuration"
          status={envStatus}
          icon={
            <HugeiconsIcon icon={Settings02Icon} size={20} aria-hidden />
          }
          // First-run nudge: "SETUP" beats "WARN" for a warn state that
          // means "guided setup required" — the only warn cause for
          // env config currently. Other states use defaults.
          badgeLabel={envStatus === "warn" ? "SETUP" : undefined}
          detail={
            env.data?.ok ? formatEnvDetail(env.data.data) : null
          }
        />
      ) : null}
    </ol>
  );
}
