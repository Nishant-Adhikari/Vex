## 2. Per-area inventory — one subsection per work-unit

### 2.1 Work Unit 1 — Electron shell, protocol, window hardening

#### Files & LOC

- `vex-app/src/main/index.ts` 208 LOC
- `vex-app/src/main/windows/main-window.ts` 249 LOC
- `vex-app/src/main/protocol/app-protocol.ts` 61 LOC
- `vex-app/src/main/security/url.ts` 137 LOC
- `vex-app/src/main/permissions.ts` 28 LOC
- `vex-app/src/renderer/index.html` 16 LOC
- `vex-app/src/main/lifecycle/before-quit.ts` 131 LOC
- `vex-app/src/main/lifecycle/secret-cleanup.ts` 110 LOC

No god-file in this unit by LOC. `main-window.ts` is below threshold but high-value because it owns browser isolation and navigation.

#### Responsibility

- `index.ts`: Electron boot sequence, userData remap, logging, protocol/permissions/IPC setup, worker startup, window creation.
- `main-window.ts`: BrowserWindow hardening, load URL selection, external URL policy, navigation guards.
- `app-protocol.ts`: privileged `app://vex` scheme and renderer asset serving.
- `security/url.ts`: app/external URL validation and allowlist logic.
- `permissions.ts`: deny-all permission/device/display-capture posture.
- `index.html`: renderer CSP.

#### Mechanisms/patterns

- `contextIsolation:true`
- `sandbox:true`
- `nodeIntegration:false`
- `webSecurity:true`
- production `app://vex/index.html`
- dev `http://127.0.0.1:5173/`
- `window.open` denied
- non-app navigation blocked
- external HTTPS allowlist via `shell.openExternal`
- privileged custom protocol, no service workers
- deny-all permission handlers

#### Dependencies & data-flow

Entry points:

- Electron app starts in `src/main/index.ts`.
- BrowserWindow created by `createMainWindow`.
- Protocol registration happens before window load.
- Renderer content flows from custom app protocol in packaged builds.

Imports/dependencies:

- Main uses Electron app/session/protocol/window APIs.
- URL policy used by window navigation handlers.
- Lifecycle cleanup hooks tie window/app quit to worker and secret cleanup.

Side effects:

- Sets Electron `userData`.
- Registers protocol privileges and protocol handler.
- Registers permission handlers.
- Opens external URLs through shell only after allowlist checks.
- Starts workers and app lifecycle cleanup.

#### Security surface

- Trust boundary: local app protocol to renderer.
- Main must prevent renderer navigation to attacker-controlled origins.
- External URL allowlist is the only route from renderer link/navigation requests to OS browser.
- Packaged devtools disabled.
- CSP blocks inline scripts and object/frame/form use.

#### Hotspots

- External allowlist includes host-wide `desktop.docker.com`, broader than path-scoped GitHub allowlist.
- Electron 42 protocol options should be freshly verified; implementation omits `stream:true` used in some skill examples.
- Silent/best-effort cleanup in lifecycle files can reduce debuggability.
- `main-window.ts` is not a god-file, but it is security-critical.

#### Tests

Covered:

- `vex-app/src/main/security/__tests__/url.test.ts`
- E2E shell smoke under `vex-app/e2e/smoke.spec.ts`
- Build artifact checks inspect CSP/protocol/permissions indicators.

Not covered / unclear:

- Full packaged navigation matrix across all external links.
- Current Electron 42 custom-protocol option behavior.
- Production installed-app smoke with ASAR/fuses/signing.

#### Open risks/smells

- Tighten external allowlist where practical.
- Verify Electron 42 protocol registration behavior.
- Add diagnostics for silent cleanup without leaking secrets.
- Ensure all external link additions are reviewed as security changes.

