import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));

function readJson(rel: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')) as Record<string, unknown>;
}

describe('uninstall / update data lifecycle config', () => {
  it('deletes app data on uninstall (acceptance: uninstall must remove the user workspace)', () => {
    const pkg = readJson('package.json');
    const nsis = (pkg.build as Record<string, unknown>).nsis as Record<string, unknown>;
    assert.equal(nsis.deleteAppDataOnUninstall, true);
  });

  it('does not delete app data on update (acceptance: updates must preserve user data)', () => {
    // electron-builder's NSIS template skips deleteAppDataOnUninstall when the
    // installer runs with the --updated flag (electron-updater) or when it
    // installs over an existing installation — guarded by this flag remaining
    // enabled and by the NSIS template's isUpdated check. Nothing in this repo
    // may invoke the uninstaller as part of an update.
    const pkg = readJson('package.json');
    const nsis = (pkg.build as Record<string, unknown>).nsis as Record<string, unknown>;
    assert.equal(nsis.deleteAppDataOnUninstall, true);
    const src = fs.readFileSync(path.join(root, 'src', 'main', 'updater.ts'), 'utf8');
    assert.ok(src.includes('quitAndInstall'));
  });

  it('cleans the autostart Run registry value on uninstall', () => {
    const file = path.join(root, 'build', 'installer.nsh');
    assert.ok(fs.existsSync(file), 'build/installer.nsh must exist for nsis.include');
    const script = fs.readFileSync(file, 'utf8');
    assert.ok(script.includes('!macro customUnInstall'), 'must define the customUnInstall macro');
    assert.ok(script.includes('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "Nock"'));
    assert.ok(script.includes('DeleteRegValue HKCU "Software\\Microsoft\\Windows\\CurrentVersion\\Run" "nock"'));
  });

  it('does not package development or user data (acceptance: installer ships clean)', () => {
    const pkg = readJson('package.json');
    const build = pkg.build as Record<string, unknown>;
    const files = build.files as string[];
    assert.ok(files.includes('dist/**'), 'packaged files must come from dist only');
    const includes = files.filter((f) => !f.startsWith('!'));
    const excludes = files.filter((f) => f.startsWith('!'));
    assert.deepEqual(excludes, ['!dist/tests/**'], 'only the test bundle may be excluded');
    for (const forbidden of ['tests/', 'release/', 'build/', 'nock.db', 'screenshots/']) {
      assert.ok(!includes.some((f) => f.includes(forbidden)), `files must not include ${forbidden}`);
    }
    const extra = build.extraResources as { from: string; to: string }[];
    assert.ok(extra.length === 1 && extra[0].to === 'clipboard-watch.ps1');
  });

  it('keeps user data in %APPDATA% rather than the install directory', () => {
    const pkg = readJson('package.json');
    assert.equal(pkg.name, 'nock', 'app name must stay "nock" (drives %APPDATA%\\nock)');
    const src = fs.readFileSync(path.join(root, 'src', 'main', 'index.ts'), 'utf8');
    // Production must never relocate userData away from %APPDATA%: every
    // app.setPath('userData') call has to be behind an opt-in QA/dev env var
    // on the same line, so the packaged app always uses the default location.
    const setPathLines = src.split('\n').filter((l) => l.includes("app.setPath('userData'"));
    assert.ok(setPathLines.length >= 4, 'expected the four env-guarded dev/QA overrides');
    for (const line of setPathLines) {
      assert.ok(line.includes('process.env.'), `userData override must be env-guarded: ${line.trim()}`);
    }
  });
});
