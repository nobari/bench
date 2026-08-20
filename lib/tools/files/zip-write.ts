/**
 * Minimal, correct ZIP writer. Entries are deflated with the browser-native
 * CompressionStream("deflate-raw") and stored uncompressed when deflate
 * doesn't help. UTF-8 names (flag bit 11), no ZIP64 — guarded at 4 GB / 65535
 * entries, far beyond what a browser tab should hold in memory anyway.
 *
 * Written in-house because the vendored libarchive build cannot produce a
 * plain ZIP: its `compression` maps to an *outer* libarchive filter (yielding
 * a gzip-wrapped zip) and its fixed output buffer overflows on incompressible
 * input ("Buffer exhausted").
 */

export interface ZipEntryInput {
  /** Path inside the zip, "/"-separated. */
  name: string;
  data: Uint8Array;
  /** Unix ms timestamp; defaults to a fixed 1980 epoch when absent. */
  mtime?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** MS-DOS date/time pair, clamped to the format's 1980 floor. */
function dosDateTime(ms: number | undefined): { date: number; time: number } {
  const d = ms ? new Date(ms) : new Date(Date.UTC(1980, 0, 1));
  const year = Math.max(d.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
  };
}

const MAX_U32 = 0xffffffff;

export async function buildZip(entries: ZipEntryInput[]): Promise<Uint8Array> {
  if (entries.length > 0xffff) throw new Error("Too many files for a ZIP (max 65535).");
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name.replace(/\\/g, "/").replace(/^\/+/, ""));
    const crc = crc32(entry.data);
    const deflated = await deflateRaw(entry.data);
    const stored = deflated.length >= entry.data.length;
    const payload = stored ? entry.data : deflated;
    const method = stored ? 0 : 8;
    const { date, time } = dosDateTime(entry.mtime);
    if (offset > MAX_U32 || payload.length > MAX_U32 || entry.data.length > MAX_U32)
      throw new Error("Archive exceeds the 4 GB ZIP limit.");

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, method, true);
    local.setUint16(10, time, true);
    local.setUint16(12, date, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, payload.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);

    const cdir = new DataView(new ArrayBuffer(46));
    cdir.setUint32(0, 0x02014b50, true);
    cdir.setUint16(4, 20, true); // version made by
    cdir.setUint16(6, 20, true); // version needed
    cdir.setUint16(8, 0x0800, true);
    cdir.setUint16(10, method, true);
    cdir.setUint16(12, time, true);
    cdir.setUint16(14, date, true);
    cdir.setUint32(16, crc, true);
    cdir.setUint32(20, payload.length, true);
    cdir.setUint32(24, entry.data.length, true);
    cdir.setUint16(28, name.length, true);
    cdir.setUint32(42, offset, true); // local header offset (30-41 stay 0)

    chunks.push(new Uint8Array(local.buffer), name, payload);
    central.push(new Uint8Array(cdir.buffer), name);
    offset += 30 + name.length + payload.length;
  }

  const centralSize = central.reduce((s, c) => s + c.length, 0);
  if (offset + centralSize > MAX_U32) throw new Error("Archive exceeds the 4 GB ZIP limit.");
  const eocd = new DataView(new ArrayBuffer(22));
  eocd.setUint32(0, 0x06054b50, true);
  eocd.setUint16(8, entries.length, true);
  eocd.setUint16(10, entries.length, true);
  eocd.setUint32(12, centralSize, true);
  eocd.setUint32(16, offset, true);

  const total = offset + centralSize + 22;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(eocd.buffer)]) {
    out.set(chunk, pos);
    pos += chunk.length;
  }
  return out;
}
