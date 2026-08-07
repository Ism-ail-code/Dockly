# Dockly

A sticky-note-first note-taking desktop app for students, built with Electron, React, TypeScript, TipTap and SQLite. Dockly opens into a compact, always-on-top sticky workspace so the journey from "open app" to "start writing" is one keystroke — while a full library dashboard handles subjects, favorites, archives and search.

## Features

- **Sticky workspace first** — launches into a docked, resizable, always-on-top note window with search, recent notes and a one-click new note
- **Library dashboard** — subjects, all notes, favorites, archive and study settings in a secondary management window
- **Rich text editor** — headings, lists, checklists, tables, code blocks, quotes, images and markdown-style shortcuts (TipTap)
- **Screenshot capture** — press Win + Shift + S anywhere; the snip lands directly in the active note (per-window capture modes)
- **Continuous autosave** — every keystroke is persisted locally via SQLite with version history
- **Customization** — themes, accent colors, compact mode, animations, dock transparency and tooltips
- **Fully offline** — all data stays on your PC

## Development

```bash
npm install
npm run typecheck   # TypeScript checks for main + renderer
npm run build       # bundles main, preload and renderer into dist/
npx electron .      # launch the app
```

## Tech Stack

- Electron 37 · React 18 · TypeScript · zustand · TipTap v2 · Vite · node:sqlite
