// Read the time a QuickTime / MP4 recording was shot — its container creation time — without loading the
// whole file. Only the top-level atoms are scanned (via Blob.slice) to find `moov`, then just that atom is
// read and handed to the shared BMFF reader. DJI and many action cameras write `moov` at the very end of the
// file, after a multi-gigabyte `mdat`, so a naive "read the first N bytes" never finds it; walking the atom
// chain does, at the cost of a few small range reads.

import { readBmff } from "@/lib/tools/files/metadata";

/** A `moov` atom this large or larger is read only up to here; its `mvhd` (the creation time) sits near its front. */
const MAX_MOOV = 64 * 1024 * 1024;

const ascii4 = (dv: DataView, o: number) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));

/** The bytes of the file's `moov` atom (header included), capped at {@link MAX_MOOV}; null when there is none. */
async function readMoovBytes(file: Blob): Promise<Uint8Array | null> {
  const size = file.size;
  let o = 0;
  // A long recording can have thousands of top-level atoms only in pathological files; cameras have a handful.
  for (let guard = 0; o + 8 <= size && guard < 4096; guard++) {
    const head = new DataView(await file.slice(o, Math.min(o + 16, size)).arrayBuffer());
    if (head.byteLength < 8) break;
    let boxSize = head.getUint32(0);
    const type = ascii4(head, 4);
    let headLen = 8;
    if (boxSize === 1) {
      if (head.byteLength < 16) break;
      boxSize = head.getUint32(8) * 2 ** 32 + head.getUint32(12); // 64-bit size (large mdat)
      headLen = 16;
    } else if (boxSize === 0) {
      boxSize = size - o; // runs to the end of the file
    }
    if (boxSize < headLen || o + boxSize > size) break;
    if (type === "moov") {
      const take = Math.min(boxSize, MAX_MOOV);
      const buf = new Uint8Array(await file.slice(o, o + take).arrayBuffer());
      // If we capped the read, rewrite the atom's own size so the BMFF walker stays within the bytes we have.
      if (take < boxSize) {
        const dv = new DataView(buf.buffer);
        if (headLen === 16) {
          dv.setUint32(8, Math.floor(take / 2 ** 32));
          dv.setUint32(12, take >>> 0);
        } else {
          dv.setUint32(0, take);
        }
      }
      return buf;
    }
    o += boxSize;
  }
  return null;
}

/**
 * The time a recording was shot, in milliseconds since the Unix epoch (UTC), from its container creation time;
 * null when the file carries none (or is not an MP4/MOV). Reads only the `moov` atom, so it is cheap even on
 * 8K originals.
 */
export async function readRecordedAt(file: Blob): Promise<number | null> {
  const moov = await readMoovBytes(file);
  if (!moov) return null;
  const meta = readBmff(moov);
  // Prefer the movie header's creation time; fall back to the QuickTime creationdate tag that DJI, GoPro and
  // iPhones write (surfaced as "Created"), then a bare year. Many cameras leave mvhd at 0 but set the tag.
  const candidates = [meta.created, meta.tags["Created"], meta.tags["Year"]];
  for (const s of candidates) {
    if (!s) continue;
    const ms = Date.parse(s);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}
