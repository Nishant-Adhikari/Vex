/**
 * Pure parser unit tests. Every kind covered + graceful degradation
 * on random / malformed input.
 */

import { describe, it, expect } from "vitest";
import { parseComposeLog } from "../bootstrap/parseComposeLog.js";

describe("parseComposeLog", () => {
  it("matches Postgres waiting line", () => {
    expect(
      parseComposeLog("Waiting for Postgres to accept connections…"),
    ).toEqual({ kind: "postgres.waiting" });
  });

  it("matches Postgres probe connecting", () => {
    expect(
      parseComposeLog(
        "Postgres health probe #2: connecting on 127.0.0.1:55432…",
      ),
    ).toEqual({
      kind: "postgres.probe.connecting",
      attempt: 2,
      port: 55432,
    });
  });

  it("matches Postgres probe ready", () => {
    expect(parseComposeLog("Postgres health probe #1: ready.")).toEqual({
      kind: "postgres.probe.ready",
      attempt: 1,
    });
  });

  it("matches Postgres probe failure (free-form message)", () => {
    expect(
      parseComposeLog(
        "Postgres health probe #3: connection refused: no listener",
      ),
    ).toEqual({
      kind: "postgres.probe.failed",
      attempt: 3,
      message: "connection refused: no listener",
    });
  });

  it("matches Embeddings probe connecting", () => {
    expect(
      parseComposeLog(
        "Embeddings probe #1: GET /health on 127.0.0.1:55134…",
      ),
    ).toEqual({
      kind: "embeddings.probe.connecting",
      attempt: 1,
      port: 55134,
    });
  });

  it("matches Embeddings /health OK", () => {
    expect(
      parseComposeLog(
        "Embeddings /health OK; probing /v1/embeddings…",
      ),
    ).toEqual({ kind: "embeddings.probe.health_ok" });
  });

  it("matches Embeddings probe not ready (health, model loading)", () => {
    expect(
      parseComposeLog(
        "Embeddings probe #1: /health not yet 200; model still loading or runtime not up",
      ),
    ).toEqual({
      kind: "embeddings.probe.not_ready",
      attempt: 1,
      reason: "health",
    });
  });

  it("matches Embeddings probe not ready (v1/embeddings)", () => {
    expect(
      parseComposeLog(
        "Embeddings probe #2: /v1/embeddings not ready yet",
      ),
    ).toEqual({
      kind: "embeddings.probe.not_ready",
      attempt: 2,
      reason: "v1_embeddings",
    });
  });

  it("matches Embeddings runtime ready with dim + attempts", () => {
    expect(
      parseComposeLog("Embeddings runtime ready (dim=768, attempts=2)"),
    ).toEqual({
      kind: "embeddings.probe.ready",
      dim: 768,
      attempts: 2,
    });
  });

  it("matches Embeddings probe aborted", () => {
    expect(parseComposeLog("Embeddings probe aborted")).toEqual({
      kind: "embeddings.aborted",
    });
  });

  it.each([
    ["db", "Starting"],
    ["db", "Started"],
    ["db", "Waiting"],
    ["db", "Healthy"],
    ["embeddings-model-init", "Started"],
    ["embeddings-model-init", "Exited"],
    ["embeddings-runtime", "Starting"],
    ["embeddings-runtime", "Started"],
  ] as const)("matches Container state for %s %s", (service, phase) => {
    const line = ` Container vex-1031ec52-40c8-4951-8e94-b55702346ba6-${service}-1 ${phase} `;
    expect(parseComposeLog(line)).toEqual({
      kind: "container.state",
      service,
      phase,
    });
  });

  it("matches Compose bootstrap completed terminal", () => {
    expect(
      parseComposeLog("Compose bootstrap completed: running."),
    ).toEqual({
      kind: "compose.completed",
      resultKind: "running",
    });
  });

  it("returns null for random unmatched text", () => {
    expect(parseComposeLog("some random log line")).toBeNull();
    expect(parseComposeLog("")).toBeNull();
    expect(parseComposeLog("docker pull foo/bar:latest")).toBeNull();
  });

  it("returns null for malformed Postgres probe (no number)", () => {
    expect(
      parseComposeLog("Postgres health probe #abc: ready."),
    ).toBeNull();
  });
});
