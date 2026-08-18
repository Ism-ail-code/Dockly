/**
 * Minimal store-only ZIP writer/reader used for .nockbackup files.
 *
 * Entries are stored uncompressed (method 0), which keeps the format simple
 * and fast — note documents compress well but PNG screenshots are already
 * compressed, so compression would add CPU cost for little gain. The format
 * is a standard ZIP: any tool (Windows Explorer, PowerShell Expand-Archive,
 * 7-Zip, …) can open a .nockbackup and read its contents.
 *
 * The reader is defensive: it verifies every entry's CRC-32, bounds-checks
 * all offsets and rejects unsafe entry names (path traversal / absolute
 * paths) before anything is extracted.
 */

const LOCAL_SIG = 0x04034b50;
const CENTRAL_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;

const CRC_TABLE = ((): Uint32Array => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Buffer;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function writeZip(entries: ZipEntry[], mtime = new Date()): Buffer {
  const { time, date } = dosDateTime(mtime);
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_SIG, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(e.data.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    chunks.push(local, nameBuf, e.data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(CENTRAL_SIG, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8);
    cen.writeUInt16LE(0, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(e.data.length, 20);
    cen.writeUInt32LE(e.data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt16LE(0, 30); // extra length
    cen.writeUInt16LE(0, 32); // comment length
    cen.writeUInt16LE(0, 34); // disk start
    cen.writeUInt16LE(0, 36); // internal attrs
    cen.writeUInt32LE(0, 38); // external attrs
    cen.writeUInt32LE(offset, 42); // local header offset
    central.push(cen, nameBuf);

    offset += 30 + nameBuf.length + e.data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, ...central, eocd]);
}

export interface ZipReadEntry {
  name: string;
  data: Buffer;
}

export function readZip(buf: Buffer): ZipReadEntry[] {
  if (buf.length < 22) throw new Error('invalid zip: file too small');
  let eocdPos = -1;
  const minPos = Math.max(0, buf.length - 65557);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error('invalid zip: end-of-central-directory not found');
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  if (cdOffset + cdSize > eocdPos) throw new Error('invalid zip: central directory out of bounds');
  if (totalEntries > 1_000_000) throw new Error('invalid zip: too many entries');

  const out: ZipReadEntry[] = [];
  let pos = cdOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (pos + 46 > eocdPos || buf.readUInt32LE(pos) !== CENTRAL_SIG) {
      throw new Error('invalid zip: malformed central directory entry');
    }
    const method = buf.readUInt16LE(pos + 10);
    const crc = buf.readUInt32LE(pos + 16);
    const size = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    if (method !== 0) throw new Error(`invalid zip: unsupported compression method ${method}`);
    const name = buf.toString('utf8', pos + 46, pos + 46 + nameLen);
    if (!isSafeEntryName(name)) throw new Error(`invalid zip: unsafe entry name "${name}"`);
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== LOCAL_SIG) {
      throw new Error('invalid zip: malformed local header');
    }
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + size > buf.length) throw new Error('invalid zip: entry data out of bounds');
    const data = Buffer.from(buf.subarray(dataStart, dataStart + size));
    if (crc32(data) !== crc) throw new Error(`invalid zip: checksum mismatch for "${name}"`);
    out.push({ name, data });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

function isSafeEntryName(name: string): boolean {
  if (!name || name.length > 4096) return false;
  if (name.startsWith('/') || name.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  if (name.includes('\\')) return false;
  const segments = name.split('/');
  for (const seg of segments) {
    if (seg === '..' || seg.includes('..')) return false;
  }
  return true;
}