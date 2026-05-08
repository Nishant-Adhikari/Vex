/**
 * Unit tests for the pure parser helpers in `probe.ts`. Exercises the
 * positive + negative cases that the M2 docker.detect IPC handler will
 * trip over in the wild — no Docker required.
 */

import { describe, expect, it } from "vitest";
import {
  parseComposeVersion,
  parseDaemonRunning,
  parseDockerVersion,
  parseModelStatus,
} from "../probe.js";

describe("parseDockerVersion", () => {
  it.each([
    ["Docker version 27.5.1, build 9f9e405\n", "27.5.1"],
    ["Docker version 28.0.0-rc.1, build abc\n", "28.0.0-rc.1"],
    ["Docker version 26.1.4+ee, build xyz\n", "26.1.4+ee"],
  ])("extracts %j → %j", (stdout, expected) => {
    expect(parseDockerVersion(stdout)).toBe(expected);
  });

  it.each(["", "garbled output", "docker not found"])(
    "returns null for %j",
    (stdout) => {
      expect(parseDockerVersion(stdout)).toBeNull();
    }
  );
});

describe("parseComposeVersion", () => {
  it.each([
    ["Docker Compose version v2.32.4\n", "v2.32.4"],
    ["Docker Compose version 2.35.0\n", "2.35.0"],
    ["Docker Compose version v2.32.4-desktop.1\n", "v2.32.4-desktop.1"],
  ])("extracts %j → %j", (stdout, expected) => {
    expect(parseComposeVersion(stdout)).toBe(expected);
  });

  it.each(["", "compose: command not found"])(
    "returns null for %j",
    (stdout) => {
      expect(parseComposeVersion(stdout)).toBeNull();
    }
  );
});

describe("parseModelStatus", () => {
  it("treats `is not a docker command` errors as unsupported", () => {
    expect(parseModelStatus("", "docker model is not a docker command")).toBe(
      "unsupported"
    );
  });

  it("recognizes running output as active", () => {
    expect(parseModelStatus("Docker Model Runner is running", null)).toBe("active");
    expect(parseModelStatus("Status: active", null)).toBe("active");
  });

  it("recognizes stopped output as inactive", () => {
    expect(parseModelStatus("Docker Model Runner is not running", null)).toBe(
      "inactive"
    );
    expect(parseModelStatus("Status: stopped", null)).toBe("inactive");
  });

  it("falls back to inactive on unknown error", () => {
    expect(parseModelStatus("", "permission denied")).toBe("inactive");
  });
});

describe("parseDaemonRunning", () => {
  it("returns true on JSON output with non-empty ServerVersion", () => {
    expect(
      parseDaemonRunning(
        '{"ID":"abc","ServerVersion":"27.5.1","KernelVersion":"6.6.0"}',
        null
      )
    ).toBe(true);
  });

  it("returns false on JSON output with empty/missing ServerVersion", () => {
    expect(parseDaemonRunning('{"ID":"abc","ServerVersion":""}', null)).toBe(false);
    expect(parseDaemonRunning('{"ID":"abc"}', null)).toBe(false);
  });

  it("falls back to text-format when JSON parsing fails", () => {
    expect(
      parseDaemonRunning(
        "Client:\n Version: 27.5.1\nServer Version: 27.5.1\nKernel Version: …",
        null
      )
    ).toBe(true);
    expect(parseDaemonRunning("Client:\n Version: 27.5.1\n", null)).toBe(false);
  });

  it("returns false on connection refused", () => {
    expect(
      parseDaemonRunning(
        "",
        "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?"
      )
    ).toBe(false);
  });

  it("returns false on any other error", () => {
    expect(parseDaemonRunning("", "permission denied")).toBe(false);
  });
});
