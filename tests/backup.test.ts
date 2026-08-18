import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDb, closeDb, countData, dbScreenshotsDir, createSubject, createNote, saveScreenshot, setSetting, pushVersion } from '../src/main/db';
import { exportBackup, inspectBackup, restoreBackup, BACKUP_FORMAT_VERSION } from '../src/main/backup';
import { readZip } from '../src/main/zip';

function tempDir(label: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `nock-bk-${label}-`));
}

function wipeUserData(dir: string): void {
  closeDb();
  const dbFile = path.join(dir, 'nock.db');
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(dbFile + suffix, { force: true });
  }
  fs.rmSync(path.join(dir, 'screenshots'), { recursive: true, force: true });
}

function seedWorkspace(): { subjectId: string; noteId: string; shotPath: string } {
  const subject = createSubject({ name: 'Physics', icon: 'atom', color: 'sky', sortOrder: 0 });
  const note = createNote(subject.id, 'Circular motion');
  const shot = saveScreenshot(note.id, Buffer.from([137, 80, 78, 71, 1, 2, 3]));
  setSetting('theme', 'midnight');
  setSetting('accent', 'emerald');
  pushVersion(note.id, '{"type":"doc","content":[{"type":"paragraph"}]}', Date.now() - 1000);
  return { subjectId: subject.id, noteId: note.id, shotPath: shot.path };
}

describe('nock backup export/restore', () => {
  it('exports a workspace with the expected archive structure', async () => {
    const dir = tempDir('export');
    initDb(dir);
    seedWorkspace();
    const dest = path.join(dir, 'Nock-Backup-2026-08-17.nockbackup');
    const res = await exportBackup(dest, '1.2.0');
    assert.equal(res.counts.notes, 1);
    assert.equal(res.counts.subjects, 1);
    assert.equal(res.counts.screenshots, 1);
    assert.equal(res.counts.versions, 1);

    const entries = readZip(fs.readFileSync(dest));
    const names = entries.map((e) => e.name).sort();
    assert.ok(names.includes('manifest.json'));
    assert.ok(names.includes('nock.db'));
    assert.ok(names.some((n) => n.startsWith('screenshots/') && n.endsWith('.png')));

    const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json')!.data.toString('utf8'));
    assert.equal(manifest.formatVersion, BACKUP_FORMAT_VERSION);
    assert.equal(manifest.appVersion, '1.2.0');
    assert.equal(manifest.schemaVersion, 2);
    assert.equal(manifest.counts.notes, 1);
    assert.equal(manifest.counts.subjects, 1);
    assert.equal(manifest.counts.screenshots, 1);
    assert.ok(manifest.createdAt);
    closeDb();
  });

  it('restores a full workspace (notes, screenshots, settings, versions)', async () => {
    const dir = tempDir('restore');
    initDb(dir);
    const { noteId, shotPath } = seedWorkspace();
    const backupPath = path.join(dir, 'backup.nockbackup');
    await exportBackup(backupPath, '1.2.0');
    closeDb();

    // Simulate a fresh start on another machine: wipe everything, boot empty.
    wipeUserData(dir);
    initDb(dir);
    assert.equal(countData().notes, 0);
    assert.equal(countData().screenshots, 0);

    const res = await restoreBackup(backupPath, '1.2.0');
    assert.equal(res.restored.notes, 1);
    assert.equal(res.restored.subjects, 1);
    assert.equal(res.restored.screenshots, 1);
    assert.equal(res.restored.versions, 1);
    assert.equal(res.restored.settings, 2);
    assert.ok(fs.existsSync(path.join(dbScreenshotsDir(), noteId, path.basename(shotPath))));
    // Safety backup of the pre-restore state must exist.
    assert.ok(fs.existsSync(res.safetyBackup));
    assert.ok(res.safetyBackup.includes('pre-restore'));
    // Re-pointed screenshot path must exist on disk.
    const screenshots = readZip(fs.readFileSync(backupPath)).filter((e) => e.name.startsWith('screenshots/'));
    assert.equal(screenshots.length, 1);
    closeDb();
  });

  it('rejects a backup with an incompatible (future) format version and leaves data untouched', async () => {
    const dir = tempDir('future');
    initDb(dir);
    seedWorkspace();
    const backupPath = path.join(dir, 'future.nockbackup');
    await exportBackup(backupPath, '1.2.0');

    // Rewrite the manifest with a future format version.
    const entries = readZip(fs.readFileSync(backupPath));
    const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json')!.data.toString('utf8'));
    manifest.formatVersion = 99;
    entries.find((e) => e.name === 'manifest.json')!.data = Buffer.from(JSON.stringify(manifest));
    const { writeZip } = await import('../src/main/zip');
    fs.writeFileSync(backupPath, writeZip(entries));

    assert.throws(() => inspectBackup(backupPath), /incompatible version of Nock/);
    await assert.rejects(restoreBackup(backupPath, '1.2.0'), /incompatible version of Nock/);
    assert.equal(countData().notes, 1);
    closeDb();
  });

  it('rejects a backup from a newer schema version', async () => {
    const dir = tempDir('schema');
    initDb(dir);
    seedWorkspace();
    const backupPath = path.join(dir, 'schema.nockbackup');
    await exportBackup(backupPath, '1.2.0');
    const entries = readZip(fs.readFileSync(backupPath));
    const manifest = JSON.parse(entries.find((e) => e.name === 'manifest.json')!.data.toString('utf8'));
    manifest.schemaVersion = 99;
    entries.find((e) => e.name === 'manifest.json')!.data = Buffer.from(JSON.stringify(manifest));
    const { writeZip } = await import('../src/main/zip');
    fs.writeFileSync(backupPath, writeZip(entries));
    assert.throws(() => inspectBackup(backupPath), /newer version of Nock/);
    closeDb();
  });

  it('rejects a backup missing the manifest or the database', async () => {
    const dir = tempDir('missing');
    initDb(dir);
    const { writeZip } = await import('../src/main/zip');
    const noManifest = path.join(dir, 'no-manifest.nockbackup');
    fs.writeFileSync(noManifest, writeZip([{ name: 'nock.db', data: Buffer.from('x') }]));
    assert.throws(() => inspectBackup(noManifest), /cannot be restored/);

    const noDb = path.join(dir, 'no-db.nockbackup');
    fs.writeFileSync(noDb, writeZip([{ name: 'manifest.json', data: Buffer.from('{"formatVersion":1}') }]));
    assert.throws(() => inspectBackup(noDb), /cannot be restored/);
    closeDb();
  });

  it('rejects a corrupted database inside the backup and preserves current data', async () => {
    const dir = tempDir('corrupt');
    initDb(dir);
    seedWorkspace();
    const corruptPath = path.join(dir, 'corrupt.nockbackup');
    const { writeZip } = await import('../src/main/zip');
    fs.writeFileSync(
      corruptPath,
      writeZip([
        {
          name: 'manifest.json',
          data: Buffer.from(
            JSON.stringify({ formatVersion: 1, appVersion: '1.2.0', schemaVersion: 2, createdAt: new Date().toISOString(), counts: { subjects: 1, notes: 1, screenshots: 1, versions: 0, settings: 0, dailyStats: 0 } }),
          ),
        },
        { name: 'nock.db', data: Buffer.from('this is definitely not a sqlite database') },
      ]),
    );
    assert.throws(() => inspectBackup(corruptPath), /cannot be restored/);
    await assert.rejects(restoreBackup(corruptPath, '1.2.0'), /cannot be restored/);
    assert.equal(countData().notes, 1);
    assert.equal(countData().subjects, 1);
    closeDb();
  });

  it('rejects a garbage file that is not a zip at all', async () => {
    const dir = tempDir('garbage');
    initDb(dir);
    const garbagePath = path.join(dir, 'garbage.nockbackup');
    fs.writeFileSync(garbagePath, Buffer.from('random bytes, not a backup'));
    assert.throws(() => inspectBackup(garbagePath), /cannot be restored/);
    await assert.rejects(restoreBackup(garbagePath, '1.2.0'));
    closeDb();
  });
});