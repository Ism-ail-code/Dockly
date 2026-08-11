# Dockly

A sticky-note-first note-taking desktop app for students, built with Electron, React, TypeScript, TipTap and SQLite. Dockly opens into a compact, always-on-top sticky workspace so the journey from "open app" to "start writing" is one keystroke — while a full library dashboard handles subjects, favorites, archives and search.

## Features

- **Sticky workspace first** — launches into a docked, resizable, always-on-top note window with search, recent notes and a one-click new note
- **Library dashboard** — subjects, all notes, favorites, archive and study settings in a secondary management window
- **Rich text editor** — headings, lists, checklists, tables, code blocks, quotes, images and markdown-style shortcuts (TipTap)
- **Screenshot capture** — press Win + Shift + S anywhere; the snip lands directly in the active note (per-window capture modes)
- **Auto Capture Copied Text** — Ctrl + C in any other app appends the copied text into the active note, formatted with lists intact; copies made inside Dockly are never re-captured
- **Continuous autosave** — every keystroke is persisted locally via SQLite with version history
- **Customization** — themes, accent colors, compact mode, animations, dock transparency and tooltips
- **Fully offline** — all data stays on your PC

## Development

```bash
npm install
npm run typecheck   # TypeScript checks for main + renderer
npm run build       # bundles main, preload and renderer into dist/
npm run smoke       # build + scripted UI end-to-end regression
npm run cliptest    # build + clipboard capture end-to-end harness (setup + verify)
npx electron .      # launch the app
```

The clipboard harness (`scripts/cliptest.mjs`) drives the real app twice — a
setup role that simulates genuine clipboard changes and asserts event-driven
capture, and a verify role that relaunches and confirms the captured text
survived the restart. It runs against a scratch user-data dir so your notes
are never touched.

## Tech Stack

- Electron 37 · React 18 · TypeScript · zustand · TipTap v2 · Vite · node:sqlite
