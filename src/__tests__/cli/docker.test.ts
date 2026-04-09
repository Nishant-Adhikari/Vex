import { describe, expect, it } from "vitest";
import {
  isDockerMissing,
  isDockerModelPluginMissing,
  parseOsRelease,
} from "../../cli/echo/docker.js";

describe("docker launcher helpers", () => {
  it("parses Ubuntu os-release fields used by the installer", () => {
    const info = parseOsRelease([
      'ID="ubuntu"',
      'VERSION_CODENAME="noble"',
      'UBUNTU_CODENAME="noble"',
    ].join("\n"));

    expect(info.id).toBe("ubuntu");
    expect(info.versionCodename).toBe("noble");
    expect(info.ubuntuCodename).toBe("noble");
  });

  it("parses Debian os-release fields used by the installer", () => {
    const info = parseOsRelease([
      "ID=debian",
      "VERSION_CODENAME=bookworm",
    ].join("\n"));

    expect(info.id).toBe("debian");
    expect(info.versionCodename).toBe("bookworm");
    expect(info.ubuntuCodename).toBeUndefined();
  });

  it("recognizes a missing docker binary from spawn errors", () => {
    expect(isDockerMissing("spawnSync docker ENOENT")).toBe(true);
    expect(isDockerMissing("docker: command not found")).toBe(true);
    expect(isDockerMissing("permission denied while trying to connect to the Docker daemon socket")).toBe(false);
  });

  it("recognizes a missing docker model plugin from docker CLI output", () => {
    expect(isDockerModelPluginMissing("docker: 'model' is not a docker command.")).toBe(true);
    expect(isDockerModelPluginMissing('docker: "model" is not a docker command.')).toBe(true);
    expect(isDockerModelPluginMissing("Docker Model Runner must be enabled before local MCP bootstrap can pass.")).toBe(false);
  });
});
