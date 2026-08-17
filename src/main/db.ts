import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Note, Subject, VersionSnapshot, Settings, AccentColor, SubjectStats } from '../shared/types';
import { DEFAULT_SETTINGS, EMPTY_DOC, VERSION_LIMIT } from '../shared/defaults';
import { extractPreviewFromDoc } from '../shared/preview';

let db: DatabaseSync;
let screenshotsDir: string;

export function initDb(userDataDir: string): void {
  const dbPath = path.join(userDataDir, 'nock.db');
  screenshotsDir = path.join(userDataDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS subjects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      icon TEXT NOT NULL DEFAULT 'book',
      color TEXT NOT NULL DEFAULT 'indigo',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_archived INTEGER NOT NULL DEFAULT 0,
      tags TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS screenshots (
      id TEXT PRIMARY KEY,
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS versions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS daily_stats (
      day TEXT PRIMARY KEY,
      notes INTEGER NOT NULL DEFAULT 0,
      shots INTEGER NOT NULL DEFAULT 0,
      edits INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_notes_subject ON notes(subject_id);
    CREATE INDEX IF NOT EXISTS idx_notes_updated ON notes(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_screenshots_note ON screenshots(note_id);
    CREATE INDEX IF NOT EXISTS idx_versions_note ON versions(note_id);
  `);
  // Migration: the preview column stores the note's text preview so list and
  // search queries never parse every note's JSON content again. Missing on
  // pre-existing databases; rows written before it existed are backfilled
  // lazily after boot (see backfillNotePreviews).
  try {
    db.exec(`ALTER TABLE notes ADD COLUMN preview TEXT NOT NULL DEFAULT ''`);
  } catch {
    // already migrated
  }
}

function rowToNote(r: Record<string, unknown>): Note {
  return {
    id: String(r.id),
    subjectId: String(r.subject_id),
    title: String(r.title ?? ''),
    content: String(r.content ?? EMPTY_DOC),
    isFavorite: Number(r.is_favorite) === 1,
    isArchived: Number(r.is_archived) === 1,
    tags: JSON.parse(String(r.tags ?? '[]')) as string[],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    screenshotCount: Number(r.screenshot_count ?? 0),
    preview: String(r.preview ?? ''),
  };
}

function rowToSubject(r: Record<string, unknown>): Subject {
  return {
    id: String(r.id),
    name: String(r.name),
    icon: String(r.icon),
    color: String(r.color) as AccentColor,
    sortOrder: Number(r.sort_order),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
}

export function extractPreview(contentJson: string): string {
  try {
    return extractPreviewFromDoc(JSON.parse(contentJson));
  } catch {
    return '';
  }
}

export function deriveTitle(contentJson: string): string {
  try {
    const doc = JSON.parse(contentJson);
    const walk = (node: unknown): string | null => {
      if (!node || typeof node !== 'object') return null;
      const n = node as { type?: string; text?: string; content?: unknown[] };
      if (n.text && n.type === 'text' && n.text.trim()) {
        return n.text.trim();
      }
      if (Array.isArray(n.content)) {
        for (const c of n.content) {
          const t = walk(c);
          if (t) return t;
        }
      }
      return null;
    };
    const t = walk(doc);
    return t ? t.slice(0, 80) : '';
  } catch {
    return '';
  }
}

// ---------- Subjects ----------

export function listSubjects(): Array<Subject & SubjectStats> {
  const rows = db
    .prepare(
      `SELECT s.*,
        (SELECT COUNT(*) FROM notes n WHERE n.subject_id = s.id AND n.is_archived = 0) AS note_count,
        (SELECT MAX(n.updated_at) FROM notes n WHERE n.subject_id = s.id) AS last_modified
       FROM subjects s ORDER BY s.sort_order ASC, s.created_at ASC`,
    )
    .all() as Record<string, unknown>[];
  return rows.map((r) => ({
    ...rowToSubject(r),
    noteCount: Number(r.note_count ?? 0),
    lastModified: Number(r.last_modified ?? r.created_at ?? 0),
  }));
}

export function createSubject(data: { name: string; icon: string; color: AccentColor; sortOrder: number }): Subject {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO subjects (id, name, icon, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, data.name, data.icon, data.color, data.sortOrder, now, now);
  return getSubject(id)!;
}

export function updateSubject(id: string, data: Partial<Pick<Subject, 'name' | 'icon' | 'color' | 'sortOrder'>>): Subject | null {
  const existing = getSubject(id);
  if (!existing) return null;
  const now = Date.now();
  db.prepare(`UPDATE subjects SET name = ?, icon = ?, color = ?, sort_order = ?, updated_at = ? WHERE id = ?`).run(
    data.name ?? existing.name,
    data.icon ?? existing.icon,
    data.color ?? existing.color,
    data.sortOrder ?? existing.sortOrder,
    now,
    id,
  );
  return getSubject(id);
}

export function deleteSubject(id: string): void {
  const shots = db.prepare(`SELECT path FROM screenshots WHERE note_id IN (SELECT id FROM notes WHERE subject_id = ?)`).all(id) as { path: string }[];
  for (const s of shots) {
    try { fs.rmSync(s.path, { force: true }); } catch { /* ignore */ }
  }
  db.prepare(`DELETE FROM subjects WHERE id = ?`).run(id);
}

export function getSubject(id: string): Subject | null {
  const r = db.prepare(`SELECT * FROM subjects WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToSubject(r) : null;
}

// ---------- Notes ----------

// Summary rows (list/search/favorites): no content payload. The editor loads
// the full note via getNote; every other surface uses only the columns below.
const NOTE_SELECT = `
  SELECT n.id, n.subject_id, n.title, n.is_favorite, n.is_archived, n.tags,
    n.created_at, n.updated_at, n.preview,
    (SELECT COUNT(*) FROM screenshots sc WHERE sc.note_id = n.id) AS screenshot_count
  FROM notes n`;

const NOTE_SELECT_FULL = `
  SELECT n.*,
    (SELECT COUNT(*) FROM screenshots sc WHERE sc.note_id = n.id) AS screenshot_count
  FROM notes n`;

export function listNotes(subjectId?: string, includeArchived = false): Note[] {
  let sql = NOTE_SELECT;
  const params: (string | number | null)[] = [];
  if (subjectId) {
    sql += ` WHERE n.subject_id = ?`;
    params.push(subjectId);
    if (!includeArchived) sql += ` AND n.is_archived = 0`;
  } else if (!includeArchived) {
    sql += ` WHERE n.is_archived = 0`;
  }
  sql += ` ORDER BY n.updated_at DESC`;
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  return rows.map(rowToNote);
}

export function listRecentNotes(limit = 6, excludeFavorites = false): Note[] {
  const rows = db
    .prepare(
      `${NOTE_SELECT} WHERE n.is_archived = 0${excludeFavorites ? ' AND n.is_favorite = 0' : ''} ORDER BY n.updated_at DESC LIMIT ?`,
    )
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToNote);
}

export function listFavoriteNotes(limit = 8): Note[] {
  const rows = db
    .prepare(`${NOTE_SELECT} WHERE n.is_favorite = 1 AND n.is_archived = 0 ORDER BY n.updated_at DESC LIMIT ?`)
    .all(limit) as Record<string, unknown>[];
  return rows.map(rowToNote);
}

export function listAllTags(): string[] {
  const rows = db.prepare(`SELECT DISTINCT tags FROM notes`).all() as { tags: string }[];
  const seen = new Set<string>();
  for (const r of rows) {
    try {
      for (const t of JSON.parse(r.tags) as string[]) seen.add(t);
    } catch {
      // malformed tags — ignore
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

export function getNote(id: string): Note | null {
  const r = db.prepare(`${NOTE_SELECT_FULL} WHERE n.id = ?`).get(id) as Record<string, unknown> | undefined;
  return r ? rowToNote(r) : null;
}

export function createNote(subjectId: string, title = ''): Note {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO notes (id, subject_id, title, content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, subjectId, title, EMPTY_DOC, now, now);
  return getNote(id)!;
}

export function updateNoteMeta(
  id: string,
  data: Partial<Pick<Note, 'title' | 'tags' | 'isFavorite' | 'isArchived' | 'subjectId'>>,
): Note | null {
  const existing = getNote(id);
  if (!existing) return null;
  const now = Date.now();
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (data.title !== undefined) { sets.push('title = ?'); params.push(data.title); }
  if (data.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(data.tags)); }
  if (data.isFavorite !== undefined) { sets.push('is_favorite = ?'); params.push(data.isFavorite ? 1 : 0); }
  if (data.isArchived !== undefined) { sets.push('is_archived = ?'); params.push(data.isArchived ? 1 : 0); }
  if (data.subjectId !== undefined) { sets.push('subject_id = ?'); params.push(data.subjectId); }
  if (sets.length === 0) return existing;
  sets.push('updated_at = ?');
  params.push(now, id);
  db.prepare(`UPDATE notes SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return getNote(id);
}

export function saveNoteContent(id: string, content: string, titleFromContent?: string, preview?: string): Note | null {
  // One cheap row read — never the full content. The title is only derived
  // from the document when the note has none yet, and the renderer supplies
  // the preview (it already holds the document), so the hot autosave path
  // parses no JSON at all.
  const existing = db.prepare(`SELECT title FROM notes WHERE id = ?`).get(id) as { title: string } | undefined;
  if (!existing) return null;
  const now = Date.now();
  const title = existing.title || titleFromContent || deriveTitle(content) || 'Untitled';
  const previewText = preview !== undefined ? preview.slice(0, 400) : extractPreview(content);
  db.prepare(`UPDATE notes SET content = ?, title = ?, preview = ?, updated_at = ? WHERE id = ?`).run(
    content, title, previewText, now, id,
  );
  return getNote(id);
}

export function deleteNote(id: string): void {
  const rows = db.prepare(`SELECT path FROM screenshots WHERE note_id = ?`).all(id) as { path: string }[];
  for (const r of rows) {
    try { fs.rmSync(r.path, { force: true }); } catch { /* ignore */ }
  }
  const dir = path.join(screenshotsDir, id);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  db.prepare(`DELETE FROM notes WHERE id = ?`).run(id);
}

export function duplicateNote(id: string): Note {
  const src = getNote(id);
  if (!src) throw new Error('note not found');
  const nid = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO notes (id, subject_id, title, content, is_favorite, is_archived, tags, preview, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(nid, src.subjectId, `${src.title || 'Untitled'} (copy)`, src.content, 0, 0, JSON.stringify(src.tags), src.preview, now, now);
  // copy screenshots
  const shots = db.prepare(`SELECT * FROM screenshots WHERE note_id = ?`).all(id) as Record<string, unknown>[];
  for (const s of shots) {
    const srcPath = String(s.path);
    if (!fs.existsSync(srcPath)) continue;
    const ext = path.extname(srcPath) || '.png';
    const destDir = path.join(screenshotsDir, nid);
    fs.mkdirSync(destDir, { recursive: true });
    const dest = path.join(destDir, `${randomUUID()}${ext}`);
    fs.copyFileSync(srcPath, dest);
    db.prepare(`INSERT INTO screenshots (id, note_id, path, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
      randomUUID(), nid, dest, Number(s.width), Number(s.height), now,
    );
    // rewrite references inside content
    const oldBase = path.basename(srcPath);
    const newBase = path.basename(dest);
    const updated = String(src.content).split(`/${oldBase}`).join(`/${newBase}`);
    db.prepare(`UPDATE notes SET content = ? WHERE id = ?`).run(updated, nid);
  }
  return getNote(nid)!;
}

// ---------- Screenshots ----------

export function noteScreenshotDir(noteId: string): string {
  const dir = path.join(screenshotsDir, noteId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function saveScreenshot(noteId: string, png: Buffer): { id: string; path: string; fileName: string } {
  const dir = noteScreenshotDir(noteId);
  const id = randomUUID();
  const fileName = `${id}.png`;
  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, png);
  db.prepare(`INSERT INTO screenshots (id, note_id, path, width, height, created_at) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id, noteId, filePath, 0, 0, Date.now(),
  );
  return { id, path: filePath, fileName };
}

export function replaceScreenshot(fileName: string, png: Buffer): { path: string } | null {
  const row = db.prepare(`SELECT id, note_id FROM screenshots WHERE path LIKE ?`).get(`%${fileName}`) as
    | { id: string; note_id: string }
    | undefined;
  if (!row) return null;
  const dest = path.join(screenshotsDir, row.note_id, fileName);
  fs.writeFileSync(dest, png);
  return { path: dest };
}

export function readScreenshotFile(fileName: string): Buffer | null {
  const row = db.prepare(`SELECT path FROM screenshots WHERE path LIKE ?`).get(`%${fileName}`) as { path: string } | undefined;
  if (!row) return null;
  try {
    return fs.readFileSync(row.path);
  } catch {
    return null;
  }
}

// ---------- Versions ----------

export function listVersions(noteId: string): VersionSnapshot[] {
  const rows = db.prepare(`SELECT id, note_id, content, created_at FROM versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 60`).all(noteId) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: Number(r.id),
    noteId: String(r.note_id),
    content: String(r.content),
    createdAt: Number(r.created_at),
  }));
}

export function pushVersion(noteId: string, content: string, createdAt: number): void {
  const latest = db.prepare(`SELECT content FROM versions WHERE note_id = ? ORDER BY created_at DESC LIMIT 1`).get(noteId) as
    | { content: string }
    | undefined;
  if (latest && latest.content === content) return;
  db.prepare(`INSERT INTO versions (note_id, content, created_at) VALUES (?, ?, ?)`).run(noteId, content, createdAt);
  const excess = db.prepare(
    `SELECT COUNT(*) AS c FROM (SELECT id FROM versions WHERE note_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?)`,
  ).get(noteId, VERSION_LIMIT) as { c: number };
  if (Number(excess.c) > 0) {
    db.prepare(
      `DELETE FROM versions WHERE note_id = ? AND id NOT IN (SELECT id FROM versions WHERE note_id = ? ORDER BY created_at DESC LIMIT ?)`,
    ).run(noteId, noteId, VERSION_LIMIT);
  }
}

export function getVersion(versionId: number): VersionSnapshot | null {
  const r = db.prepare(`SELECT id, note_id, content, created_at FROM versions WHERE id = ?`).get(versionId) as
    | Record<string, unknown>
    | undefined;
  return r ? { id: Number(r.id), noteId: String(r.note_id), content: String(r.content), createdAt: Number(r.created_at) } : null;
}

// ---------- Search ----------

export function searchNotes(q: string, scope: 'all' | 'favorites' | 'archived', limit = 40): { subject: Subject & SubjectStats; notes: Note[] }[] {
  const needle = `%${q.trim().toLowerCase()}%`;
  let sql = `${NOTE_SELECT} WHERE (LOWER(n.title) LIKE ? OR LOWER(n.content) LIKE ? OR LOWER(n.tags) LIKE ?)`;
  const params: (string | number | null)[] = [needle, needle, needle];
  if (scope === 'favorites') sql += ` AND n.is_favorite = 1 AND n.is_archived = 0`;
  else if (scope === 'archived') sql += ` AND n.is_archived = 1`;
  else sql += ` AND n.is_archived = 0`;
  sql += ` ORDER BY n.updated_at DESC LIMIT ?`;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Record<string, unknown>[];
  const bySubject = new Map<string, Note[]>();
  for (const r of rows) {
    const note = rowToNote(r);
    if (!bySubject.has(note.subjectId)) bySubject.set(note.subjectId, []);
    bySubject.get(note.subjectId)!.push(note);
  }
  const subjects = listSubjects();
  const result: { subject: Subject & SubjectStats; notes: Note[] }[] = [];
  for (const [sid, notes] of bySubject) {
    const subject = subjects.find((s) => s.id === sid);
    if (subject) result.push({ subject, notes });
  }
  return result;
}

// ---------- Settings ----------

export function getSettings(): Settings {
  const rows = db.prepare(`SELECT key, value FROM settings`).all() as { key: string; value: string }[];
  const merged: Record<string, unknown> = { ...DEFAULT_SETTINGS };
  for (const r of rows) merged[r.key] = JSON.parse(r.value);
  return merged as unknown as Settings;
}

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): Settings {
  db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(
    key,
    JSON.stringify(value),
  );
  return getSettings();
}

export function resetSettings(): Settings {
  // Onboarding is a one-time setup state, not a preference — keep it across resets.
  const wasOnboarded = getSettings().onboarded;
  db.prepare(`DELETE FROM settings`).run();
  if (wasOnboarded) db.prepare(`INSERT INTO settings (key, value) VALUES ('onboarded', 'true')`).run();
  return getSettings();
}

// ---------- Daily stats ----------

export type StatKind = 'note' | 'shot' | 'edit';

export function recordStat(kind: StatKind): void {
  try {
    const day = new Date().toISOString().slice(0, 10);
    const col = kind === 'note' ? 'notes' : kind === 'shot' ? 'shots' : 'edits';
    db.prepare(
      `INSERT INTO daily_stats (day, ${col}) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET ${col} = daily_stats.${col} + 1`,
    ).run(day);
  } catch {
    /* ignore */
  }
}

export function getTodayStats(): { day: string; notes: number; shots: number; edits: number } {
  const day = new Date().toISOString().slice(0, 10);
  const r = db.prepare(`SELECT day, notes, shots, edits FROM daily_stats WHERE day = ?`).get(day) as
    | { day: string; notes: number; shots: number; edits: number }
    | undefined;
  if (!r) return { day, notes: 0, shots: 0, edits: 0 };
  return { day: String(r.day), notes: Number(r.notes), shots: Number(r.shots), edits: Number(r.edits) };
}

export function screenshotCount(noteId: string): number {
  const r = db.prepare(`SELECT COUNT(*) AS c FROM screenshots WHERE note_id = ?`).get(noteId) as { c: number };
  return Number(r.c);
}

export function dbScreenshotsDir(): string {
  return screenshotsDir;
}

/**
 * One-time migration for databases created before the preview column existed:
 * fill previews for legacy rows. Chunked on setImmediate so it never blocks
 * startup — run it once, right after initDb.
 */
export function backfillNotePreviews(): void {
  const rows = db.prepare(`SELECT id, content FROM notes WHERE preview = ''`).all() as { id: string; content: string }[];
  if (rows.length === 0) return;
  const update = db.prepare(`UPDATE notes SET preview = ? WHERE id = ?`);
  let i = 0;
  const step = (): void => {
    const end = Math.min(i + 100, rows.length);
    for (; i < end; i++) {
      update.run(extractPreview(rows[i].content), rows[i].id);
    }
    if (i < rows.length) setImmediate(step);
  };
  setImmediate(step);
}

// ---------- QA seed data (perf harness only — NOCK_PERF_SEED) ----------

const SEED_WORDS = [
  'vector', 'scalar', 'force', 'momentum', 'energy', 'gravity', 'charge', 'current', 'resistance',
  'field', 'orbit', 'photon', 'electron', 'neutron', 'proton', 'atom', 'molecule', 'bond',
  'solute', 'solvent', 'concentration', 'equilibrium', 'catalyst', 'enzyme', 'mitosis', 'meiosis',
  'allele', 'chromosome', 'genotype', 'phenotype', 'equation', 'theorem', 'integral', 'derivative',
  'matrix', 'polynomial', 'function', 'limit', 'series', 'inference', 'syntax', 'semantics',
];

export function seedNotesForPerf(count: number): void {
  const now = Date.now();
  const subjects = ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English', 'Computer Science'];
  const subjectIds: string[] = [];
  for (const name of subjects) {
    const id = randomUUID();
    db.prepare(`INSERT INTO subjects (id, name, icon, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
      id, name, 'book', 'indigo', subjectIds.length, now, now,
    );
    subjectIds.push(id);
  }
  const tagsPool = [['Exam'], ['Assignment'], ['Formula'], ['Definition'], ['Important'], ['Revision'], ['Exam', 'Formula'], ['Definition', 'Important']];
  const insert = db.prepare(
    `INSERT INTO notes (id, subject_id, title, content, is_favorite, is_archived, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertSetting = db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (let i = 0; i < count; i++) {
    const title = `Seed Note ${i + 1} — ${SEED_WORDS[i % SEED_WORDS.length]} ${SEED_WORDS[(i * 7) % SEED_WORDS.length]}`;
    const body: Record<string, unknown>[] = [
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: `Section ${i + 1}` }] },
    ];
    for (let p = 0; p < 6; p++) {
      const words: string[] = [];
      for (let w = 0; w < 24; w++) {
        words.push(SEED_WORDS[(i * 13 + p * 5 + w) % SEED_WORDS.length]);
      }
      body.push({ type: 'paragraph', content: [{ type: 'text', text: words.join(' ') }] });
    }
    body.push({
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: SEED_WORDS[i % SEED_WORDS.length] }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: SEED_WORDS[(i + 1) % SEED_WORDS.length] }] }] },
      ],
    });
    const content = JSON.stringify({ type: 'doc', content: body });
    insert.run(
      randomUUID(),
      subjectIds[i % subjectIds.length],
      title,
      content,
      i % 25 === 0 ? 1 : 0,
      0,
      JSON.stringify(tagsPool[i % tagsPool.length]),
      now - (count - i) * 60_000,
      now - (count - i) * 60_000,
    );
    if (i === count - 1) insertSetting.run('lastNoteId', JSON.stringify(null));
  }
  insertSetting.run('onboarded', JSON.stringify(true));
  insertSetting.run('sessionResume', JSON.stringify(false));
}
