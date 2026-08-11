# Dockly — project commands

## Verify before finishing a task

```bash
npm run typecheck   # tsc for main + renderer (both must pass)
npm run build       # esbuild main/preload/worker + vite renderer
npm run smoke       # scripted UI end-to-end regression in the real app
npm run cliptest    # clipboard capture E2E harness (setup + verify roles)
```

Run `npm run typecheck` and `npm run build` after any change. For renderer UI
changes also run `npm run smoke`; for clipboard-capture changes run
`npm run cliptest`.

## Architecture notes

- Main process is bundled from `src/main` (esbuild, CJS, electron external).
  The clipboard notifier worker (`src/main/clipboard-worker.ts`) is a separate
  esbuild entry — it must stay listed in `scripts/build.mjs`.
- `koffi` is a native FFI module and must stay in the esbuild `external` list.
- The QA harness (`scripts/cliptest.mjs`) sets `DOCKLY_CLIP_TEST=1` and a
  scratch `DOCKLY_CLIP_USER_DATA`; `src/main/index.ts` switches to that user
  data dir BEFORE `requestSingleInstanceLock` so it never collides with a
  running Dockly. It intentionally uses `app.exit()` + a synchronous taskkill
  hammer to terminate — Electron's graceful quit can deadlock mid-test.
