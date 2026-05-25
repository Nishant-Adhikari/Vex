# Local runtime

Reference for contributors and QA running vex-app on their own machine.
Production release flow (signing, notarization, auto-updater) is intentionally
out of scope — see the release hardening track when it lands.

## Supported platforms

| OS | Versions | Notes |
|---|---|---|
| Windows | 10 + 11, x64 | Primary target |
| macOS | 13+ on Apple Silicon and Intel | Primary target |
| Linux (Ubuntu / Debian-based) | 22.04 + 24.04 | Primary target |
| WSL2 on Windows | — | **Dev environment only.** See WSL2 gotcha below. |

Other Linux distros may work but are not part of the QA matrix.

## Per-OS config paths

vex-app stores all user state in one directory rooted at the platform's
standard user-config location.

| OS | `CONFIG_DIR` |
|---|---|
| Linux | `$XDG_CONFIG_HOME/vex` (default `~/.config/vex`) |
| macOS | `~/Library/Application Support/vex` |
| Windows | `%APPDATA%/vex` (default `C:\Users\<user>\AppData\Roaming\vex`) |

Within `CONFIG_DIR`:

```
CONFIG_DIR/
  .env                              shared tracked env keys
  secrets.vault.json                encrypted API/provider credentials (scrypt + AES-256-GCM)
  .install-id                       per-install uuid (used by Docker project name)
  .setup-complete                   wizard completion flag
  keystore.json                     EVM keystore (encrypted)
  solana-keystore.json              Solana keystore (encrypted)
  config.json                       wallet addresses + chain config (plaintext, no secrets)
  compose/                          rendered docker-compose.yml + secrets
  local-infra/secrets/pg_password   Postgres password (generated per install)
  .electron-state/                  Electron-only (window state, session cache, log files)
```

Files OUTSIDE `.electron-state/` are shared runtime state for the desktop app.
Files INSIDE `.electron-state/` are Electron-private (Chromium cache, electron-log).

## WSL2 gotcha — Windows host

If you start vex-app from a WSL2 shell on a Windows host, the app launches as
a **Windows-native Electron process** (because the `electron` binary on
`$PATH` is the Windows binary in your project's `node_modules`).

That means:
- The app sees `process.platform === "win32"`, not `"linux"`.
- It reads + writes its config at `C:\Users\<user>\AppData\Roaming\vex\`
  (i.e. `%APPDATA%/vex`), **not** `~/.config/vex` inside WSL2.
- From WSL2 you can reach that directory at `/mnt/c/Users/<user>/AppData/Roaming/vex/`.

For a coherent dev environment, override the config root with
`VEX_CONFIG_DIR=<absolute path>` when launching the desktop app; it must be a
non-empty absolute path.

## Clean-slate reset

If a setup gets stuck mid-flow (e.g. corrupt vault, half-applied wizard,
stale Docker stack), reset:

### 1. Stop the running app

Close the desktop app. On Windows, verify no `vex.exe` lingers in Task Manager.

### 2. Tear down the Docker stack

Run `docker compose down` from the per-install compose directory so the
generated `docker-compose.yml` is auto-discovered. Pass `--volumes` to drop
the per-install Postgres data volume and embeddings cache:

```bash
# Replace <uuid> with the value of .install-id inside your CONFIG_DIR.
cd "$CONFIG_DIR/compose"
docker compose -p vex-<uuid> down --remove-orphans --volumes
```

If `$CONFIG_DIR/compose` is already gone (e.g. you deleted the config
directory before stopping the stack), fall back to the label-based path
which does NOT need a compose file:

```bash
# Stops running containers without deleting volumes.
docker ps --filter label=com.docker.compose.project=vex-<uuid> --format '{{.ID}}' \
  | xargs -r docker stop
# Drop volumes manually if needed:
docker volume ls --filter label=com.docker.compose.project=vex-<uuid> --format '{{.Name}}' \
  | xargs -r docker volume rm
```

If you don't know the install-id, list all Vex-labelled projects:

```bash
docker ps -a --filter label=com.docker.compose.project --format '{{.Names}}\t{{.Labels}}' | grep vex-
```

### 3. Delete the config directory

| OS | Command |
|---|---|
| Linux | `rm -rf ~/.config/vex` |
| macOS | `rm -rf "$HOME/Library/Application Support/vex"` |
| Windows (PowerShell) | `Remove-Item -Recurse -Force "$env:APPDATA\vex"` |
| WSL2 reaching Windows AppData | `rm -rf /mnt/c/Users/<user>/AppData/Roaming/vex` |

### 4. Verify Docker volumes are gone

Per-install volumes are named after the project label and disappear with
`docker compose down --volumes`. If you didn't pass `--volumes` above (the
default in step 2 is also without it — volumes are preserved by design),
manually:

```bash
docker volume ls --filter label=com.docker.compose.project=vex-<uuid>
docker volume rm <each-listed-volume>
```

### 5. Restart the app

A fresh `CONFIG_DIR` is created on next launch and the wizard flow restarts
from System Check.

## Diagnostic commands

```bash
# Is the Vex compose project running?
docker ps --filter label=com.docker.compose.project=vex-<uuid>

# Tail Postgres logs from the stack
docker compose -p vex-<uuid> logs -f postgres

# Tail embeddings-runtime logs
docker compose -p vex-<uuid> logs -f embeddings-runtime

# Probe Postgres TCP locally (replace <pg-port> with the value from compose)
nc -zv 127.0.0.1 <pg-port>

# View electron-log output
#   Linux:        ~/.config/vex/.electron-state/logs/main.log
#   macOS:        ~/Library/Application Support/vex/.electron-state/logs/main.log
#   Windows:      %APPDATA%\vex\.electron-state\logs\main.log
```
