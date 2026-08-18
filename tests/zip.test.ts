import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { writeZip, readZip, crc32 } from '../src/main/zip';

describe('zip (store-only)', () => {
  it('round-trips ascii entries with binary data', () => {
    const data = Buffer.from([0, 1, 2, 3, 255, 254, 10, 13, 0, 65, 66, 67]);
    const zip = writeZip([
      { name: 'a.txt', data: Buffer.from('hello') },
      { name: 'bin/nock.db', data },
    ]);
    const out = readZip(zip);
    assert.equal(out.length, 2);
    assert.equal(out[0].name, 'a.txt');
    assert.equal(out[0].data.toString(), 'hello');
    assert.equal(out[1].name, 'bin/nock.db');
    assert.deepEqual([...out[1].data], [...data]);
  });

  it('round-trips unicode entry names', () => {
    const zip = writeZip([{ name: 'screenshots/نوٹ/۱.png', data: Buffer.from('x') }]);
    const out = readZip(zip);
    assert.equal(out[0].name, 'screenshots/نوٹ/۱.png');
    assert.equal(out[0].data.toString(), 'x');
  });

  it('round-trips an empty archive', () => {
    const out = readZip(writeZip([]));
    assert.deepEqual(out, []);
  });

  it('rejects truncated archives', () => {
    const zip = writeZip([{ name: 'a', data: Buffer.from('x'.repeat(100)) }]);
    assert.throws(() => readZip(zip.subarray(0, zip.length - 30)), /invalid zip/);
  });

  it('rejects archives with garbage bytes', () => {
    assert.throws(() => readZip(Buffer.from('this is not a zip file at all, definitely not')), /invalid zip/);
    assert.throws(() => readZip(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])), /invalid zip/);
  });

  it('detects data corruption via crc-32', () => {
    const zip = writeZip([{ name: 'a', data: Buffer.from('original content') }]);
    const idx = zip.indexOf(Buffer.from('original content'));
    assert.ok(idx > 0);
    zip[idx] = 0x21; // flip one byte inside the entry data
    assert.throws(() => readZip(zip), /checksum mismatch/);
  });

  it('rejects path-traversal and absolute entry names', () => {
    for (const bad of ['../evil.txt', 'a/../../evil.txt', '/etc/passwd', 'C:/Windows/x', 'sub\\..\\evil.txt']) {
      const zip = writeZip([{ name: bad, data: Buffer.from('x') }]);
      assert.throws(() => readZip(zip), /unsafe entry name/);
    }
  });

  it('rejects unsupported compression methods', () => {
    const zip = writeZip([{ name: 'a', data: Buffer.from('hello') }]);
    // Patch the method field of the FIRST central-directory entry (central dir
    // starts at 30 local bytes + 1 name byte + 5 data bytes = 36; the method
    // field sits at offset +10) to "deflate".
    zip.writeUInt16LE(8, 46);
    assert.throws(() => readZip(zip), /unsupported compression method/);
  });

  it('computes the standard crc-32 value', () => {
    assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926);
    assert.equal(crc32(Buffer.from('')), 0);
  });
});