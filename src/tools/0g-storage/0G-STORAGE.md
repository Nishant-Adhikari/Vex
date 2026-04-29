# 0G Storage — Decentralized File Storage & Virtual Drive

> Upload, download, and organize files on the 0G Storage network. Local JSON index provides a virtual filesystem (paths, dirs, ls, find, mv, rm) over content-addressed blobs. SDK interaction via CJS bridge.
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/tools/0g-storage/
  types.ts          — Domain types: DriveIndex, DriveEntry, UploadResult, DownloadResult, FileInfo
  client.ts         — Storage client config factory (endpoints + wallet key)
  cost.ts           — Cost calculation from balance diff (wei → 0G formatting)
  files.ts          — File operations: upload, download, getFileInfo (via CJS SDK bridge)
  drive-index.ts    — Virtual filesystem: path CRUD, ls, tree, find, du, mv, snapshots
```

---

## Architecture

```
Local filesystem (real files)
  │
  ▼
files.ts: upload/download (SDK via sdk-bridge.cjs)
  ├── Upload: file → 0G network → root hash + tx hash + cost
  ├── Download: root hash → local file
  └── Info: root/txSeq → finalized, size, cached status
  │
  ▼
drive-index.ts: virtual path layer
  ├── Maps virtual paths (/docs/readme.md) → root hashes
  ├── Supports dirs, ls, tree, find, du, mv, rm
  └── Persisted in ~/.vex/storage-drive.json
```

---

## File Operations (`files.ts`)

All SDK calls go through `sdk-bridge.cjs` (CJS bridge) wrapped in `withSuppressedConsole()`.

| Function | What it does |
|----------|-------------|
| `uploadFile(config, filePath, tags?)` | Upload → returns `{ root, txHash, sizeBytes, checksum, cost }` |
| `downloadFile(config, root, outPath, withProof?)` | Download by root hash → local file |
| `getFileInfo(config, { root?, txSeq? })` | Query file status (finalized, size, cached) |

Cost calculated from wallet balance diff (pre/post upload) since SDK doesn't return cost directly.

---

## Virtual Drive Index (`drive-index.ts`)

Local JSON index over content-addressed 0G Storage blobs. Flat path keys, implicit directory creation.

### Path Rules

- Max path length: 512 chars, max segment: 255 chars
- Allowed chars: `a-zA-Z0-9-_./`
- No `.` or `..` segments (path traversal blocked)
- Dirs end with `/`, files don't

### CRUD

| Function | Behavior |
|----------|----------|
| `drivePut(index, vpath, entry)` | Add file entry + implicit parent dirs |
| `driveGet(index, vpath)` | Get entry or throw `INDEX_NOT_FOUND` |
| `driveMkdir(index, vpath)` | Create directory (idempotent) |
| `driveRm(index, vpath)` | Remove entry + children if directory |
| `driveMv(index, from, to)` | Move entry + children, implicit parent dirs at destination |

### Query

| Function | Returns |
|----------|---------|
| `driveLs(index, dir, recursive?)` | Direct children (or recursive), sorted dirs-first |
| `driveTree(index, dir)` | Indented text tree view |
| `driveFind(index, pattern)` | Glob match against filename and full path |
| `driveDu(index, dir)` | Total bytes + file count under directory |

### Snapshots

`addSnapshot(index, root)` — records a point-in-time snapshot with entry count. Used for backup/restore.

### Persistence

- File: `~/.vex/storage-drive.json`
- Atomic write (tmp + rename)
- Version-checked on load (v1)

---

## Cost Formatting (`cost.ts`)

| Function | Input | Output |
|----------|-------|--------|
| `formatCost(weiDiff)` | Balance diff in wei | `{ totalWei: "...", total0G: "X.XXXXXX" }` |
| `formatCostDisplay(cost)` | CostInfo | `"0.001234 0G"` |

---

## Client Config (`client.ts`)

| Function | Purpose |
|----------|---------|
| `getStorageEndpoints(overrides?)` | Resolve endpoints from config (evmRpcUrl, indexerRpcUrl, flowContract) |
| `getStorageClientConfig(overrides?)` | Endpoints + wallet private key + address |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `sdk-bridge.cjs` | CJS bridge for 0G Storage SDK (ethers/SDK interop) |
| `tools/0g-compute/bridge.ts` | `withSuppressedConsole()` |
| `tools/wallet/auth.ts` | `requireWalletAndKeystore()` |
| `config/store.ts` | `loadConfig()` — storage endpoints |
| `config/paths.ts` | `STORAGE_DRIVE_FILE`, `CONFIG_DIR` |
| `utils/minimatch.ts` | Glob matching for `driveFind` |
| `errors.ts` | `VexError`, `ErrorCodes` |

---

## CLI Entry Point

`commands/0g-storage/` — setup, wizard, file (upload/download/info), drive (ls/tree/put/get/rm/mv/find/du), note, backup.

---

## Tests

```bash
npx vitest run src/__tests__/0g/
```

| File | Coverage |
|------|----------|
| `0g-storage-commands.test.ts` | Command tree structure |
| `0g-storage-cost.test.ts` | Cost formatting (wei → 0G) |
| `0g-storage-drive-index.test.ts` | All drive operations: put, get, ls, tree, find, du, mv, rm, mkdir, snapshots, path validation |
| `0g-storage-files.test.ts` | Upload/download/info with mock SDK bridge |
