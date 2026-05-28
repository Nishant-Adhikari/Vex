---
id: audit.current.security-review
kind: audit
paths: ["src/**", "vex-app/**"]
source_commit: cf05003
indexed_at: 2026-05-28
stale_when_paths_change: ["src/**", "vex-app/**", "VEX-INDEX/modules/**/*.md"]
related: [module.vex-app.main-process, module.vex-app.local-services-docker, module.src-root.lib-vault-secrets]
---

# Current Security Review Snapshot

| ID | Finding | Status | Evidence |
|---|---|---|---|
| FINDING-security-001 | Renderer boundary is currently clean in searched files | monitor | Renderer uses `window.vex`; current `@vex-lib` imports are pure metadata/schemas. |
| FINDING-security-002 | BrowserWindow/protocol/permission posture is hardened | monitor | sandbox/contextIsolation/no nodeIntegration; `app://vex`; deny-all permissions. |
| FINDING-security-003 | Vault lock does not clear vault-injected API keys from `process.env` | open | `lockSecretSession()` clears master password only. |
| FINDING-security-004 | Wallet keystore KDF N=16384 weaker than vault N=65536 | open | Tracked from Z5. |
| FINDING-security-005 | `document_delete` is destructive but `mutating:false` | open | Approval gate uses `mutating`, not `actionKind`. |
| FINDING-security-006 | Remote Docker contexts must remain rejected | monitor | Endpoint policy protects local DB/secrets/volumes from remote daemons. |
| FINDING-security-007 | Updater implementation absent, so no silent updater path exists today | monitor | Any future updater must stay user-triggered only. |

Do not treat this as a full release security audit. Production release needs fresh signing/updater/Docker/Electron verification.
