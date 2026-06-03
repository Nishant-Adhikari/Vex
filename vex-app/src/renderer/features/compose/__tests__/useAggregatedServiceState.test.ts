/**
 * Reducer tests for the per-service aggregator. The reducer is a pure
 * function over a list of ParsedLogEvent; no React rendering required.
 */

import { describe, it, expect } from "vitest";
import { aggregateServiceState } from "../bootstrap/useAggregatedServiceState.js";
import type { ParsedLogEvent } from "../bootstrap/parseComposeLog.js";

describe("aggregateServiceState", () => {
  it("returns 2 initial pills (Postgres + Embeddings) for empty event list", () => {
    const result = aggregateServiceState([]);
    expect(result).toHaveLength(2);
    expect(result[0]?.service).toBe("Postgres");
    expect(result[0]?.status).toBe("starting");
    expect(result[1]?.service).toBe("Embeddings");
    expect(result[1]?.status).toBe("starting");
  });

  it("flips Postgres to ready after probe.ready event", () => {
    const events: ParsedLogEvent[] = [
      { kind: "postgres.waiting" },
      { kind: "postgres.probe.connecting", attempt: 1, port: 27432 },
      { kind: "postgres.probe.ready", attempt: 1 },
    ];
    const [pg] = aggregateServiceState(events);
    expect(pg?.status).toBe("ready");
    expect(pg?.detail).toMatch(/probe #1 ready/i);
  });

  it("flips Embeddings to ready after runtime.ready event", () => {
    const events: ParsedLogEvent[] = [
      { kind: "embeddings.probe.connecting", attempt: 1, port: 27134 },
      {
        kind: "embeddings.probe.not_ready",
        attempt: 1,
        reason: "health",
      },
      { kind: "embeddings.probe.connecting", attempt: 2, port: 27134 },
      { kind: "embeddings.probe.health_ok" },
      { kind: "embeddings.probe.ready", dim: 768, attempts: 2 },
    ];
    const [, emb] = aggregateServiceState(events);
    expect(emb?.status).toBe("ready");
    expect(emb?.detail).toMatch(/dim=768/);
    expect(emb?.detail).toMatch(/2 attempts/);
  });

  it("Postgres probe.failed stays in probing (terminal failure goes via IPC kind, not log parser)", () => {
    const events: ParsedLogEvent[] = [
      {
        kind: "postgres.probe.failed",
        attempt: 1,
        message: "connection refused",
      },
    ];
    const [pg] = aggregateServiceState(events);
    expect(pg?.status).toBe("probing");
    expect(pg?.detail).toMatch(/connection refused/);
  });

  it("Embeddings model-init Exited does NOT flip to failed (init container is expected to exit)", () => {
    const events: ParsedLogEvent[] = [
      {
        kind: "container.state",
        service: "embeddings-model-init",
        phase: "Started",
      },
      {
        kind: "container.state",
        service: "embeddings-model-init",
        phase: "Exited",
      },
    ];
    const [, emb] = aggregateServiceState(events);
    expect(emb?.status).toBe("starting");
    expect(emb?.detail).toBe("model ready");
  });

  it("container state events don't overwrite higher-fidelity probe state", () => {
    // After probe.ready (high fidelity), a later container.state event
    // shouldn't downgrade Postgres back to "probing".
    const events: ParsedLogEvent[] = [
      { kind: "postgres.probe.ready", attempt: 1 },
      {
        kind: "container.state",
        service: "db",
        phase: "Healthy",
      },
    ];
    const [pg] = aggregateServiceState(events);
    expect(pg?.status).toBe("ready");
  });

  it("compose.completed terminal event is a no-op for the reducer", () => {
    const events: ParsedLogEvent[] = [
      { kind: "postgres.probe.ready", attempt: 1 },
      { kind: "compose.completed", resultKind: "running" },
    ];
    const [pg] = aggregateServiceState(events);
    expect(pg?.status).toBe("ready");
  });

  it("Embeddings aborted flips to failed", () => {
    const [, emb] = aggregateServiceState([
      { kind: "embeddings.aborted" },
    ]);
    expect(emb?.status).toBe("failed");
    expect(emb?.detail).toBe("probe aborted");
  });
});
