### 2.7 Work Unit 7 — Renderer onboarding and secret setup UX

#### Files & LOC

- `vex-app/src/renderer/main.tsx` 122 LOC
- `vex-app/src/renderer/App.tsx` 133 LOC
- `vex-app/src/renderer/features/systemCheck/SystemCheck.tsx` 367 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx` 491 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/wizard/steps/KeystoreStep.tsx` 273 LOC
- `vex-app/src/renderer/features/wizard/steps/wallets/RestoreFromArchive.tsx` 414 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/secrets/UnlockScreen.tsx` 268 LOC
- `vex-app/src/renderer/features/docker/BootstrapPanel.tsx` 341 LOC — **god-file/refactor candidate**
- `vex-app/src/renderer/features/compose/**`
- `vex-app/src/renderer/features/database/**`
- `vex-app/src/renderer/features/wallets/ExportPrivateKeyModal.tsx` 392 LOC — **god-file/refactor candidate**

#### Responsibility

- Onboarding/setup screens gate access to app shell.
- System check, Docker, Compose, migrations, wizard, unlock screens guide local runtime setup.
- API keys, provider config, keystore, restore archive, wallet export/import, and Polymarket setup collect sensitive inputs but delegate authority to main.

#### Mechanisms/patterns

- Renderer uses `window.vex` typed bridge only.
- Sensitive flows often use uncontrolled refs or bare async helpers to reduce retained secret state.
- `uiStore` persists only non-sensitive `sidebarOpen`.
- React Hook Form is used in wizard flows.
- Docker/Compose logs are bounded in renderer.
- Errors are surfaced with correlation IDs where available.

#### Dependencies & data-flow

Entry points:

- `App.tsx` routes by UI state through setup phases.
- Setup features call `lib/api/*` or direct `window.vex.*`.
- Main handles privileged Docker/DB/secrets/wallet setup.

Imports/dependencies:

- Renderer imports shared bridge types and pure constants/config helpers.
- No direct Node/Electron/Docker/DB/wallet imports found in inspected renderer searches.

Side effects:

- Renderer localStorage only for `sidebarOpen`.
- DOM/input state may temporarily hold passwords/API keys.
- All actual secret writes happen in main/vault.

#### Security surface

- User-entered API keys, keystore passwords, master password, restore archives.
- Renderer is untrusted; validation in renderer is not authoritative.
- `UnlockScreen` retains failed password in input by test expectation.
- `KeystoreStep` watches password through React Hook Form for strength display.
- `@vex-lib` import boundary needs future exact allowlist.

#### Hotspots

- `ApiKeysStep.tsx` 491 LOC.
- `RestoreFromArchive.tsx` 414 LOC.
- `SystemCheck.tsx` 367 LOC.
- `ExportPrivateKeyModal.tsx` 392 LOC.
- Secret-state policy in renderer needs explicit decision.
- Update setup surface is absent.

`console.*` density:

- No high-density renderer console cluster reported; renderer errors are routed through support/telemetry hooks.

#### Tests

Covered:

- Wizard steps.
- Secrets unlock.
- Wallet export/import.
- Docker bootstrap.
- Compose and migrations screens.
- UI primitives.

Not covered / unclear:

- DOM password retention policy.
- Full OS clipboard/private-key export UX behavior.
- Renderer update flow because it does not exist.
- All failure-state copy for Docker group privilege/security.

#### Open risks/smells

- Decide whether failed password should be cleared after unlock failure.
- Review RHF password watch retention.
- Extend boundary check for exact safe `@vex-lib` imports.
- Implement or intentionally remove/update updater setup UX.

