# Nock — Release Notes

## Application

- **Name:** Nock
- **Version:** 1.2.0
- **Supported Windows:** Windows 10 / 11, 64-bit
- **Type:** Sticky-note-first note-taking desktop app (always-on-top dock + library)
- **License:** MIT

## Build & Package Commands

All commands run from the project root with Node.js + npm installed (a dev
machine only needs these tools to *build*; the installed app itself needs
nothing).

```bash
npm install                 # install dependencies (one time)
npm run build               # production build (bundles main/preload/worker/renderer into dist/)
npm run dist                # build + create installer (NSIS) AND portable exe
npm run dist:portable       # build + portable exe only
```

## Output Location

Everything lands in `release/`:

```
release/
    Nock-Setup-1.2.0.exe        # installer (recommended)
    Nock-1.2.0-portable.exe     # no-install portable build
    win-unpacked/Nock.exe       # the raw packaged executable
    checksums.txt               # SHA-256 of the installers
```

## Installing

1. Download `Nock-Setup-1.2.0.exe`.
2. Double-click it (Windows SmartScreen may warn because the build is not
   code-signed — click **More info → Run anyway**).
3. Choose install location and shortcuts, then **Install**.
4. Launch **Nock** from the Start Menu or the desktop shortcut.

The portable build (`Nock-1.2.0-portable.exe`) needs no install — just run it.

## Uninstalling

- Open **Settings → Apps → Installed apps**, find **Nock**, and click
  **Uninstall**. This removes the program files, Start Menu/desktop shortcuts
  **and all Nock user data** (notes, subjects, screenshots, settings — the
  `%APPDATA%\nock` folder), including the Windows autostart entry.
- Installing Nock again afterwards starts completely fresh (first-run
  onboarding).
- Updates never delete user data: installing a newer version over an existing
  one keeps every note, subject, screenshot and setting.
- Backups you exported (`.nockbackup` files) are saved where you chose —
  typically outside `%APPDATA%\nock` — so they survive uninstall and can be
  imported after a fresh install.

## Where User Data Lives

Nock is local-first and fully offline. All user data is stored per-user and is
**not** inside the installation directory, so it survives updates,
reinstalls and moving the app.

```
%APPDATA%\nock\
```

- The SQLite database (`nock.db`) holds notes, subjects, settings, and version
  history. The database carries a schema version (`PRAGMA user_version`) and
  older databases are migrated automatically on first launch — never reset.
- Screenshot/image files are stored under the same directory.
- A safety copy (`nock.pre-migration.db`) may be left next to the database when
  a schema migration runs.

The folder is created automatically on first run and removed on uninstall.

## First Run

Nock creates its data directory, database and settings automatically on first
launch. No terminal, environment variables, or manual folder creation are
needed — it simply opens and works.

## Creating a New Release

1. Bump the version:
   - `package.json` → `"version"` (and the matching top-level version in
     `package-lock.json`).
   - Update the About label in `src/renderer/views/SettingsView.tsx`
     (e.g. `Nock v1.1`).
2. Verify: `npm run typecheck`, `npm run test`, `npm run smoke`.
3. Build: `npm run dist`.
4. Regenerate `release/checksums.txt`.
5. Commit, tag (`v1.2.0`), and push. Attach the exes to a GitHub Release
   (`Nock-Setup-1.2.0.exe`, `Nock-1.2.0-portable.exe`) and mirror them on
   your download host.

## Known Limitations

- The executables are **not code-signed**, so Windows SmartScreen shows an
  "unknown publisher" warning on first run on machines without the publisher
  already trusted.
- First-time capture of copied text on some systems may require approving the
  clipboard permission once in Windows Settings.
