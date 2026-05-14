import { describe, expect, it } from "vitest";
import {
  classifyDockerEndpoint,
  isAcceptedLocalDockerHost,
  parseDockerContextHost,
} from "../endpoint-policy.js";

describe("Docker endpoint policy", () => {
  it.each([
    [null, true],
    ["unix:///var/run/docker.sock", true],
    ["npipe:////./pipe/docker_engine", true],
    ["fd://", true],
    ["tcp://127.0.0.1:2375", false],
    ["ssh://docker@example.com", false],
  ])("classifies Docker host %j as accepted=%j", (host, accepted) => {
    expect(isAcceptedLocalDockerHost(host)).toBe(accepted);
  });

  it("parses Docker context inspect JSON output", () => {
    expect(parseDockerContextHost('"unix:///var/run/docker.sock"\n')).toBe(
      "unix:///var/run/docker.sock"
    );
    expect(parseDockerContextHost("null\n")).toBeNull();
  });

  it("rejects unsafe DOCKER_HOST before context host checks", () => {
    const policy = classifyDockerEndpoint({
      dockerHost: "tcp://10.0.0.2:2375",
      currentContext: "default",
      contextHost: "unix:///var/run/docker.sock",
      contextInspectable: true,
      dockerCliAvailable: true,
    });
    expect(policy.accepted).toBe(false);
    expect(policy.reason).toBe("docker_host_unsupported");
    expect(policy.dockerHostSet).toBe(true);
  });

  it("rejects remote Docker contexts", () => {
    const policy = classifyDockerEndpoint({
      dockerHost: null,
      currentContext: "remote-prod",
      contextHost: "ssh://docker@example.com",
      contextInspectable: true,
      dockerCliAvailable: true,
    });
    expect(policy.accepted).toBe(false);
    expect(policy.reason).toBe("context_host_unsupported");
  });

  it("fails closed when Docker CLI exists but context cannot be inspected", () => {
    const policy = classifyDockerEndpoint({
      dockerHost: null,
      currentContext: "default",
      contextHost: null,
      contextInspectable: false,
      dockerCliAvailable: true,
    });
    expect(policy.accepted).toBe(false);
    expect(policy.reason).toBe("context_unverified");
  });
});
