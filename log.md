# Nock — Windows 10 Testing Handoff

This file is the memory context + handover prompt for a testing agent that will
run on a **Windows 10** machine (different laptop, different platform). Nock has
never been actually tested on Windows 10 — only Windows 11. The code guards
Win11-only features, but that is unverified.

---

## Part 1 — Project Memory (context for the new agent)

### What it is
Nock is a sticky-note-first note-taking desktop app for students. Copy anything
while you study and it lands instantly in an always-available note docked beside
your window. Local-first, fully offline, free.

### Tech stack
- Electron 37.10.3 + React + TypeScript + TipTap editor + SQLite (`node:sqlite`)
- Main/preload/worker bundled with esbuild, renderer with Vite
- No external runtime dependencies; zero-dependency store-only ZIP writer for backups

### Repo
- Remote: `https://github.com/Ism-ail-code/Nock.git` (public)
- Current release: **v1.2.0**, published on GitHub as tag **`Nock_v1.2.0`** with
  assets `Nock-Setup-1.2.0.exe` (installer, signed) and `Nock-1.2.0-portable.exe`.
- v1.2.0 features: version-aware DB migrations (schema v2, `PRAGMA user_version`),
  `.nockbackup` export/restore, safety backups before migration/restore.
- Landing website: `https://github.com/Ism-ail-code/Nock-Website` (separate repo).

### Commands (run from repo root, Windows PowerShell)
| Command | What it does |
|---|---|
| `npm run build` | Production build (esbuild + vite → `dist/`) |
| `npm run typecheck` | `tsc --noEmit` (main + renderer) |
| `npm run test` | Unit tests — must stay 80/80 |
| `npm run smoke` | Full E2E tour (fresh isolated profile). Known timing flakiness under load — rerun for a pass; benchmark is 2 consecutive passes |
| `npm run cliptest` | Clipboard capture E2E (roles: setup/verify) |
| `npm run dist` | Signed NSIS installer + portable exe → `release/` |
| `npm run dist:portable` | Portable exe only |

### Data & storage model
- User data: `%APPDATA%\nock\` (`nock.db`, `screenshots/`, `backups/`). Never in
  the install dir. Never reset/recreated at startup.
- Dev isolation: `NOCK_DEV_USER_DATA` opt-in env → `app.setPath('userData', …)`.
- Uninstall does NOT delete user data.
- Backup format v1; rejected if `formatVersion !== 1` or `schemaVersion > current`.

### Test modes / env vars
- `NOCK_SMOKE=1` + `NOCK_SMOKE_USER_DATA` — full E2E tour, app exits at end.
- `NOCK_UPDATE_MOCK=error|up-to-date|available` — deterministic update-check mock.
- `NOCK_CLIP_TEST=1` + `NOCK_CLIP_ROLE=setup|verify` — clipboard E2E.
- `NOCK_PERF_USER_DATA` — perf profile.

### Known issues / caveats
- **Windows 10 is supported in code but NEVER actually tested — this is the whole
  point of this handoff.**
- Dock tooltip E2E check is hover/timing sensitive (hardened with force-hide;
  still flaky under load — rerun smoke).
- Backup export buffers the archive in memory (fine at realistic note counts).
- Win11-only acrylic background material is guarded in code
  (`fix: guard windows 11-only acrylic background material`) — verify the window
  renders normally on Win10.

---

## Part 2 — Copy-paste prompt for the Windows 10 testing agent

Paste the block below verbatim into your agent on the new machine.

---

```
You are a QA engineer. Project: Nock — a sticky-note-first note-taking desktop
app for students (Electron 37 + React + TypeScript + TipTap + SQLite), for
Windows. The app is finished and released at v1.2.0, but it was ONLY tested on
Windows 11. Your job: test it thoroughly on THIS machine, which runs Windows 10,
and report whether it works or what breaks.

Environment: Windows 10, PowerShell 5.1. Node v24.x. The repo is already on this
machine at the current working directory. Work in that directory. Do not push,
do not commit, do not create PRs, do not publish anything. Read the repo's
AGENTS.md and this log.md first for full context.

## 1. Baseline verification
- `npm install` (or `npm ci`) — confirm it succeeds.
- `npm run build` — must succeed with no errors.
- `npm run typecheck` — must pass clean.
- `npm run test` — all 80 unit tests must pass. If any fail on Win10, that is a
  reportable finding (flaky/OS-dependent test?).

## 2. Automated E2E suites
- `npm run smoke` — full E2E tour (fresh isolated profile: onboarding → nav →
  rapid switch → dock UI → all features → backup flow). It is KNOWN to be
  timing-flaky under load on Win11: rerun until you get a pass; then run it a
  second time for a pass to confirm (benchmark = 2 consecutive passes). Record
  how many reruns were needed and any failure modes — that itself is a finding.
- `npm run cliptest` — clipboard capture E2E (runs setup then verify roles).
  This is CRITICAL on Windows 10: clipboard image capture APIs differ between
  OS versions. If this fails, document exactly what failed.

## 3. Manual Win10-specific testing (installer + running app)
Use `NOCK_DEV_USER_DATA` to isolate dev data during testing:
`$env:NOCK_DEV_USER_DATA = "$env:TEMP\nock-win10-test"` before launching
`npm start` (or launch the built app). Never touch real user data.

Test with BOTH the NSIS installer (`release/Nock-Setup-1.2.0.exe`, signed) and
the portable exe (`release/Nock-1.2.0-portable.exe`):
- Installer installs, launches, uninstaller works.
- Portable exe runs standalone; data goes to %APPDATA%\nock (same as installed).
- Window opens and renders correctly — especially the main window background
  (a Win11-only acrylic material is guarded on other OS versions; verify no
  visual glitch, no transparent/black window, no crash on Win10).
- Onboarding completes end-to-end (welcome → subject setup → first note).
- Core loop: create subject → create note → type/format text (bold, lists,
  checkboxes) → screenshot lands from clipboard (Ctrl+V or the capture flow) →
  note persists after restart.
- Dock window: appears/anchors beside the main window, tooltips work, switching
  between dock and library is smooth.
- Settings: dark mode, storage path shown, update check (use
  `NOCK_UPDATE_MOCK=available` / `up-to-date` / `error` to exercise all three
  paths without a real server).
- Backup: Settings → Data & Storage → Export creates a .nockbackup; Import
  restores it; restoring a corrupted/mutated backup file is REJECTED with the
  message "This backup cannot be restored because it is invalid or incompatible
  with this version of Nock."; a safety backup appears in
  `%APPDATA%\nock\backups\` before restore.
- Migrations: with `NOCK_DEV_USER_DATA` pointed at an old v1 DB (create one by
  using an older build or ask the project owner), confirm boot migrates it
  safely (schema v1 → v2) and writes `nock.pre-migration.db`.

## 4. OS-level checks (Windows 10 specific)
- Taskbar: dock/minimize/restore behavior, app icon, single-instance lock.
- HiDPI / display scaling (125% or 150% is common on Win10): no blurry/bloated
  UI, click targets aligned.
- SmartScreen: first run of the installer may show "Windows protected your PC" —
  document whether it appears (expected for unsigned reputation).
- Autostart: if the app offers a "launch at startup" toggle, verify it works on
  Win10 (registry Run key) and survives reboot.
- Global shortcuts (if any exist): register while other apps have focus.
- Long session stability: leave the app open 30+ minutes, alt-tab between apps,
  copy text/images repeatedly — no crashes, no memory ballooning.

## 5. Report format
Produce a final report with:
1. Environment: exact Windows 10 build/version, Node version, resolution/scaling.
2. PASS/FAIL/WARN table: baseline, smoke (incl. rerun count), cliptest, each
   manual item above.
3. For every FAIL/WARN: exact repro steps, console/devtools errors, screenshots
   where possible, and the relevant source file/line if you can pinpoint it.
4. Verdict: is v1.2.0 safe to claim as "Windows 10 supported" on the website, or
   what must be fixed first?
```

---

## Part 3 — Notes for the project owner

- Copy `log.md` (or its Part 2) to the Win10 machine along with a clone of the
  repo. The agent needs Node 24 + npm only.
- Ask the tester to keep `NOCK_DEV_USER_DATA` set so no real user data is
  touched, and to never run against `%APPDATA%\nock` unless explicitly testing
  the real install path (installer test).
- When results come back: if the acrylic guard or clipboard path needs fixes,
  commit as `fix:` items, bump version, re-release, and update the website pill
  if the version changes.