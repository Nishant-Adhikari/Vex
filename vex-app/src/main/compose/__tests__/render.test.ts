/**
 * Tests for the pure render core. Uses an in-memory secret adapter +
 * deterministic random/crypto adapters so the assertions are stable.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getInstallId,
  getPgPassword,
  renderCompose,
  type CryptoAdapter,
  type RandomAdapter,
  type RenderDeps,
  type SecretAdapter,
} from "../render.js";

interface FakeSecretAdapter extends SecretAdapter {
  readonly written: Map<string, string>;
}

function makeFakeSecretAdapter(): FakeSecretAdapter {
  const written = new Map<string, string>();
  return {
    written,
    async write(targetPath, value) {
      written.set(targetPath, value);
      return { composePath: targetPath };
    },
    async read(targetPath) {
      return written.get(targetPath) ?? null;
    },
    async cleanup() {
      written.clear();
    },
    async bootCleanup() {
      // no-op
    },
  };
}

function makeFakeRandom(uuids: string[], bytes: Uint8Array[]): RandomAdapter {
  const uuidQueue = [...uuids];
  const bytesQueue = [...bytes];
  return {
    uuid: () => {
      const v = uuidQueue.shift();
      if (!v) throw new Error("Fake UUID queue exhausted");
      return v;
    },
    randomBytes: () => {
      const v = bytesQueue.shift();
      if (!v) throw new Error("Fake bytes queue exhausted");
      return v;
    },
  };
}

const fakeCrypto: CryptoAdapter = {
  base64url: (input) => Buffer.from(input).toString("base64url"),
};

const TEMPLATE = `name: vex-\${VEX_INSTALL_ID}

services:
  db:
    image: pgvector/pgvector:0.8.2-pg18-trixie@sha256:abc
    secrets:
      - pg_password
    ports:
      - target: 5432
        published: "\${VEX_PG_PORT:-55432}"
        host_ip: 127.0.0.1
  embeddings-runtime:
    image: ghcr.io/ggml-org/llama.cpp:server-b9115@sha256:def
    ports:
      - target: 8080
        published: "\${VEX_EMBED_PORT:-55134}"
        host_ip: 127.0.0.1

volumes:
  vex-postgres-data-\${VEX_INSTALL_ID}:
    name: vex-postgres-data-\${VEX_INSTALL_ID}

secrets:
  pg_password:
    file: \${VEX_PG_PASSWORD_FILE}
`;

describe("compose/render core", () => {
  let userDataDir = "";
  let resourcesDir = "";
  let deps: RenderDeps;
  let secretAdapter: FakeSecretAdapter;

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "vex-render-userdata-"));
    resourcesDir = mkdtempSync(path.join(tmpdir(), "vex-render-resources-"));
    mkdirSync(resourcesDir, { recursive: true });
    writeFileSync(path.join(resourcesDir, "docker-compose.template.yml"), TEMPLATE, "utf8");

    secretAdapter = makeFakeSecretAdapter();
    deps = {
      userDataDir,
      resourcesDir,
      secretAdapter,
      randomAdapter: makeFakeRandom(
        ["11111111-1111-1111-1111-111111111111"],
        [Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32])]
      ),
      cryptoAdapter: fakeCrypto,
    };
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(resourcesDir, { recursive: true, force: true });
  });

  it("getInstallId persists the first generated id and returns it on subsequent calls", async () => {
    const first = await getInstallId(deps);
    expect(first).toBe("11111111-1111-1111-1111-111111111111");

    // Re-run with a different fake random — must still return the persisted id.
    const deps2 = {
      ...deps,
      randomAdapter: makeFakeRandom(
        ["22222222-2222-2222-2222-222222222222"],
        []
      ),
    };
    const second = await getInstallId(deps2);
    expect(second).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("getPgPassword caches across calls (stable secret)", async () => {
    const a = await getPgPassword(deps);
    const stored = secretAdapter.written.get(a.composePath);
    expect(stored).toBeTruthy();

    // Drain the random/uuid queues — second call must NOT generate new bytes.
    const b = await getPgPassword(deps);
    expect(b.composePath).toBe(a.composePath);
    expect(secretAdapter.written.get(b.composePath)).toBe(stored);
  });

  it("renderCompose substitutes placeholders + atomic-writes to userData/compose", async () => {
    const result = await renderCompose(deps, { pgPort: 56789 });
    expect(result.installId).toBe("11111111-1111-1111-1111-111111111111");
    expect(result.outPath).toBe(
      path.join(userDataDir, "compose", "docker-compose.yml")
    );
    const written = readFileSync(result.outPath, "utf8");
    expect(written).toContain("name: vex-11111111-1111-1111-1111-111111111111");
    expect(written).toContain('published: "56789"');
    expect(written).toContain(
      `file: ${result.pgPasswordComposePath}`
    );
    // Placeholders must all be substituted.
    expect(written).not.toContain("${VEX_");
  });

  it("renderCompose defaults pgPort to 55432 when not provided", async () => {
    const result = await renderCompose(deps);
    const written = readFileSync(result.outPath, "utf8");
    expect(written).toContain('published: "55432"');
  });

  it("renderCompose substitutes VEX_EMBED_PORT placeholder + returns embedPort in result", async () => {
    const result = await renderCompose(deps, { pgPort: 56789, embedPort: 56134 });
    expect(result.embedPort).toBe(56134);
    const written = readFileSync(result.outPath, "utf8");
    expect(written).toContain('published: "56134"');
    expect(written).not.toContain("${VEX_EMBED_PORT");
  });

  it("renderCompose defaults embedPort to 55134 when not provided", async () => {
    const result = await renderCompose(deps);
    expect(result.embedPort).toBe(55134);
    const written = readFileSync(result.outPath, "utf8");
    expect(written).toContain('published: "55134"');
  });

  it("renderCompose is idempotent (same output across runs with same deps)", async () => {
    const a = await renderCompose(deps);
    const aContent = readFileSync(a.outPath, "utf8");
    // Drain random queues so a re-run that needed new randomness would crash.
    const b = await renderCompose(deps);
    const bContent = readFileSync(b.outPath, "utf8");
    expect(b.installId).toBe(a.installId);
    expect(b.pgPasswordComposePath).toBe(a.pgPasswordComposePath);
    expect(bContent).toBe(aContent);
  });
});

describe("posixSecretAdapter (real fs)", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "vex-posix-secret-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("writes the secret file with mode 0o600 (POSIX)", async () => {
    if (process.platform === "win32") return; // POSIX modes not enforced on Windows
    const { posixSecretAdapter } = await import("../posix-secret-adapter.js");
    const target = path.join(dir, "secrets", "pg_password");
    await posixSecretAdapter.write(target, "secret-value");
    const fsModule = await import("node:fs/promises");
    const stat = await fsModule.stat(target);
    // Mask off file-type bits, keep just permission bits.
    expect(stat.mode & 0o777).toBe(0o600);
    const value = await posixSecretAdapter.read(target);
    expect(value).toBe("secret-value");
  });

  it("returns null when the file is missing", async () => {
    const { posixSecretAdapter } = await import("../posix-secret-adapter.js");
    expect(await posixSecretAdapter.read(path.join(dir, "missing"))).toBeNull();
  });
});
