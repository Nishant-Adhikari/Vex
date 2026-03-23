import { beforeEach, describe, expect, it, vi } from "vitest";

const mockStartRuntimeUpdatePullInBackground = vi.fn();
const mockCreateServer = vi.fn();
const mockRegisterSnapshotRoutes = vi.fn();
const mockRegisterCatalogRoutes = vi.fn();
const mockRegisterDaemonRoutes = vi.fn();
const mockRegisterAgentRoutes = vi.fn();
const mockRegisterFundRoutes = vi.fn();
const mockRegisterWalletRoutes = vi.fn();
const mockRegisterConnectRoutes = vi.fn();
const mockRegisterClaudeRoutes = vi.fn();
const mockRegisterBridgeRoutes = vi.fn();
const mockRegisterOpenClawRoutes = vi.fn();
const mockRegisterTavilyRoutes = vi.fn();
const mockRegisterRuntimeUpdateRoutes = vi.fn();
const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
};

const mockServer = {
  on: vi.fn(),
  listen: vi.fn(),
};

vi.mock("node:http", () => ({
  createServer: (...args: any[]) => mockCreateServer(...args),
}));

vi.mock("../launcher/handlers/snapshot.js", () => ({
  registerSnapshotRoutes: (...args: any[]) => mockRegisterSnapshotRoutes(...args),
}));
vi.mock("../launcher/handlers/catalog.js", () => ({
  registerCatalogRoutes: (...args: any[]) => mockRegisterCatalogRoutes(...args),
}));
vi.mock("../launcher/handlers/daemons.js", () => ({
  registerDaemonRoutes: (...args: any[]) => mockRegisterDaemonRoutes(...args),
}));
vi.mock("../launcher/handlers/agent.js", () => ({
  registerAgentRoutes: (...args: any[]) => mockRegisterAgentRoutes(...args),
}));
vi.mock("../launcher/handlers/fund.js", () => ({
  registerFundRoutes: (...args: any[]) => mockRegisterFundRoutes(...args),
}));
vi.mock("../launcher/handlers/wallet.js", () => ({
  registerWalletRoutes: (...args: any[]) => mockRegisterWalletRoutes(...args),
}));
vi.mock("../launcher/handlers/connect.js", () => ({
  registerConnectRoutes: (...args: any[]) => mockRegisterConnectRoutes(...args),
}));
vi.mock("../launcher/handlers/claude.js", () => ({
  registerClaudeRoutes: (...args: any[]) => mockRegisterClaudeRoutes(...args),
}));
vi.mock("../launcher/handlers/bridge.js", () => ({
  registerBridgeRoutes: (...args: any[]) => mockRegisterBridgeRoutes(...args),
}));
vi.mock("../launcher/handlers/openclaw.js", () => ({
  registerOpenClawRoutes: (...args: any[]) => mockRegisterOpenClawRoutes(...args),
}));
vi.mock("../launcher/handlers/tavily.js", () => ({
  registerTavilyRoutes: (...args: any[]) => mockRegisterTavilyRoutes(...args),
}));
vi.mock("../launcher/handlers/runtime-update.js", () => ({
  registerRuntimeUpdateRoutes: (...args: any[]) => mockRegisterRuntimeUpdateRoutes(...args),
}));

vi.mock("../update/runtime-update-service.js", () => ({
  startRuntimeUpdatePullInBackground: (...args: any[]) => mockStartRuntimeUpdatePullInBackground(...args),
}));

vi.mock("../config/paths.js", () => ({
  LAUNCHER_PID_FILE: "/mock/launcher.pid",
  LAUNCHER_DIR: "/mock",
  LAUNCHER_DEFAULT_PORT: 4200,
}));

vi.mock("../utils/logger.js", () => ({
  default: mockLogger,
}));

const { startLauncherServer } = await import("../launcher/server.js");

describe("launcher server startup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateServer.mockImplementation(() => {
      mockServer.on.mockImplementation(() => mockServer);
      mockServer.listen.mockImplementation((_port: number, _host: string, callback: () => void) => {
        callback();
        return mockServer;
      });
      return mockServer;
    });
  });

  it("triggers a background runtime pull after the launcher starts listening", async () => {
    const server = await startLauncherServer(4321, false);

    expect(server).toBe(mockServer);
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
    expect(mockRegisterSnapshotRoutes).toHaveBeenCalledTimes(1);
    expect(mockRegisterRuntimeUpdateRoutes).toHaveBeenCalledTimes(1);
    expect(mockStartRuntimeUpdatePullInBackground).toHaveBeenCalledWith("startup");
    expect(mockServer.listen).toHaveBeenCalledWith(4321, "127.0.0.1", expect.any(Function));
  });
});
