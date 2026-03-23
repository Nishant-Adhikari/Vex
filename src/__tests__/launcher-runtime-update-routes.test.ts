import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "node:http";
import type { RouteParams } from "../launcher/types.js";

const registeredHandlers = new Map<string, (...args: any[]) => any>();

const mockGetRuntimeUpdateStatus = vi.fn();
const mockRetryRuntimeUpdatePull = vi.fn();
const mockApplyRuntimeUpdate = vi.fn();

vi.mock("../launcher/routes.js", () => ({
  registerRoute: vi.fn((method: string, pattern: string, handler: any) => {
    registeredHandlers.set(`${method} ${pattern}`, handler);
  }),
  jsonResponse: vi.fn((res: any, status: number, body: any) => {
    res._status = status;
    res._body = body;
  }),
  errorResponse: vi.fn((res: any, status: number, code: string, message: string) => {
    res._status = status;
    res._body = { error: { code, message } };
  }),
}));

vi.mock("../update/runtime-update-service.js", () => ({
  applyRuntimeUpdate: (...args: any[]) => mockApplyRuntimeUpdate(...args),
  getRuntimeUpdateStatus: (...args: any[]) => mockGetRuntimeUpdateStatus(...args),
  retryRuntimeUpdatePull: (...args: any[]) => mockRetryRuntimeUpdatePull(...args),
}));

const { registerRuntimeUpdateRoutes } = await import("../launcher/handlers/runtime-update.js");
registerRuntimeUpdateRoutes();

function makeRes(): any {
  return { _status: 0, _body: null };
}

function makeParams(body: Record<string, unknown> | null = null): RouteParams {
  return { segments: {}, query: {}, body };
}

describe("launcher runtime-update routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns current runtime update status", async () => {
    const handler = registeredHandlers.get("GET /api/runtime-update");
    const res = makeRes();
    mockGetRuntimeUpdateStatus.mockResolvedValue({ updateAvailable: true });

    await handler?.({} as IncomingMessage, res, makeParams());

    expect(mockGetRuntimeUpdateStatus).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ updateAvailable: true });
  });

  it("retries a failed image download", async () => {
    const handler = registeredHandlers.get("POST /api/runtime-update/retry");
    const res = makeRes();
    mockRetryRuntimeUpdatePull.mockResolvedValue({ readyToApply: false });

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(mockRetryRuntimeUpdatePull).toHaveBeenCalledTimes(1);
    expect(res._status).toBe(200);
    expect(res._body).toEqual({ retried: true, status: { readyToApply: false } });
  });

  it("returns 409 when package-managed agent updates are disabled", async () => {
    const handler = registeredHandlers.get("POST /api/runtime-update/apply");
    const res = makeRes();
    mockApplyRuntimeUpdate.mockResolvedValue({
      applied: false,
      healthy: true,
      status: {
        agentManagedByPackage: false,
        targetPackageVersion: "2.0.0",
        lastError: null,
      },
    });

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(res._status).toBe(409);
    expect(res._body.error.code).toBe("RUNTIME_UPDATE_DISABLED");
  });

  it("returns 409 when no runtime update is pending", async () => {
    const handler = registeredHandlers.get("POST /api/runtime-update/apply");
    const res = makeRes();
    mockApplyRuntimeUpdate.mockResolvedValue({
      applied: false,
      healthy: false,
      status: {
        agentManagedByPackage: true,
        targetPackageVersion: null,
        lastError: null,
      },
    });

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(res._status).toBe(409);
    expect(res._body.error.code).toBe("RUNTIME_UPDATE_NOT_PENDING");
  });

  it("returns 409 when the image is not ready to apply yet", async () => {
    const handler = registeredHandlers.get("POST /api/runtime-update/apply");
    const res = makeRes();
    mockApplyRuntimeUpdate.mockResolvedValue({
      applied: false,
      healthy: false,
      status: {
        agentManagedByPackage: true,
        targetPackageVersion: "2.0.0",
        lastError: "docker compose pull failed",
      },
    });

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(res._status).toBe(409);
    expect(res._body.error.code).toBe("RUNTIME_UPDATE_NOT_READY");
    expect(res._body.error.message).toBe("docker compose pull failed");
  });

  it("returns 200 for successful or idempotent apply responses", async () => {
    const handler = registeredHandlers.get("POST /api/runtime-update/apply");
    const res = makeRes();
    const payload = {
      applied: true,
      healthy: true,
      status: {
        agentManagedByPackage: true,
        targetPackageVersion: null,
        lastError: null,
      },
    };
    mockApplyRuntimeUpdate.mockResolvedValue(payload);

    await handler?.({} as IncomingMessage, res, makeParams({}));

    expect(res._status).toBe(200);
    expect(res._body).toEqual(payload);
  });
});
