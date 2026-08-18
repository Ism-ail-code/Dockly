import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { initDb, closeDb, countData, schemaVersion, getDbPath, createSubject, createNote, setSetting } from '../src/main/db';

function tempDir(label: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `nock-mig-${label}-`));
  return dir;
}

function userVersionOf(dbFile: string): number {
  const d = new DatabaseSync(dbFile, { readOnly: true });
  try {
    return Number((d.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
  } finally {
    d.close();
  }
}

describe('database migrations', () => {
  it('initializes a fresh database to the current schema version', () => {
    const dir = tempDir('fresh');
    initDb(dir);
    assert.equal(schemaVersion(), 2);
    assert.equal(userVersionOf(getDbPath()), 2);
    const d = new DatabaseSync(getDbPath(), { readOnly: true });
    const cols = d.prepare(`SELECT name FROM pragma_table_info('notes')`).all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'preview'));
    d.close();
    closeDb();
  });

  it('preserves legacy data and migrates a v0 database that lacks the preview column', () => {
    const dir = tempDir('legacy');
    const dbFile = path.join(dir, 'nock.db');
    const d = new DatabaseSync(dbFile);
    d.exec(`
      CREATE TABLE subjects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT 'book',
        color TEXT NOT NULL DEFAULT 'indigo', sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE notes (
        id TEXT PRIMARY KEY, subject_id TEXT NOT NULL, title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL, is_favorite INTEGER NOT NULL DEFAULT 0, is_archived INTEGER NOT NULL DEFAULT 0,
        tags TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE screenshots (
        id TEXT PRIMARY KEY, note_id TEXT NOT NULL, path TEXT NOT NULL,
        width INTEGER NOT NULL, height INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT NOT NULL, content TEXT NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE daily_stats (
        day TEXT PRIMARY KEY, notes INTEGER NOT NULL DEFAULT 0, shots INTEGER NOT NULL DEFAULT 0, edits INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO subjects (id, name, icon, color, sort_order, created_at, updated_at) VALUES ('s1', 'Legacy', 'book', 'indigo', 0, 1, 1);
      INSERT INTO notes (id, subject_id, title, content, created_at, updated_at) VALUES ('n1', 's1', 'Old note', '{}', 1, 1);
      INSERT INTO settings (key, value) VALUES ('theme', '"light"');
    `);
    d.close();

    initDb(dir);
    assert.equal(schemaVersion(), 2);
    assert.equal(userVersionOf(getDbPath()), 2);
    const counts = countData();
    assert.equal(counts.subjects, 1);
    assert.equal(counts.notes, 1);
    assert.equal(counts.settings, 1);
    const d2 = new DatabaseSync(getDbPath(), { readOnly: true });
    const cols = d2.prepare(`SELECT name FROM pragma_table_info('notes')`).all() as { name: string }[];
    assert.ok(cols.some((c) => c.name === 'preview'));
    const row = d2.prepare(`SELECT title FROM notes WHERE id = 'n1'`).get() as { title: string };
    assert.equal(row.title, 'Old note');
    d2.close();
    closeDb();
  });

  it('is a no-op on a database that already has the preview column (repeatable)', () => {
    const dir = tempDir('repeat');
    initDb(dir);
    const subject = createSubject({ name: 'Math', icon: 'book', color: 'indigo', sortOrder: 0 });
    createNote(subject.id, '');
    setSetting('theme', 'midnight');
    closeDb();

    // Reopen the same database a second time — the migration path must not
    // error and must not touch the data.
    initDb(dir);
    assert.equal(schemaVersion(), 2);
    assert.equal(countData().subjects, 1);
    assert.equal(countData().settings, 1);
    closeDb();
  });

  it('leaves a newer-schema database untouched', () => {
    const dir = tempDir('future');
    const dbFile = path.join(dir, 'nock.db');
    const d = new DatabaseSync(dbFile);
    d.exec(`PRAGMA user_version = 99`);
    d.close();

    initDb(dir);
    assert.equal(userVersionOf(getDbPath()), 99);
    closeDb();
  });
});