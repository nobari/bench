/**
 * Minimal ustar (POSIX tar) writer plus native-gzip wrapping for .tar.gz.
 * Lives in-house for the same reason as zip-write.ts: the vendored libarchive
 * build cannot write archives reliably.
 */

export interface TarEntryInput {
  /** Path inside the tarball, "/"-separated. */
  name: string;
  data: Uint8Array;
  /** Unix ms timestamp. */
  mtime?: number;
}

const BLOCK = 512;
const encoder = new TextEncoder();

function writeString(block: Uint8Array, at: number, value: string): void {
  block.set(encoder.encode(value), at);
}

function writeOctal(block: Uint8Array, at: number, len: number, value: number): void {
  writeString(block, at, value.toString(8).padStart(len - 1, "0"));
}

/** Split a long path into ustar name (≤100) + prefix (≤155) fields. */
function splitName(path: string): { name: string; prefix: string } {
  if (encoder.encode(path).length <= 100) return { name: path, prefix: "" };
  const cut = path.slice(0, 156).lastIndexOf("/");
  if (cut <= 0) throw new Error(`File name too long for TAR: ${path}`);
  const prefix = path.slice(0, cut);
  const name = path.slice(cut + 1);
  if (encoder.encode(prefix).length > 155 || encoder.encode(name).length > 100)
    throw new Error(`File name too long for TAR: ${path}`);
  return { name, prefix };
}

export function buildTar(entries: TarEntryInput[]): Uint8Array {
  const blocks: Uint8Array[] = [];
  for (const entry of entries) {
    const path = entry.name.replace(/\\/g, "/").replace(/^\/+/, "");
    const { name, prefix } = splitName(path);
    const header = new Uint8Array(BLOCK);
    writeString(header, 0, name);
    writeOctal(header, 100, 8, 0o644); // mode
    writeOctal(header, 108, 8, 0); // uid
    writeOctal(header, 116, 8, 0); // gid
    writeOctal(header, 124, 12, entry.data.length);
    writeOctal(header, 136, 12, Math.floor((entry.mtime ?? 0) / 1000));
    header.fill(0x20, 148, 156); // checksum field = spaces while summing
    header[156] = 0x30; // typeflag "0" (regular file)
    writeString(header, 257, "ustar");
    header[263] = 0x30; // version "00"
    header[264] = 0x30;
    writeString(header, 345, prefix);
    const sum = header.reduce((s, b) => s + b, 0);
    writeString(header, 148, sum.toString(8).padStart(6, "0") + "\0 ");

    blocks.push(header, entry.data);
    const overflow = entry.data.length % BLOCK;
    if (overflow) blocks.push(new Uint8Array(BLOCK - overflow));
  }
  blocks.push(new Uint8Array(BLOCK * 2)); // end-of-archive marker

  const out = new Uint8Array(blocks.reduce((s, b) => s + b.length, 0));
  let pos = 0;
  for (const block of blocks) {
    out.set(block, pos);
    pos += block.length;
  }
  return out;
}

export async function buildTarGz(entries: TarEntryInput[]): Promise<Uint8Array> {
  const tar = buildTar(entries);
  const stream = new Blob([tar as BlobPart]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
