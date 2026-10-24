/**
 * MP4 index check and in-place repair, without touching the picture or the sound.
 *
 * An MP4 is a few boxes: ftyp, the mdat with every sample's bytes, and the moov — the index — that says
 * where each sample is and when it plays. Players and YouTube's processing read the index first, so a
 * defect there (two frames on one timestamp, an edit list that delays the picture, sample sizes that do
 * not add up) sinks a file whose picture is perfect. This module reads only the headers and the moov
 * (a few megabytes, wherever the file is 200 GB), reports what it finds in plain words, and can rewrite
 * the index at the tail of the file so the two defects the Video Editor used to write are gone.
 *
 * Pure and framework-free: the file comes in as a Blob (a File from the File System Access API or OPFS),
 * the repair goes out as the new moov bytes plus where to put them.
 */

export interface EditEntry {
  segDur: number;
  mediaTime: number;
}

/** What the sample description says about the codec, for the doctor's rules. Fields only when the entry carries them. */
export interface SampleEntryInfo {
  /** Picture size as the sample entry declares it. */
  width?: number;
  height?: number;
  /** HEVC: general profile idc (1 Main, 2 Main 10), tier, level idc (×30: 153 = 5.1, 180 = 6.0), chroma format (1 = 4:2:0), luma bit depth. */
  hevc?: { profile: number; tier: "main" | "high"; level: number; chroma: number; bitDepth: number };
  /** H.264: profile idc (66 Baseline, 77 Main, 100 High) and level idc (×10: 51 = 5.1). */
  avc?: { profile: number; level: number };
  /** AAC from the esds: audio object type (2 = LC, 5 = HE, 29 = HE v2), the rate and channel configuration it declares. */
  aac?: { objectType: number; sampleRate: number; channels: number };
  /** Any audio entry: channels and rate from the sample entry itself. */
  audio?: { channels: number; sampleRate: number };
  /** The colr box (nclx): colour primaries, transfer characteristics, matrix (ITU-T H.273 codes) and the range flag. */
  colr?: { primaries: number; transfer: number; matrix: number; fullRange: boolean };
}

export interface TrackCheck {
  kind: "video" | "audio" | "other";
  timescale: number;
  /** Media duration in seconds (from mdhd). */
  durationS: number;
  samples: number;
  /** Keyframes in stss, or null when there is no stss (every sample is a sync sample). */
  keyframes: number | null;
  /** Samples with a zero stts delta: a frame on the same tick as the one after it. */
  zeroLength: number;
  /** Timeline positions (seconds) of those, up to 12. */
  zeroLengthAt: number[];
  /** Video only: frames shorter than a fifth of the nominal frame, excluding the zero-length ones. */
  shortFrames: number;
  /** Video only: samples whose stts delta is not the dominant one (the frames at cuts). */
  irregular: number;
  /** The most common stts delta (ticks) — the nominal frame length for video. */
  nominalDelta: number;
  /** Edit list entries, or null when there is no elst. */
  elst: EditEntry[] | null;
  /** Whether the track delays its start through an empty edit (mediaTime -1 first). */
  emptyEdit: boolean;
  hasCtts: boolean;
  /** Video with a version-1 ctts carrying negative offsets: frames placed before their predecessors. */
  negativeCtts: boolean;
  /** Sum of stsz, bytes. */
  bytes: number;
  /** The stsd entry's fourcc, e.g. "hvc1", "avc1", "mp4a". */
  codec: string;
  entry: SampleEntryInfo;
  /** Video only: timeline positions (seconds) of the irregular frames, up to 2,000 — where the cuts are. */
  irregularAt: number[];
  /** Video with an stss: the longest stretch between keyframes (or from the last one to the end), seconds; null without an stss. */
  maxKeyGapS: number | null;
}

export interface Mp4Check {
  size: number;
  /** Where the moov sits and how big it is; mdat size (payload incl. header). */
  moovAt: number;
  moovSize: number;
  mdatAt: number;
  mdatSize: number;
  layout: "moov-last" | "moov-first" | "other";
  /** mvhd duration in seconds. */
  durationS: number;
  tracks: TrackCheck[];
  /** Whether every track's stsz sum equals the mdat payload (sum over all tracks). */
  sizesMatch: boolean;
  /**
   * iTunes-style tags found in moov/udta/meta/ilst: title, artist, albumArtist, album, genre, date, comment,
   * encoder, kind ("music-video" for stik 6, "video" for 0/9, else the number as text). Keys only when present.
   */
  tags: Record<string, string>;
  /** Human-readable problems that make the file risky for players or YouTube (empty = ok). */
  problems: string[];
  /** Human-readable notes that are informational (keyframe interval, irregular-but-legal deltas, layout). */
  notes: string[];
  /** True when `problems` is empty. */
  ok: boolean;
}

export interface IndexRepair {
  /** The repaired moov box, complete, to be written at `moovAt` after truncating the file there. */
  moov: Uint8Array<ArrayBuffer>;
  moovAt: number;
  /** Old moov size, for the UI. */
  oldSize: number;
  changes: string[];
}

/* ------------------------------------------------------------------ bytes */

const latin1 = (b: Uint8Array, from: number, to: number) => {
  let s = "";
  for (let i = from; i < to; i++) s += String.fromCharCode(b[i]);
  return s;
};
const utf8 = new TextDecoder("utf-8");
const u16 = (b: Uint8Array, p: number) => (b[p] << 8) | b[p + 1];
const u32 = (b: Uint8Array, p: number) => ((b[p] << 24) >>> 0) + (b[p + 1] << 16) + (b[p + 2] << 8) + b[p + 3];
const i32 = (b: Uint8Array, p: number) => u32(b, p) | 0;
const u64 = (b: Uint8Array, p: number) => u32(b, p) * 0x1_0000_0000 + u32(b, p + 4);
const i64 = (b: Uint8Array, p: number) => i32(b, p) * 0x1_0000_0000 + u32(b, p + 4);
const putU32 = (b: Uint8Array, p: number, v: number) => {
  b[p] = (v >>> 24) & 0xff;
  b[p + 1] = (v >>> 16) & 0xff;
  b[p + 2] = (v >>> 8) & 0xff;
  b[p + 3] = v & 0xff;
};
const putU64 = (b: Uint8Array, p: number, v: number) => {
  putU32(b, p, Math.floor(v / 0x1_0000_0000));
  putU32(b, p + 4, v >>> 0);
};
const fmtInt = (n: number) => n.toLocaleString("en-US");
const fmtClock = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
};

/** A box inside the moov: payload bounds in the moov bytes; children for the containers the repair rebuilds. */
interface Box {
  type: string;
  /** Box start (its header) and end, and where the payload begins. */
  at: number;
  end: number;
  start: number;
  kids?: Box[];
  /** Replacement bytes for the whole box (header included), set by the repair. */
  replaced?: Uint8Array<ArrayBuffer>;
}

/** Boxes rebuilt from their children when the index is rewritten. Everything else is copied byte for byte. */
const REBUILT = new Set(["moov", "trak", "edts", "mdia", "minf", "stbl"]);
/** Containers walked while reading (tags live three levels under udta). */
const WALKED = new Set([...REBUILT, "udta", "meta", "ilst"]);
const TAG_ITEMS = new Set(["©nam", "©ART", "aART", "©alb", "©gen", "gnre", "©day", "©cmt", "©too", "stik"]);

function parseBoxes(b: Uint8Array, start: number, end: number, parent: string): Box[] {
  const out: Box[] = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p), header = 8;
    if (size === 1) {
      size = u64(b, p + 8);
      header = 16;
    } else if (size === 0) size = end - p;
    if (size < header || p + size > end) break;
    const type = latin1(b, p + 4, p + 8);
    const box: Box = { type, at: p, end: p + size, start: p + header };
    if (WALKED.has(type) || (parent === "ilst" && TAG_ITEMS.has(type))) {
      let kidsStart = box.start;
      // meta is a full box (version + flags) in MP4, a plain box in some QuickTime files: tell them apart by what follows.
      if (type === "meta" && kidsStart + 12 <= box.end && !/^[\w©]{4}$/.test(latin1(b, kidsStart + 4, kidsStart + 8)) && /^[\w©]{4}$/.test(latin1(b, kidsStart + 8, kidsStart + 12))) kidsStart += 4;
      box.kids = parseBoxes(b, kidsStart, box.end, type);
    }
    out.push(box);
    p += size;
  }
  return out;
}
const find = (kids: Box[] | undefined, type: string) => kids?.find((k) => k.type === type);
const findAll = (kids: Box[] | undefined, type: string) => kids?.filter((k) => k.type === type) ?? [];

/** Version-aware reads of the mvhd/mdhd/tkhd header fields. */
function fullBoxVersion(b: Uint8Array, box: Box) {
  return b[box.start];
}
function timescaleAndDuration(b: Uint8Array, box: Box): { timescale: number; duration: number } {
  const v = fullBoxVersion(b, box);
  return v === 1 ? { timescale: u32(b, box.start + 20), duration: u64(b, box.start + 24) } : { timescale: u32(b, box.start + 12), duration: u32(b, box.start + 16) };
}
function readElst(b: Uint8Array, elst: Box): EditEntry[] {
  const v = fullBoxVersion(b, elst), n = u32(b, elst.start + 4);
  const out: EditEntry[] = [];
  let p = elst.start + 8;
  for (let i = 0; i < n; i++) {
    if (v === 1) {
      out.push({ segDur: u64(b, p), mediaTime: i64(b, p + 8) });
      p += 20;
    } else {
      out.push({ segDur: u32(b, p), mediaTime: i32(b, p + 4) });
      p += 12;
    }
  }
  return out;
}
/** Every sample's stts delta, expanded. */
function readDeltas(b: Uint8Array, stts: Box): Uint32Array {
  const n = u32(b, stts.start + 4);
  let total = 0;
  for (let i = 0; i < n; i++) total += u32(b, stts.start + 8 + i * 8);
  const deltas = new Uint32Array(total);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const c = u32(b, stts.start + 8 + i * 8), d = u32(b, stts.start + 12 + i * 8);
    deltas.fill(d, k, k + c);
    k += c;
  }
  return deltas;
}
function readTags(b: Uint8Array, moov: Box[]): Record<string, string> {
  const tags: Record<string, string> = {};
  const ilst = find(find(find(moov, "udta")?.kids, "meta")?.kids, "ilst");
  for (const item of ilst?.kids ?? []) {
    const data = find(item.kids, "data");
    if (!data || data.start + 8 > data.end) continue;
    const type = (b[data.start + 1] << 16) | (b[data.start + 2] << 8) | b[data.start + 3];
    const from = data.start + 8, to = data.end;
    const text = type === 1 ? utf8.decode(b.subarray(from, to)) : null;
    let int: number | null = null;
    if (type === 0 || type === 21) {
      int = 0;
      for (let i = from; i < to && i < from + 8; i++) int = int * 256 + b[i];
    }
    const value = text ?? (int !== null ? String(int) : null);
    if (value === null) continue;
    switch (item.type) {
      case "©nam": tags.title = value; break;
      case "©ART": tags.artist = value; break;
      case "aART": tags.albumArtist = value; break;
      case "©alb": tags.album = value; break;
      case "©gen": tags.genre = value; break;
      case "gnre": tags.genre ??= value; break;
      case "©day": tags.date = value; break;
      case "©cmt": tags.comment = value; break;
      case "©too": tags.encoder = value; break;
      case "stik": tags.kind = int === 6 ? "music-video" : int === 0 || int === 9 ? "video" : value; break;
    }
  }
  return tags;
}

/* ------------------------------------------------------------------ file */

interface TopBox {
  type: string;
  offset: number;
  size: number;
  header: number;
}
interface Parsed {
  size: number;
  top: TopBox[];
  moov: TopBox | null;
  /** The whole moov box, header included. */
  bytes: Uint8Array<ArrayBuffer>;
  tree: Box[];
}

async function readRange(file: Blob, offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
}

/** The top-level boxes (headers only) and the moov in full. */
async function parseFile(file: Blob): Promise<Parsed> {
  const size = file.size;
  const top: TopBox[] = [];
  let p = 0;
  while (p + 8 <= size) {
    const h = await readRange(file, p, Math.min(16, size - p));
    let boxSize = u32(h, 0), header = 8;
    if (boxSize === 1 && h.length >= 16) {
      boxSize = u64(h, 8);
      header = 16;
    } else if (boxSize === 0) boxSize = size - p;
    if (boxSize < header) break;
    top.push({ type: latin1(h, 4, 8), offset: p, size: boxSize, header });
    p += boxSize;
  }
  const moov = top.find((b) => b.type === "moov") ?? null;
  const bytes = moov && moov.offset + moov.size <= size ? await readRange(file, moov.offset, moov.size) : new Uint8Array(0);
  const tree = bytes.length ? parseBoxes(bytes, moov!.header, bytes.length, "") : [];
  return { size, top, moov, bytes, tree };
}

interface TrackInfo {
  trak: Box;
  check: TrackCheck;
  deltas: Uint32Array;
  /** Movie-timescale duration from tkhd. */
  tkhdDuration: number;
  negativeCtts: boolean;
  /** File offset of the track's first chunk (stco/co64), 0 when unknown. */
  firstChunk: number;
}

const AAC_RATES = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
/** The AudioSpecificConfig inside an esds: object type, rate and channels as the stream declares them. */
function readAsc(b: Uint8Array, esds: Box): SampleEntryInfo["aac"] {
  let p = esds.start + 4;
  const end = esds.end;
  const varint = () => {
    let v = 0;
    for (let i = 0; i < 4 && p < end; i++) {
      const x = b[p++];
      v = (v << 7) | (x & 0x7f);
      if (!(x & 0x80)) break;
    }
    return v;
  };
  while (p < end) {
    const tag = b[p++], size = varint(), body = p;
    if (tag === 0x03) {
      // ES descriptor: id, flags, optional dependsOn / URL / OCR fields, then its children.
      p += 2;
      const flags = b[p++];
      if (flags & 0x80) p += 2;
      if (flags & 0x40) p += b[p] + 1;
      if (flags & 0x20) p += 2;
      continue;
    }
    if (tag === 0x04) {
      p += 13; // decoder config: object type, stream type, buffer size, max and average bitrate — then the specific info
      continue;
    }
    if (tag === 0x05 && size >= 2) {
      const a = b[p], c = b[p + 1];
      return { objectType: a >> 3, sampleRate: AAC_RATES[((a & 7) << 1) | (c >> 7)] ?? 0, channels: (c >> 3) & 0xf };
    }
    p = body + size;
  }
  return undefined;
}
/** Codec parameters from the first sample description entry. */
function readSampleEntry(b: Uint8Array, stsd: Box | undefined, kind: TrackCheck["kind"]): SampleEntryInfo {
  const info: SampleEntryInfo = {};
  if (!stsd || stsd.start + 16 > stsd.end) return info;
  const at = stsd.start + 8, size = u32(b, at), end = Math.min(stsd.end, at + Math.max(8, size)), start = at + 8;
  if (kind === "video" && start + 78 <= end) {
    info.width = u16(b, start + 24);
    info.height = u16(b, start + 26);
    for (const box of parseBoxes(b, start + 78, end, "stsd")) {
      const s = box.start, n = box.end - box.start;
      if (box.type === "hvcC" && n >= 23) info.hevc = { profile: b[s + 1] & 0x1f, tier: b[s + 1] & 0x20 ? "high" : "main", level: b[s + 12], chroma: b[s + 16] & 3, bitDepth: (b[s + 17] & 7) + 8 };
      else if (box.type === "avcC" && n >= 4) info.avc = { profile: b[s + 1], level: b[s + 3] };
      else if (box.type === "colr" && n >= 11 && latin1(b, s, s + 4) === "nclx") info.colr = { primaries: u16(b, s + 4), transfer: u16(b, s + 6), matrix: u16(b, s + 8), fullRange: !!(b[s + 10] & 0x80) };
    }
  } else if (kind === "audio" && start + 28 <= end) {
    const version = u16(b, start + 8);
    info.audio = { channels: u16(b, start + 16), sampleRate: u32(b, start + 24) >>> 16 };
    const kidsAt = start + (version === 1 ? 44 : version === 2 ? 64 : 28);
    if (kidsAt < end) for (const box of parseBoxes(b, kidsAt, end, "stsd")) if (box.type === "esds") info.aac = readAsc(b, box);
  }
  return info;
}
/** The longest stretch between keyframes, seconds: between consecutive stss entries and from the last one to the end. */
function readKeyGap(b: Uint8Array, stss: Box, deltas: Uint32Array, timescale: number): number {
  const n = u32(b, stss.start + 4);
  let worst = 0, prevT = 0, cursor = 0, t = 0;
  for (let i = 0; i < n; i++) {
    const sample = u32(b, stss.start + 8 + i * 4) - 1;
    while (cursor < sample && cursor < deltas.length) t += deltas[cursor++];
    if (i > 0) worst = Math.max(worst, t - prevT);
    prevT = t;
  }
  while (cursor < deltas.length) t += deltas[cursor++];
  worst = Math.max(worst, t - prevT);
  return timescale ? worst / timescale : 0;
}

function readTrack(b: Uint8Array, trak: Box): TrackInfo | null {
  const mdia = find(trak.kids, "mdia"), tkhd = find(trak.kids, "tkhd");
  const mdhd = find(mdia?.kids, "mdhd"), hdlr = find(mdia?.kids, "hdlr");
  const stbl = find(find(mdia?.kids, "minf")?.kids, "stbl");
  const stts = find(stbl?.kids, "stts"), stsz = find(stbl?.kids, "stsz");
  if (!mdia || !tkhd || !mdhd || !hdlr || !stbl || !stts || !stsz) return null;
  const handler = latin1(b, hdlr.start + 8, hdlr.start + 12);
  const kind: TrackCheck["kind"] = handler === "vide" ? "video" : handler === "soun" ? "audio" : "other";
  const { timescale, duration } = timescaleAndDuration(b, mdhd);
  const stsd = find(stbl.kids, "stsd");
  const codec = stsd && stsd.start + 16 <= stsd.end ? latin1(b, stsd.start + 12, stsd.start + 16) : "";
  const deltas = readDeltas(b, stts);
  // The dominant delta is the frame length; everything else is a cut, a join or a defect.
  const counts = new Map<number, number>();
  for (const d of deltas) counts.set(d, (counts.get(d) ?? 0) + 1);
  let nominalDelta = 0, best = -1;
  for (const [d, c] of counts) if (c > best || (c === best && d > nominalDelta)) { best = c; nominalDelta = d; }
  let zeroLength = 0, shortFrames = 0, irregular = 0, t = 0;
  const zeroLengthAt: number[] = [], irregularAt: number[] = [];
  for (const d of deltas) {
    if (d === 0) {
      zeroLength++;
      if (zeroLengthAt.length < 12) zeroLengthAt.push(t / timescale);
    } else if (kind === "video" && d !== nominalDelta) {
      irregular++;
      if (d * 5 < nominalDelta) shortFrames++;
      if (irregularAt.length < 2000) irregularAt.push(t / timescale);
    }
    t += d;
  }
  const fixed = u32(b, stsz.start + 4), n = u32(b, stsz.start + 8);
  let bytes = 0;
  if (fixed) bytes = fixed * n;
  else for (let i = 0; i < n; i++) bytes += u32(b, stsz.start + 12 + i * 4);
  const stss = find(stbl.kids, "stss");
  const ctts = find(stbl.kids, "ctts");
  let negativeCtts = false;
  if (ctts && fullBoxVersion(b, ctts) === 1) {
    const cn = u32(b, ctts.start + 4);
    for (let i = 0; i < cn && !negativeCtts; i++) if (i32(b, ctts.start + 12 + i * 8) < 0) negativeCtts = true;
  }
  const stco = find(stbl.kids, "stco"), co64 = find(stbl.kids, "co64");
  const firstChunk = co64 && u32(b, co64.start + 4) > 0 ? u64(b, co64.start + 8) : stco && u32(b, stco.start + 4) > 0 ? u32(b, stco.start + 8) : 0;
  const elstBox = find(find(trak.kids, "edts")?.kids, "elst");
  const elst = elstBox ? readElst(b, elstBox) : null;
  const tv = fullBoxVersion(b, tkhd);
  const tkhdDuration = tv === 1 ? u64(b, tkhd.start + 28) : u32(b, tkhd.start + 20);
  return {
    trak,
    deltas,
    tkhdDuration,
    negativeCtts,
    firstChunk,
    check: {
      kind,
      timescale,
      durationS: timescale ? duration / timescale : 0,
      samples: deltas.length,
      keyframes: stss ? u32(b, stss.start + 4) : null,
      zeroLength,
      zeroLengthAt,
      shortFrames: kind === "video" ? shortFrames : 0,
      irregular: kind === "video" ? irregular : 0,
      nominalDelta,
      elst,
      emptyEdit: !!elst && elst.length > 0 && elst[0].mediaTime === -1,
      hasCtts: !!ctts,
      negativeCtts,
      bytes,
      codec,
      entry: readSampleEntry(b, stsd, kind),
      irregularAt,
      maxKeyGapS: kind === "video" && stss ? readKeyGap(b, stss, deltas, timescale) : null,
    },
  };
}

/** Read the index of an MP4 and say what is wrong with it, and what is merely worth knowing. */
export async function checkMp4(file: Blob): Promise<Mp4Check> {
  const parsed = await parseFile(file);
  const { size, top, moov, bytes, tree } = parsed;
  const mdats = top.filter((b) => b.type === "mdat");
  const mdat = mdats[0];
  const mdatAt = mdat?.offset ?? -1, mdatSize = mdat?.size ?? 0;
  const mdatPayload = mdats.reduce((a, m) => a + (m.size - m.header), 0);
  const problems: string[] = [], notes: string[] = [];
  const base: Omit<Mp4Check, "tracks" | "durationS" | "sizesMatch" | "tags" | "ok"> = {
    size,
    moovAt: moov?.offset ?? -1,
    moovSize: moov?.size ?? 0,
    mdatAt,
    mdatSize,
    layout: !moov || !mdat ? "other" : moov.offset + moov.size === size && moov.offset > mdat.offset ? "moov-last" : moov.offset < mdat.offset ? "moov-first" : "other",
    problems,
    notes,
  };
  if (!moov || !bytes.length) {
    problems.push(moov ? "The index (moov) runs past the end of the file: the file is cut short" : "No index (moov) found: the file is incomplete or not an MP4");
    return { ...base, tracks: [], durationS: 0, sizesMatch: false, tags: {}, ok: false };
  }
  const mvhd = find(tree, "mvhd");
  const movie = mvhd ? timescaleAndDuration(bytes, mvhd) : { timescale: 1, duration: 0 };
  const durationS = movie.timescale ? movie.duration / movie.timescale : 0;
  const tracks: TrackInfo[] = [];
  for (const trak of findAll(tree, "trak")) {
    const t = readTrack(bytes, trak);
    if (t) tracks.push(t);
  }
  const tags = readTags(bytes, tree);
  const total = tracks.reduce((a, t) => a + t.check.bytes, 0);
  // mediabunny leaves an 8-byte slot after a 32-bit mdat header (room for a 64-bit size it did not need), so the
  // samples start a little after the payload does: the sum must fill the payload from the first chunk onwards.
  const dataStart = Math.min(...tracks.map((t) => t.firstChunk).filter((o) => o > 0));
  const slack = mdat && Number.isFinite(dataStart) ? Math.max(0, dataStart - (mdat.offset + mdat.header)) : 0;
  const sizesMatch = mdats.length > 0 && slack <= 16 && total + slack === mdatPayload;

  notes.push(base.layout === "moov-last" ? "Index at the end of the file" : base.layout === "moov-first" ? "Index first (fast start)" : "Index in the middle of the file");
  if (!tracks.length) problems.push("The index has no tracks");
  for (const [i, t] of tracks.entries()) {
    const c = t.check;
    const label = c.kind === "video" ? "video" : c.kind === "audio" ? "audio" : `track ${i + 1}`;
    if (c.samples === 0) problems.push(`The ${label} track has no samples`);
    if (c.zeroLength) {
      const at = c.zeroLengthAt.slice(0, 3).map(fmtClock).join(", ") + (c.zeroLength > 3 ? ", …" : "");
      problems.push(`${c.zeroLength === 1 ? "A frame shares" : `${fmtInt(c.zeroLength)} frames share`} a timestamp with the next frame (zero-length samples) at ${at}`);
    }
    if (c.kind === "video" && c.emptyEdit) {
      const ms = movie.timescale ? (c.elst![0].segDur / movie.timescale) * 1000 : 0;
      problems.push(`The picture starts ${ms.toFixed(1)} ms late through an empty edit in its edit list`);
    } else if (c.elst && c.elst.length) notes.push(`The ${label} track has an edit list with ${c.elst.length} ${c.elst.length === 1 ? "entry" : "entries"}`);
    if (t.negativeCtts) problems.push("The video has negative composition offsets: frames placed before their predecessors");
    else if (c.hasCtts && c.kind === "video") notes.push("Composition offsets present (B-frames)");
    const drift = c.durationS - durationS;
    if (Math.abs(drift) > 5) problems.push(`The ${label} track runs ${Math.abs(drift).toFixed(1)} s ${drift > 0 ? "longer" : "shorter"} than the movie`);
    else if (Math.abs(drift) > 1.5) notes.push(`The ${label} track runs ${Math.abs(drift).toFixed(1)} s ${drift > 0 ? "longer" : "shorter"} than the movie`);
    if (c.kind === "video") {
      const fps = c.nominalDelta ? c.timescale / c.nominalDelta : 0;
      notes.push(`${fmtClock(c.durationS)}, ${fmtInt(c.samples)} frames${fps ? ` at ${fps.toFixed(fps % 1 ? 2 : 0)} fps` : ""}${c.codec ? ` (${c.codec})` : ""}`);
      if (c.keyframes !== null && c.keyframes > 0) notes.push(`${fmtInt(c.keyframes)} keyframe${c.keyframes === 1 ? "" : "s"}, one every ${(c.durationS / c.keyframes).toFixed(1)} s`);
      if (c.irregular) notes.push(`${fmtInt(c.irregular)} frame${c.irregular === 1 ? "" : "s"} shorter or longer than a frame at cuts — legal`);
      if (c.shortFrames) notes.push(`${fmtInt(c.shortFrames)} of them under a fifth of a frame long`);
    } else if (c.kind === "audio") notes.push(`${fmtInt(c.samples)} audio frames at ${fmtInt(c.timescale)} Hz${c.codec ? ` (${c.codec})` : ""}`);
  }
  if (!sizesMatch) problems.push(mdats.length ? `The index does not match the data: the samples add up to ${fmtInt(total)} bytes but the file holds ${fmtInt(mdatPayload)}` : "No media data (mdat) found");
  const tagKeys = Object.keys(tags).filter((k) => k !== "encoder");
  notes.push(tagKeys.length ? `Tags: ${tagKeys.map((k) => (k === "kind" ? `kind ${tags.kind.replace("-", " ")}` : k === "albumArtist" ? "album artist" : k)).join(", ")}` : "No tags");
  return { ...base, tracks: tracks.map((t) => t.check), durationS, sizesMatch, tags, ok: problems.length === 0 };
}

/** One line for the UI: "Ready to upload" or how many problems there are. */
export function describeCheck(c: Mp4Check): string {
  return c.ok ? "Ready to upload" : `${c.problems.length} problem${c.problems.length === 1 ? "" : "s"}`;
}

/* ------------------------------------------------------------------ repair */

function serialize(b: Uint8Array<ArrayBuffer>, box: Box): Uint8Array<ArrayBuffer> {
  if (box.replaced) return box.replaced;
  if (!box.kids || !REBUILT.has(box.type)) return b.subarray(box.at, box.end);
  const parts = box.kids.map((k) => serialize(b, k));
  const total = 8 + parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  putU32(out, 0, total);
  out.set(b.subarray(box.at + 4, box.at + 8), 4);
  let p = 8;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/**
 * What the repair would do to this file's index, or null when there is nothing to repair. A zero-length
 * sample takes half of the frame before it (so every other timestamp stays), and an empty edit that only
 * delays the picture is dropped. Only files with the index at the tail and no composition offsets qualify.
 */
export async function planRepair(file: Blob): Promise<IndexRepair | null> {
  const { size, moov, bytes, tree } = await parseFile(file);
  if (!moov || !bytes.length) return null;
  const mvhd = find(tree, "mvhd");
  const movieTs = mvhd ? timescaleAndDuration(bytes, mvhd).timescale : 0;
  const changes: string[] = [];
  let needed = false;
  for (const trak of findAll(tree, "trak")) {
    const t = readTrack(bytes, trak);
    if (!t || t.check.kind !== "video") continue;
    const c = t.check;
    const dropEdit = c.emptyEdit && c.elst!.filter((e) => e.mediaTime !== -1).length === 1 && c.elst!.find((e) => e.mediaTime !== -1)!.mediaTime === 0;
    if (!c.zeroLength && !dropEdit) continue;
    needed = true;
    if (moov.offset + moov.size !== size) throw new Error("The index is not at the end of the file, so it cannot be rewritten in place. Remux the file (ffmpeg -c copy) instead.");
    if (c.hasCtts) throw new Error("The video has composition offsets (B-frames), which this repair cannot adjust. Remux the file instead.");
    for (const b of trak.kids ?? []) if (u32(bytes, b.at) === 1) throw new Error("The index uses 64-bit boxes, which this repair does not rewrite.");
    const mdia = find(trak.kids, "mdia")!, stbl = find(find(mdia.kids, "minf")!.kids, "stbl")!, stts = find(stbl.kids, "stts")!;
    if (c.zeroLength) {
      // Only the frame right before a zero-length one gives up time (half of it), so every other timestamp in the
      // file stays as it was. A track whose tick is a whole frame (timescale 30 at 30 fps) has nothing to split, so
      // its time resolution is doubled first — the same instants, finer ticks.
      let scale = 1, deltas = Uint32Array.from(t.deltas);
      const split = (d: Uint32Array, note: boolean) => {
        let at = 0;
        for (let i = 0; i < d.length; i++) {
          if (d[i] === 0) {
            if (i === 0) throw new Error("The first frame of the video has no length and nothing before it to share time with.");
            if (d[i - 1] < 2) return false;
            const half = Math.floor(d[i - 1] / 2);
            d[i - 1] -= half;
            d[i] = half;
            if (note) changes.push(`Frame at ${fmtClock(at / (c.timescale * scale))}: ${half} of the previous frame's ${half + d[i - 1]} ticks moved to the frame that shared its timestamp`);
          }
          at += d[i];
        }
        return true;
      };
      while (!split(Uint32Array.from(deltas), false)) {
        scale *= 2;
        if (scale > 64) throw new Error("The frames around a zero-length one are too short to share time.");
        deltas = Uint32Array.from(t.deltas, (d) => d * scale);
      }
      if (scale > 1) {
        const mdhd = find(mdia.kids, "mdhd")!;
        const media = timescaleAndDuration(bytes, mdhd);
        const copy = bytes.slice(mdhd.at, mdhd.end);
        if (fullBoxVersion(bytes, mdhd) === 1) {
          putU32(copy, 8 + 20, media.timescale * scale);
          putU64(copy, 8 + 24, media.duration * scale);
        } else {
          putU32(copy, 8 + 12, media.timescale * scale);
          putU32(copy, 8 + 16, media.duration * scale);
        }
        mdhd.replaced = copy;
        const elstBox = find(find(trak.kids, "edts")?.kids, "elst");
        if (elstBox && !dropEdit) {
          const e = bytes.slice(elstBox.at, elstBox.end), v = fullBoxVersion(bytes, elstBox), n = u32(e, 12);
          for (let i = 0, q = 16; i < n; i++, q += v === 1 ? 20 : 12) {
            if (v === 1) { const m = i64(e, q + 8); if (m >= 0) putU64(e, q + 8, m * scale); }
            else { const m = i32(e, q + 4); if (m >= 0) putU32(e, q + 4, m * scale); }
          }
          elstBox.replaced = e;
        }
        changes.push(`Time resolution of the video ×${scale} (timescale ${fmtInt(media.timescale)} → ${fmtInt(media.timescale * scale)}) so a shared tick can be split`);
      }
      split(deltas, true);
      const runs: [number, number][] = [];
      for (const d of deltas) {
        const last = runs[runs.length - 1];
        if (last && last[1] === d) last[0]++;
        else runs.push([1, d]);
      }
      const raw = new Uint8Array(16 + runs.length * 8);
      putU32(raw, 0, raw.length);
      raw.set([0x73, 0x74, 0x74, 0x73], 4); // "stts"
      putU32(raw, 12, runs.length);
      runs.forEach(([count, d], i) => {
        putU32(raw, 16 + i * 8, count);
        putU32(raw, 20 + i * 8, d);
      });
      stts.replaced = raw;
    }
    if (dropEdit) {
      const edts = find(trak.kids, "edts")!, tkhd = find(trak.kids, "tkhd")!;
      trak.kids = trak.kids!.filter((k) => k !== edts);
      // The track now lasts exactly as long as its media: say so in the movie's timescale.
      const mdhd = find(mdia.kids, "mdhd")!;
      const media = timescaleAndDuration(bytes, mdhd);
      const trackDur = media.timescale && movieTs ? Math.round((media.duration * movieTs) / media.timescale) : t.tkhdDuration;
      const copy = bytes.slice(tkhd.at, tkhd.end);
      if (fullBoxVersion(bytes, tkhd) === 1) putU64(copy, 8 + 28, trackDur);
      else putU32(copy, 8 + 20, trackDur);
      tkhd.replaced = copy;
      const ms = movieTs ? (c.elst![0].segDur / movieTs) * 1000 : 0;
      changes.push(`Empty edit of ${ms.toFixed(1)} ms removed: the picture starts at 0 (track duration ${fmtInt(t.tkhdDuration)} → ${fmtInt(trackDur)})`);
    }
  }
  if (!needed) return null;
  const root: Box = { type: "moov", at: 0, end: bytes.length, start: moov.header, kids: tree };
  const out = serialize(bytes, root);
  changes.push(`Index ${fmtInt(bytes.length)} → ${fmtInt(out.length)} bytes`);
  return { moov: out, moovAt: moov.offset, oldSize: moov.size, changes };
}

/**
 * Apply a repair in place: the file is cut at the old index and the new one written there. The media bytes
 * before it are never read or written. Returns the new file size.
 */
export async function applyRepair(handle: FileSystemFileHandle, repair: IndexRepair): Promise<number> {
  const w = await handle.createWritable({ keepExistingData: true });
  try {
    await w.truncate(repair.moovAt);
    await w.write({ type: "write", position: repair.moovAt, data: repair.moov });
  } finally {
    await w.close();
  }
  return repair.moovAt + repair.moov.byteLength;
}
