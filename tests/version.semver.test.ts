import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, isNewerVersion, parseVersion, stripVersionPrefix } from '../src/shared/version';

describe('parseVersion', () => {
  it('parses plain and v-prefixed versions', () => {
    assert.deepEqual(parseVersion('1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseVersion('v1.2.3'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseVersion('V1.0.0'), { major: 1, minor: 0, patch: 0 });
  });

  it('rejects garbage and partial versions', () => {
    assert.equal(parseVersion(''), null);
    assert.equal(parseVersion('1.2'), null);
    assert.equal(parseVersion('abc'), null);
    assert.equal(parseVersion('1.2.3.4'), null);
  });

  it('ignores pre-release / build suffixes like electron-updater does', () => {
    assert.deepEqual(parseVersion('1.2.3-beta.1'), { major: 1, minor: 2, patch: 3 });
    assert.deepEqual(parseVersion('1.2.3+build.42'), { major: 1, minor: 2, patch: 3 });
  });
});

describe('compareVersions', () => {
  it('orders simple versions', () => {
    assert.equal(compareVersions('1.1.0', '1.0.0'), 1);
    assert.equal(compareVersions('1.0.0', '1.1.0'), -1);
    assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  });

  it('compares major, then minor, then patch', () => {
    assert.equal(compareVersions('2.0.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
    assert.equal(compareVersions('1.0.10', '1.0.9'), 1);
    assert.equal(compareVersions('1.0.9', '1.0.10'), -1);
  });

  it('treats unparsable input as lower than any valid version', () => {
    assert.equal(compareVersions('garbage', '0.0.1'), -1);
    assert.equal(compareVersions('1.0.0', 'garbage'), 1);
    assert.equal(compareVersions('garbage', 'garbage'), 0);
  });
});

describe('isNewerVersion', () => {
  it('returns true only for a genuinely newer release', () => {
    assert.equal(isNewerVersion('1.1.0', '1.0.0'), true);
    assert.equal(isNewerVersion('1.0.0', '1.1.0'), false); // downgrade → no update
    assert.equal(isNewerVersion('1.0.0', '1.0.0'), false); // same → no update
    assert.equal(isNewerVersion('v1.1.0', '1.0.0'), true);
  });

  it('never treats an invalid latest version as an update', () => {
    assert.equal(isNewerVersion('', '1.0.0'), false);
    assert.equal(isNewerVersion('not-a-version', '1.0.0'), false);
  });
});

describe('stripVersionPrefix', () => {
  it('normalizes GitHub tag names to bare versions', () => {
    assert.equal(stripVersionPrefix('v1.2.0'), '1.2.0');
    assert.equal(stripVersionPrefix('1.2.0'), '1.2.0');
  });
});