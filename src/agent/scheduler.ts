/**
 * Cron scheduler — runs agent-created scheduled tasks.
 *
 * Uses node-cron for scheduling. Each cron fire creates an action:
 * - cli_execute: runs echoclaw command directly
 * - inference: enters conversation turn with prompt
 * - alert: checks condition, notifies if triggered
 */

import cron from "node-cron";
import { execFile } from "node:child_process";
import * as tasksRepo from "./db/repos/tasks.js";
import { buildScheduledAlertPrompt } from "./prompts/loop-phases.js";
import { takeSnapshot } from "./snapshot.js";
import { runEchoPapaCycle } from "./echo-papa.js";
import { isMutatingCommand } from "./executor.js";
import { supportsYes } from "./tool-registry.js";
import { captureTradeFromResult, detectCapturedTradeCommand } from "./trade-capture.js";
import logger from "../utils/logger.js";

type TaskHandler = (task: tasksRepo.ScheduledTask) => Promise<Record<string, unknown>>;

// Active cron jobs — keyed by task ID
const activeJobs = new Map<string, cron.ScheduledTask>();

// External handler for inference-type tasks (set by engine on init)
let inferenceHandler: ((prompt: string, loopMode: string) => Promise<string>) | null = null;

export function setInferenceHandler(handler: typeof inferenceHandler): void {
  inferenceHandler = handler;
}

/**
 * Initialize scheduler — load enabled tasks, register cron jobs.
 * Also creates default portfolio snapshot task if none exists.
 */
export async function initScheduler(): Promise<void> {
  // Ensure default snapshot task
  const tasks = await tasksRepo.listTasks();
  const hasSnapshotTask = tasks.some(t => t.id === "builtin-portfolio-snapshot");

  if (!hasSnapshotTask) {
    await tasksRepo.createTask({
      id: "builtin-portfolio-snapshot",
      name: "Portfolio Snapshot",
      description: "Auto-capture balances every 30 minutes",
      cronExpression: "*/30 * * * *",
      taskType: "snapshot",
      payload: {},
      loopMode: "restricted",
    });
    logger.info("scheduler.task.created", { taskId: "builtin-portfolio-snapshot", taskName: "Portfolio Snapshot", schedule: "every 30 minutes" });
  } else {
    const snapshotTask = tasks.find(t => t.id === "builtin-portfolio-snapshot");
    if (snapshotTask?.cronExpression === "0 * * * *") {
      await tasksRepo.updateTaskSchedule(
        "builtin-portfolio-snapshot",
        "*/30 * * * *",
        "Auto-capture balances every 30 minutes",
      );
      logger.info("scheduler.task.updated", {
        taskId: "builtin-portfolio-snapshot",
        taskName: "Portfolio Snapshot",
        schedule: "every 30 minutes",
      });
    }
  }

  // Ensure default auto-backup task
  const hasBackupTask = tasks.some(t => t.id === "builtin-auto-backup");
  if (!hasBackupTask) {
    await tasksRepo.createTask({
      id: "builtin-auto-backup",
      name: "Auto Backup",
      description: "Backup agent data to 0G Storage every hour",
      cronExpression: "30 * * * *",
      taskType: "backup",
      payload: {},
      loopMode: "restricted",
    });
    logger.info("scheduler.task.created", { taskId: "builtin-auto-backup", taskName: "Auto Backup", schedule: "hourly at :30" });
  }

  // Ensure Echo Papa task (replaces previous knowledge-audit and memory-steward)
  const hasPapa = tasks.some(t => t.id === "builtin-echo-papa");
  if (!hasPapa) {
    // Remove old tasks if they exist (superseded by Echo Papa)
    for (const oldId of ["builtin-knowledge-audit", "builtin-memory-steward"]) {
      if (tasks.some(t => t.id === oldId)) {
        await tasksRepo.deleteTask(oldId);
        logger.info("scheduler.task.removed", { taskId: oldId, reason: "superseded by echo-papa" });
      }
    }

    await tasksRepo.createTask({
      id: "builtin-echo-papa",
      name: "Echo Papa",
      description: "LLM-powered knowledge steward — consolidates memory and knowledge every 30 min",
      cronExpression: "*/30 * * * *",
      taskType: "echo_papa",
      payload: {},
      loopMode: "restricted",
    });
    logger.info("scheduler.task.created", { taskId: "builtin-echo-papa", taskName: "Echo Papa", schedule: "every 30 minutes" });
  }

  // Load and register all enabled tasks
  const enabled = await tasksRepo.getEnabledTasks();
  for (const task of enabled) {
    registerJob(task);
  }

  logger.info("scheduler.initialized", { activeTasks: enabled.length });

  // Resume Echo Loop if it was active before restart
  try {
    const { getLoopState } = await import("./db/repos/loop.js");
    const { startEchoLoop } = await import("./echo-loop.js");
    const { recoverOrphanedSubagents } = await import("./subagent.js");
    const { startMonitor } = await import("./topup-monitor.js");

    // Recover orphaned subagents from previous run
    await recoverOrphanedSubagents();

    // Start top-up monitor
    startMonitor();

    const loop = await getLoopState();
    if (loop.active) {
      await startEchoLoop(loop.mode as "full" | "restricted", loop.intervalMs);
      logger.info("scheduler.echo-loop.resumed", { mode: loop.mode, intervalMs: loop.intervalMs });
    }
  } catch (err) { logger.warn("scheduler.echo-loop.resume_failed", { error: err instanceof Error ? err.message : String(err) }); }
}

/** Register a cron job for a task. */
function registerJob(task: tasksRepo.ScheduledTask): void {
  if (!cron.validate(task.cronExpression)) {
    logger.warn("scheduler.task.invalid_cron", { taskId: task.id, cronExpression: task.cronExpression });
    return;
  }

  // Stop existing job if re-registering
  const existing = activeJobs.get(task.id);
  if (existing) existing.stop();

  const job = cron.schedule(task.cronExpression, async () => {
    logger.info("scheduler.task.fired", { taskId: task.id, taskName: task.name });
    try {
      const result = await executeTask(task);
      await tasksRepo.recordRun(task.id, result);
      logger.info("scheduler.task.completed", { taskId: task.id, taskName: task.name });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("scheduler.task.failed", { taskId: task.id, taskName: task.name, error: msg });
      await tasksRepo.recordRun(task.id, { error: msg });
    }
  });

  activeJobs.set(task.id, job);
}

/** Execute a task based on its type. */
async function executeTask(task: tasksRepo.ScheduledTask): Promise<Record<string, unknown>> {
  switch (task.taskType) {
    case "cli_execute":
      return executeCliTask(task);
    case "inference":
      return executeInferenceTask(task);
    case "alert":
      return executeAlertTask(task);
    case "snapshot":
      return executeSnapshotTask();
    case "backup":
      return executeBackupTask();
    case "echo_papa":
      return executeEchoPapaTask();
    default:
      return { error: `Unknown task type: ${task.taskType}` };
  }
}

async function executeCliTask(task: tasksRepo.ScheduledTask): Promise<Record<string, unknown>> {
  const command = task.payload.command as string;
  const args = task.payload.args as Record<string, string> | undefined;

  if (!command) return { error: "No command in payload" };

  // Enforce permission model: mutating commands require loopMode=full
  const commandSnake = command.replace(/\s+/g, "_");
  if (isMutatingCommand(commandSnake) && task.loopMode !== "full") {
    logger.warn("scheduler.task.blocked", { taskId: task.id, command, loopMode: task.loopMode, reason: "mutating command requires loopMode=full" });
    return { success: false, error: `Mutating command "${command}" blocked — requires loopMode=full, got "${task.loopMode}"`, command };
  }

  const cliArgs = command.split(/\s+/);
  if (args) {
    for (const [key, value] of Object.entries(args)) {
      const flag = key.startsWith("--") ? key : `--${key}`;
      cliArgs.push(flag, String(value));
    }
  }
  if (!cliArgs.includes("--json")) cliArgs.push("--json");
  // Only append --yes for commands that actually declare the flag
  const commandSnakeForYes = command.replace(/\s+/g, "_");
  if (task.loopMode === "full" && supportsYes(commandSnakeForYes) && !cliArgs.includes("--yes")) cliArgs.push("--yes");

  return new Promise((resolve) => {
    execFile("echoclaw", cliArgs, { timeout: 120_000, maxBuffer: 1024 * 1024 }, async (err, stdout) => {
      if (err) {
        resolve({ success: false, error: err.message, command });
      } else {
        const output = stdout.trim();
        const captureCommand = detectCapturedTradeCommand(cliArgs);
        if (captureCommand) {
          try {
            await captureTradeFromResult(captureCommand, cliArgs, output);
          } catch (captureErr) {
            logger.warn("trade.capture.failed", {
              command: captureCommand,
              phase: "scheduler",
              error: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          }
        }
        try {
          resolve({ success: true, command, output: JSON.parse(output) });
        } catch {
          resolve({ success: true, command, output: output.slice(0, 500) });
        }
      }
    });
  });
}

async function executeInferenceTask(task: tasksRepo.ScheduledTask): Promise<Record<string, unknown>> {
  const prompt = task.payload.prompt as string;
  if (!prompt) return { error: "No prompt in payload" };

  if (!inferenceHandler) {
    return { error: "Inference handler not registered — engine not initialized" };
  }

  const response = await inferenceHandler(prompt, task.loopMode);
  return { success: true, prompt, response: response.slice(0, 500) };
}

async function executeAlertTask(task: tasksRepo.ScheduledTask): Promise<Record<string, unknown>> {
  // Alert tasks check a condition and notify
  const message = task.payload.message as string ?? "Alert triggered";

  // For now, alerts go through inference — agent evaluates the condition
  if (inferenceHandler) {
    const prompt = buildScheduledAlertPrompt(message);
    const response = await inferenceHandler(prompt, "restricted");
    return { success: true, checked: true, response: response.slice(0, 500) };
  }

  return { success: true, checked: false, message: "No inference handler" };
}

async function executeSnapshotTask(): Promise<Record<string, unknown>> {
  const id = await takeSnapshot("cron");
  return { success: true, snapshotId: id };
}

async function executeBackupTask(): Promise<Record<string, unknown>> {
  // Trigger backup via internal HTTP call to own server
  try {
    const { AGENT_DEFAULT_PORT } = await import("./constants.js");
    const res = await fetch(`http://127.0.0.1:${AGENT_DEFAULT_PORT}/api/agent/backup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.AGENT_AUTH_TOKEN ?? ""}` },
      signal: AbortSignal.timeout(180_000),
    });
    if (!res.ok) {
      const body = await res.text();
      return { success: false, error: `Backup API returned ${res.status}: ${body.slice(0, 200)}` };
    }
    const data = await res.json() as Record<string, unknown>;
    return { success: true, ...data };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function executeEchoPapaTask(): Promise<Record<string, unknown>> {
  const report = await runEchoPapaCycle();
  return { success: report.success, toolCalls: report.toolCalls, tokensUsed: report.tokensUsed, result: report.result.slice(0, 500) };
}

// ── Public API for dynamic task management ───────────────────────────

export async function addTask(task: Parameters<typeof tasksRepo.createTask>[0]): Promise<void> {
  await tasksRepo.createTask(task);
  const full = (await tasksRepo.listTasks()).find(t => t.id === task.id);
  if (full?.enabled) registerJob(full);
}

export async function removeTask(id: string): Promise<boolean> {
  const job = activeJobs.get(id);
  if (job) { job.stop(); activeJobs.delete(id); }
  return tasksRepo.deleteTask(id);
}

export async function toggleTask(id: string, enabled: boolean): Promise<boolean> {
  const ok = await tasksRepo.toggleTask(id, enabled);
  if (!ok) return false;

  if (!enabled) {
    const job = activeJobs.get(id);
    if (job) { job.stop(); activeJobs.delete(id); }
  } else {
    const task = (await tasksRepo.listTasks()).find(t => t.id === id);
    if (task) registerJob(task);
  }
  return true;
}

/** Stop all cron jobs + echo loop (graceful shutdown). */
export async function stopAll(): Promise<void> {
  await stopLoopEngine();
  for (const [, job] of activeJobs) {
    job.stop();
  }
  activeJobs.clear();
  logger.info("scheduler.stopped");
}

// ── Echo Loop engine (delegated to echo-loop.ts) ────────────────────

/**
 * Start the Echo Loop — phased autonomous loop.
 * Delegates to echo-loop.ts which manages the full lifecycle.
 */
export async function startLoopEngine(mode: "full" | "restricted", intervalMs: number): Promise<void> {
  const { startEchoLoop } = await import("./echo-loop.js");
  await startEchoLoop(mode, intervalMs);
}

/** Stop the Echo Loop. */
export async function stopLoopEngine(): Promise<void> {
  const { stopEchoLoop } = await import("./echo-loop.js");
  await stopEchoLoop();
}
