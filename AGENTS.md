# Nock — Project Context

Sticky-note-first note-taking desktop app for students. Electron + React + TypeScript + TipTap + SQLite. Local-first, fully offline.

## Repo

- Remote: `https://github.com/Ism-ail-code/Nock.git` — do NOT push/publish without explicit user confirmation.
- Windows dev machine (win32, PowerShell 5.1). Electron 37.10.3, Node v24.14.1. Windows 10 is supported in code but NOT actually tested (Win11 box only).
- `session-log.md` is gitignored — never commit it.

## Commands

| Command | What it does |
|---|---|
| `npm run build` | Production build (esbuild main/preload/worker + vite renderer → `dist/`) |
| `npm run typecheck` | `tsc --noEmit` for main + renderer tsconfigs |
| `npm run test` | Unit tests (scripts/test.mjs bundles + runs `tests/*.test.ts`) — currently 80/80 |
| `npm run smoke` | Full E2E tour (fresh isolated profile, onboarding → all features → backup flow). Known timing flakiness under load; rerun for a pass, benchmark = 2 consecutive passes. Verifies safety backup on disk + corrupt-backup rejection |
| `npm run cliptest` | Clipboard capture E2E (setup + verify roles) |
| `npm run dist` | Build + signed NSIS installer + portable exe → `release/` |
| `npm run dist:portable` | Portable exe only |

After a dist build: regenerate `release/checksums.txt`; `latest.yml` is written by electron-builder.

## Current Release State (1.2.0)

**Published on GitHub**: release "Nock v1.2.0" tagged `Nock_v1.2.0` with assets
`Nock-Setup-1.2.0.exe`, `Nock-1.2.0-portable.exe`, `latest.yml`, `checksums.txt`.
Download URLs verified live (200, correct sizes).

IMPORTANT — repo sync state (checked 2026-08-18):
- Remote `main` and the `Nock_v1.2.0` tag still point at `2d3ec81`
  (pre-1.2.0 code — the tag was created from GitHub UI, not from local).
  The shipped binaries are correct; only the source history is ahead.
- Local commits NOT pushed yet:
  - `b8f3f0b` feat: add version-aware database migrations
  - `04d5bd0` feat: add nock backup export and restore
  - `baa37bb` test: cover backup round-trip, migration safety and e2e backup flow
  - `7dc2305` chore(release): bump version to 1.2.0
  - `1130fc5` docs: add Windows 10 testing handoff log
- To make the tag match the shipped binaries, push commits and recreate/move
  `Nock_v1.2.0` to `7dc2305` (ask user first). Tag naming is `Nock_vX.Y.Z`,
  NOT `vX.Y.Z` — the website config has a `tag` override for this.
- `AGENTS.md` itself is currently untracked (never committed; do not commit
  without explicit request).

Artifacts in `release/` (signed): `Nock-Setup-1.2.0.exe`, `Nock-1.2.0-portable.exe`, `latest.yml` (1.2.0), `checksums.txt`. Stale 1.1.0 exes removed. asar verified clean (5991 entries, no dev data).

## Architecture Map

- `src/main/index.ts` — app entry, window hub (main library window + dock window), E2E scripts (FULL_SCRIPT, DOCK_FULL_SCRIPT, onboarding, backup tour), env-driven test modes.
- `src/main/db.ts` — SQLite via `node:sqlite` `DatabaseSync`. `SCHEMA_VERSION = 2` via `PRAGMA user_version`; ordered guarded `MIGRATIONS` array (v0→1 baseline DDL, v1→2 preview column). Pre-migration safety snapshot `nock.pre-migration.db` (VACUUM INTO). Newer-schema DBs are left untouched at boot. Exports `getDbPath`, `schemaVersion`, `closeDb`, `snapshotTo`, `countData`, `repointScreenshotPaths`, `dbScreenshotsDir`, CRUD for subjects/notes/screenshots/versions/settings/daily_stats.
- `src/main/zip.ts` — store-only ZIP writer/reader (crc32, UTF-8 names, CRC + bounds + path-traversal defenses, entry limit). No external dependency.
- `src/main/backup.ts` — `.nockbackup` format v1: `manifest.json` + `nock.db` (atomic `VACUUM INTO` snapshot) + `screenshots/<noteId>/<file>`. `exportBackup(destPath, appVersion)`, `inspectBackup(srcPath)`, `restoreBackup(srcPath, appVersion)` (validate → verify embedded DB → safety backup `%userData%\backups\pre-restore-<ts>.nockbackup` → swap with rollback → re-run migrations → re-point screenshots). No electron imports.
- `src/main/ipc.ts` — IPC registry; sync `handle` wrapper returns `{ok, data|error}` (logs `[ipc] error:`). Backup channels: `backup:counts`, async `backup:export`/`backup:pick-import`/`backup:restore` (manual envelope), `backup:inspect`. `app:info` includes `userData`. Smoke mode bypasses dialogs: export → `<userData>/_smoke_export.nockbackup`; import consumes fixed queue `[_smoke_export.nockbackup, _smoke_corrupt.nockbackup]`.
- `src/preload/index.ts` — `window.nock.*` bridge (`backup.counts/export/pickImport/inspect/restore`, etc.); throws on `{ok:false}`.
- `src/shared/types.ts` — shared types incl. `DataCounts`, `BackupManifest`, `BackupExportResult`, `BackupRestoreResult`.
- `src/shared/defaults.ts` — `DEFAULT_SETTINGS`, `EMPTY_DOC`, `VERSION_LIMIT`.
- `src/renderer/` — React app. `views/SettingsView.tsx` has Data & Storage category → `DataPanel` (counts, Export/Import buttons, storage path, import-confirm modal "Restore Nock Backup?"). About label shows "Nock v1.2".
- `scripts/smoke.mjs` — E2E driver: wipes/recreates `%TEMP%\nock-e2e-userdata`, pre-writes `_smoke_corrupt.nockbackup`, parses `E2E_RESULT` (blocks: onboarding, nav, rapidSwitch, dockUi, full [contains st/bk/sr/upd], dockFull), checks `safety backups on disk`, cleans up at exit.
- `scripts/cliptest.mjs` — clipboard E2E (roles: setup/verify).
- `tests/` — unit tests: `zip.test.ts`, `migration.test.ts`, `backup.test.ts`, plus pre-existing (settings.defaults etc.).
- `log.md` (committed `1130fc5`) — Windows 10 testing handoff: project memory + copy-paste QA prompt for an agent on a real Win10 machine. User plans to remove this file later (ask before touching).

## Data & Storage Model

- User data: `%APPDATA%\nock\` (`nock.db`, `screenshots/`, `backups/`). Never in install dir. Never reset/recreated at startup.
- Dev isolation: `NOCK_DEV_USER_DATA` opt-in env → `app.setPath('userData', …)`.
- Uninstall does NOT delete user data (`deleteAppDataOnUninstall: false`).
- Backup format version 1; rejected if `formatVersion !== 1` or `schemaVersion > current`. Invalid/corrupt → "This backup cannot be restored because it is invalid or incompatible with this version of Nock."
- Auto-backups (scheduled) are deliberately NOT implemented (user decision).

## Test Modes / Env Vars

- `NOCK_SMOKE=1` + `NOCK_SMOKE_USER_DATA` — full E2E tour, app exits at end.
- `NOCK_UPDATE_MOCK=error|up-to-date|available` — deterministic update-check mock for QA; production never sets it.
- `NOCK_CLIP_TEST=1` + `NOCK_CLIP_ROLE=setup|verify` — clipboard E2E.
- `NOCK_PERF_USER_DATA` — perf profile.

## Known Issues / Caveats

- Dock tooltip E2E check is hover/timing sensitive (hardened with force-hide between hovers; still flaky under load — rerun smoke).
- Backup export buffers the archive in memory (fine at realistic note counts).
- Windows 10 not actually tested.
- Open workstream: **Windows 10 testing** — app still untested on Win10; handoff ready in `log.md` (copy-paste prompt for a test agent on a real Win10 machine). `docs/index.html` website in this repo is stale.
- **Nock-Website** (separate repo, `Ism-ail-code/Nock-Website`, Vercel deploy): pushed — `origin/main` = `5a63f98` "chore: point downloads at Nock v1.2.0 release". Release config lives in `NOCK_RELEASE` at the bottom of `index.html` (`version: '1.2.0'`, `tag: 'Nock_v1.2.0'`). Confirm in Vercel dashboard that the latest deployment is `5a63f98`.
- `git status` currently shows `AGENTS.md` untracked (expected); `release/` artifacts are gitignored.

## Conventions

- Never add code comments unless asked.
- Write tests alongside features; keep 80/80 green; typecheck clean before committing.
- Commit logically (feat / fix / test / chore(release)); ask before pushing/publishing.
- Use `git status`, `git diff`, `git log --oneline -10` before committing; never commit secrets or user data.