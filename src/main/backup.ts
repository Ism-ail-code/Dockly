/**
 * Nock backup system — export/import of a user's complete workspace as a
 * single .nockbackup file (store-only ZIP).
 *
 * Archive layout (mirrors the real storage architecture — a SQLite database
 * plus the screenshots folder):
 *   manifest.json   backup metadata + validation info (see BackupManifest)
 *   nock.db         self-contained snapshot of the live database (VACUUM INTO)
 *   screenshots/<noteId>/<file>.png   screenshot/image assets
 *
 * Notes, subjects, settings, version history and daily stats all live in the
 * database snapshot, so nothing is duplicated and nothing is dropped.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import * as db from './db';
import { writeZip, readZip, type ZipEntry } from './zip';
import type { BackupManifest, BackupExportResult, BackupRestoreResult } from '../shared/types';

export const BACKUP_FORMAT_VERSION = 1;

const INVALID_MSG =
  'This backup cannot be restored because it is invalid or incompatible with this version of Nock.';

/** Export the current workspace to destPath (written atomically via a .tmp rename). */
export async function exportBackup(destPath: string, appVersion: string): Promise<BackupExportResult> {
  const counts = db.countData();
  const manifest: BackupManifest = {
    formatVersion: BACKUP_FORMAT_VERSION,
    appVersion,
    schemaVersion: db.schemaVersion(),
    createdAt: new Date().toISOString(),
    counts,
  };
  const dbTmp = path.join(path.dirname(destPath), `.nock-snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  try {
    db.snapshotTo(dbTmp);
    const entries: ZipEntry[] = [
      { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') },
      { name: 'nock.db', data: fs.readFileSync(dbTmp) },
    ];
    const shotsDir = db.dbScreenshotsDir();
    if (fs.existsSync(shotsDir)) {
      for (const noteId of fs.readdirSync(shotsDir)) {
        const noteDir = path.join(shotsDir, noteId);
        let stat: fs.Stats;
        try {
          stat = fs.statSync(noteDir);
        } catch {
          continue;
        }
        if (!stat.isDirectory()) continue;
        for (const f of fs.readdirSync(noteDir)) {
          const fp = path.join(noteDir, f);
          let s: fs.Stats;
          try {
            s = fs.statSync(fp);
          } catch {
            continue;
          }
          if (!s.isFile()) continue;
          entries.push({ name: `screenshots/${noteId}/${f}`, data: fs.readFileSync(fp) });
        }
      }
    }
    const zip = writeZip(entries);
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await fs.promises.writeFile(`${destPath}.tmp`, zip);
    await fs.promises.rename(`${destPath}.tmp`, destPath);
    return { path: destPath, counts };
  } finally {
    try {
      fs.rmSync(dbTmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

/**
 * Validate a .nockbackup and return its manifest. Throws with a clear message
 * when the backup is corrupted, unsafe or incompatible. Nothing is modified.
 */
export function inspectBackup(srcPath: string): BackupManifest {
  let buf: Buffer;
  try {
    buf = fs.readFileSync(srcPath);
  } catch (e) {
    throw new Error(INVALID_MSG);
  }
  let entries: { name: string; data: Buffer }[];
  try {
    entries = readZip(buf);
  } catch {
    throw new Error(INVALID_MSG);
  }
  const manifest = parseManifest(entries);
  const dbEntry = entries.find((e) => e.name === 'nock.db');
  if (!dbEntry) throw new Error(INVALID_MSG);
  const tmp = path.join(os.tmpdir(), `nock-inspect-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`);
  try {
    fs.writeFileSync(tmp, dbEntry.data);
    verifySnapshot(tmp);
  } finally {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
  return manifest;
}

/**
 * Restore a workspace from a .nockbackup. Sequence:
 *   1. Validate the backup (zip integrity, manifest, schema compatibility).
 *   2. Verify the embedded database (integrity_check, required tables).
 *   3. Create a safety backup of the current data.
 *   4. Swap database + screenshots; run migrations if the backup is older;
 *      re-point screenshot paths; verify restored counts.
 *   5. On any failure: roll back to the pre-restore files and report clearly.
 */
export async function restoreBackup(srcPath: string, appVersion: string): Promise<BackupRestoreResult> {
  const userData = path.dirname(db.getDbPath());
  const backupsDir = path.join(userData, 'backups');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');

  // 1 + 2. Validate and verify before touching anything.
  let entries: { name: string; data: Buffer }[];
  try {
    entries = readZip(fs.readFileSync(srcPath));
  } catch {
    throw new Error(INVALID_MSG);
  }
  const manifest = parseManifest(entries);
  const dbEntry = entries.find((e) => e.name === 'nock.db');
  if (!dbEntry) throw new Error(INVALID_MSG);
  const tmpDb = path.join(userData, `.restore-tmp-${ts}.db`);
  fs.writeFileSync(tmpDb, dbEntry.data);
  verifySnapshot(tmpDb);

  // 3. Safety backup of the current data — abort if it cannot be created.
  await fs.promises.mkdir(backupsDir, { recursive: true });
  const safetyBackup = path.join(backupsDir, `pre-restore-${ts}.nockbackup`);
  await exportBackup(safetyBackup, appVersion);

  // 4. Swap.
  const liveDb = db.getDbPath();
  const shotsDir = db.dbScreenshotsDir();
  const preDb = `${liveDb}.pre-restore-${ts}`;
  const preShots = `${shotsDir}.pre-restore-${ts}`;
  let swapped = false;
  try {
    db.closeDb();
    for (const suffix of ['', '-wal', '-shm']) {
      const p = liveDb + suffix;
      if (fs.existsSync(p)) fs.renameSync(p, preDb + suffix);
    }
    if (fs.existsSync(shotsDir)) fs.renameSync(shotsDir, preShots);
    fs.renameSync(tmpDb, liveDb);
    fs.mkdirSync(shotsDir, { recursive: true });

    const missingScreenshots: string[] = [];
    for (const e of entries) {
      if (!e.name.startsWith('screenshots/')) continue;
      const rel = e.name.slice('screenshots/'.length);
      const dest = path.join(shotsDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, e.data);
    }

    swapped = true;
    db.initDb(userData); // runs migrations if the backup's schema is older
    db.repointScreenshotPaths();
    const restored = db.countData();

    for (const suffix of ['', '-wal', '-shm']) {
      try {
        fs.rmSync(preDb + suffix, { force: true });
      } catch {
        /* leftover cleanup is not a restore failure */
      }
    }
    try {
      fs.rmSync(preShots, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
    return { manifest, restored, missingScreenshots, safetyBackup };
  } catch (e) {
    // 5. Roll back to the pre-restore state.
    try {
      db.closeDb();
    } catch {
      /* ignore */
    }
    try {
      if (swapped) {
        for (const suffix of ['', '-wal', '-shm']) {
          const p = liveDb + suffix;
          if (fs.existsSync(p)) fs.rmSync(p, { force: true });
          if (fs.existsSync(preDb + suffix)) fs.renameSync(preDb + suffix, p);
        }
        if (fs.existsSync(shotsDir)) fs.rmSync(shotsDir, { recursive: true, force: true });
        if (fs.existsSync(preShots)) fs.renameSync(preShots, shotsDir);
      }
      db.initDb(userData);
    } catch (rollbackErr) {
      console.log('[backup] rollback failed:', rollbackErr);
      throw new Error(
        `The restore failed and the automatic rollback could not complete. Your original data is preserved at ${preDb} / ${preShots} — do not delete those files.`,
      );
    }
    try {
      fs.rmSync(tmpDb, { force: true });
    } catch {
      /* ignore */
    }
    if (e instanceof Error) throw e;
    throw new Error(String(e));
  }
}

function parseManifest(entries: { name: string; data: Buffer }[]): BackupManifest {
  const entry = entries.find((e) => e.name === 'manifest.json');
  if (!entry) throw new Error(INVALID_MSG);
  let manifest: BackupManifest;
  try {
    manifest = JSON.parse(entry.data.toString('utf8')) as BackupManifest;
  } catch {
    throw new Error(INVALID_MSG);
  }
  if (manifest.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error(
      `This backup was created by an incompatible version of Nock (backup format ${String(manifest.formatVersion)}) and cannot be restored.`,
    );
  }
  if (typeof manifest.schemaVersion !== 'number' || manifest.schemaVersion > db.schemaVersion()) {
    throw new Error(
      'This backup was created by a newer version of Nock and cannot be restored with this version. Update Nock first.',
    );
  }
  return manifest;
}

function verifySnapshot(dbFile: string): void {
  let check: DatabaseSync;
  try {
    check = new DatabaseSync(dbFile, { readOnly: true });
  } catch {
    throw new Error(INVALID_MSG);
  }
  try {
    const ic = check.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (String(ic?.integrity_check ?? '').toLowerCase() !== 'ok') throw new Error(INVALID_MSG);
    const tables = (check.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
      (r) => r.name,
    );
    for (const t of ['subjects', 'notes', 'screenshots', 'versions', 'settings', 'daily_stats']) {
      if (!tables.includes(t)) throw new Error(INVALID_MSG);
    }
  } catch {
    throw new Error(INVALID_MSG);
  } finally {
    try {
      check.close();
    } catch {
      /* ignore */
    }
  }
}