/**
 * MP4 / MOV file tags, read and rewritten without touching the media.
 *
 * Tags live in the iTunes-style item list (moov/udta/meta/ilst) that ffmpeg writes from -metadata:
 * ©nam title, ©ART artist, aART album artist, ©alb album, ©gen genre, ©day year, ©cmt comment,
 * ©too encoder and stik, the media kind (6 = music video, ffmpeg's media_type=6). QuickTime files
 * may also carry the text atoms straight under udta; those are kept in step so no reader sees stale
 * values. Everything else in the index (other tags, cover art, the tracks) is copied byte for byte.
 *
 * The module is pure: the file comes in as a ByteSource (a File in the browser, a Buffer in tests),
 * and the result is a write plan: either a patch at one offset or a list of parts for a new copy.
 */

export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

export interface BoxRef {
  type: string;
  offset: number;
  size: number;
  /** Bytes before the payload: 8, or 16 for a 64-bit size. */
  header: number;
}

/** The editable tags. An empty string means not set; kind null means no media-kind atom. */
export interface FileTags {
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: string;
  comment: string;
  kind: number | null;
}

export type TextTagKey = Exclude<keyof FileTags, "kind">;

export const EMPTY_TAGS: FileTags = { title: "", artist: "", albumArtist: "", album: "", genre: "", year: "", comment: "", kind: null };

/** The item-list atom for each text tag, in the order new ones are appended. */
export const TEXT_ATOMS: Record<TextTagKey, string> = {
  title: "©nam",
  artist: "©ART",
  albumArtist: "aART",
  album: "©alb",
  genre: "©gen",
  year: "©day",
  comment: "©cmt",
};
export const KIND_ATOM = "stik";
export const ENCODER_ATOM = "©too";

/** The media kinds worth offering (stik values; ffmpeg's -metadata media_type). */
export const MEDIA_KINDS: { value: number; label: string }[] = [
  { value: 6, label: "Music video" },
  { value: 9, label: "Movie" },
  { value: 10, label: "TV show" },
];

export function kindLabel(kind: number | null): string {
  if (kind === null) return "not set";
  return MEDIA_KINDS.find((k) => k.value === kind)?.label ?? `other (${kind})`;
}

/** Friendly names for item-list atoms that are kept as they are. */
const KEPT_NAMES: Record<string, string> = {
  covr: "cover art",
  "©lyr": "lyrics",
  "©wrt": "composer",
  "©des": "description",
  desc: "description",
  ldes: "long description",
  cprt: "copyright",
  trkn: "track number",
  disc: "disc number",
  tvsh: "TV show",
  tven: "episode id",
  tvsn: "season",
  tves: "episode",
  "©xyz": "location",
  "©grp": "grouping",
  keyw: "keywords",
  "----": "custom (freeform)",
  "©too": "encoder",
};

export function keptName(atom: string): string {
  return KEPT_NAMES[atom] ? `${KEPT_NAMES[atom]} (${atom})` : atom;
}

export interface Inspection {
  size: number;
  boxes: BoxRef[];
  moov: BoxRef;
  moovBytes: Uint8Array;
  tags: FileTags;
  /** The encoder name (©too), shown but never changed. */
  encoder: string | null;
  /** Item-list atoms left as they are (cover art, lyrics, freeform…). */
  kept: string[];
  /** Fragmented (moof) files cannot have their index grow in place. */
  fragmented: boolean;
  /** Free/skip boxes right after the index that the new index may spill into. */
  slack: number;
  /** Where the index region ends. */
  regionEnd: number;
  /** "tail": the index is the last thing in the file, so only the tail is rewritten. "front": media data follows it. */
  layout: "tail" | "front";
}

export type Part = { bytes: Uint8Array<ArrayBuffer> } | { from: number; to: number };

export interface WritePlan {
  /** tail: overwrite from the index and cut the file there. fit: overwrite the index region in place. shift: rewrite the whole file. */
  mode: "tail" | "fit" | "shift";
  /** The whole new file, in order: bytes to write or a range copied from the original. */
  parts: Part[];
  /** tail and fit only: the one write that does it when the file can be edited in place. */
  patch: { at: number; bytes: Uint8Array<ArrayBuffer>; truncateTo: number | null } | null;
  /** The new file size. */
  size: number;
  /** shift only: how far the media data moves. */
  delta: number;
}

/** Spare room written after an index that had to move, so the next edit fits in place. */
export const SHIFT_PAD = 16 * 1024;
/** An index bigger than this is not something we load into memory. */
const MAX_MOOV = 512 * 1024 * 1024;

const utf8 = new TextEncoder();
const utf8d = new TextDecoder("utf-8");

// ---------- bytes ----------

function fourcc(b: Uint8Array, o: number): string {
  return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
}

function isFourcc(b: Uint8Array, o: number): boolean {
  for (let i = 0; i < 4; i++) {
    const c = b[o + i];
    if (c === undefined || c < 0x20 || (c > 0x7e && c !== 0xa9)) return false;
  }
  return true;
}

function dv(b: Uint8Array): DataView {
  return new DataView(b.buffer, b.byteOffset, b.byteLength);
}

function be32(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
}

function concat(parts: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** Latin-1 fourcc → bytes (© is 0xA9). */
function typeBytes(type: string): number[] {
  if (type.length !== 4) throw new Error(`bad atom name ${JSON.stringify(type)}`);
  return [type.charCodeAt(0) & 0xff, type.charCodeAt(1) & 0xff, type.charCodeAt(2) & 0xff, type.charCodeAt(3) & 0xff];
}

export function box(type: string, ...payload: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  let n = 8;
  for (const p of payload) n += p.length;
  if (n > 0xffffffff) throw new Error("box too large");
  return concat([be32(n), typeBytes(type), ...payload]);
}

function fullBox(type: string, ...payload: (Uint8Array | number[])[]): Uint8Array<ArrayBuffer> {
  return box(type, [0, 0, 0, 0], ...payload);
}

/** Parse one box header at `o` inside [o, end). Null when fewer than 8 bytes remain. */
function header(b: Uint8Array, o: number, end: number): { type: string; size: number; header: number } | null {
  if (end - o < 8) return null;
  const v = dv(b);
  let size = v.getUint32(o);
  const type = fourcc(b, o + 4);
  let h = 8;
  if (size === 1) {
    if (end - o < 16) throw new Error("truncated 64-bit box header");
    size = Number(v.getBigUint64(o + 8));
    h = 16;
  } else if (size === 0) {
    size = end - o;
  }
  if (size < h || o + size > end) throw new Error(`corrupt ${JSON.stringify(type)} box at ${o}`);
  return { type, size, header: h };
}

interface Child {
  type: string;
  /** Start of the box within the parent buffer. */
  start: number;
  size: number;
  header: number;
}

/** Children of the payload [start, end); `tail` is where unparseable trailing bytes begin (= end when none). */
function children(b: Uint8Array, start: number, end: number): { boxes: Child[]; tail: number } {
  const boxes: Child[] = [];
  let o = start;
  while (o < end) {
    const h = header(b, o, end);
    if (!h) break;
    boxes.push({ type: h.type, start: o, size: h.size, header: h.header });
    o += h.size;
  }
  return { boxes, tail: o };
}

function payload(b: Uint8Array, c: Child): Uint8Array {
  return b.subarray(c.start + c.header, c.start + c.size);
}

function raw(b: Uint8Array, c: Child): Uint8Array {
  return b.subarray(c.start, c.start + c.size);
}

/** meta is a full box in MP4 (version + flags) but a plain box in Apple's mdta files: tell by whether a box name sits where the flags would be. */
function metaPayloadStart(b: Uint8Array, meta: Child): number {
  const p = meta.start + meta.header;
  return isFourcc(b, p + 4) ? p : p + 4;
}

function handlerOf(b: Uint8Array, metaStart: number, metaEnd: number): string | null {
  for (const c of children(b, metaStart, metaEnd).boxes) {
    if (c.type === "hdlr" && c.size >= 20) return fourcc(b, c.start + c.header + 8);
  }
  return null;
}

// ---------- the top level ----------

/** The top-level boxes. A last box that claims more than the file holds (a recording cut short) is clamped to the end. */
export async function scanBoxes(src: ByteSource): Promise<BoxRef[]> {
  const boxes: BoxRef[] = [];
  let o = 0;
  while (src.size - o >= 8) {
    const head = await src.read(o, Math.min(16, src.size - o));
    const v = dv(head);
    let size = v.getUint32(0);
    let h = 8;
    if (size === 1) {
      if (head.length < 16) break;
      size = Number(v.getBigUint64(8));
      h = 16;
    } else if (size === 0) size = src.size - o;
    if (size < h) throw new Error(`corrupt ${JSON.stringify(fourcc(head, 4))} box at ${o}`);
    if (o + size > src.size) size = src.size - o;
    boxes.push({ type: fourcc(head, 4), offset: o, size, header: h });
    o += size;
  }
  return boxes;
}

export async function inspectFile(src: ByteSource): Promise<Inspection> {
  if (src.size < 16) throw new Error("This is not an MP4 or MOV file.");
  const first = await src.read(4, 4);
  if (!isFourcc(first, 0) || !["ftyp", "moov", "mdat", "free", "skip", "wide"].includes(fourcc(first, 0))) throw new Error("This is not an MP4 or MOV file (no ftyp or moov box at the start).");
  const boxes = await scanBoxes(src);
  const moov = boxes.find((b) => b.type === "moov");
  if (!moov) throw new Error("No index (moov box) found: the file is not an MP4 or MOV, or it is damaged.");
  if (moov.size > MAX_MOOV) throw new Error("The file's index is unusually large; refusing to load it.");
  const moovBytes = await src.read(moov.offset, moov.size);
  const read = readTags(moovBytes);
  let slack = 0;
  for (let i = boxes.indexOf(moov) + 1; i < boxes.length && (boxes[i].type === "free" || boxes[i].type === "skip"); i++) slack += boxes[i].size;
  const regionEnd = moov.offset + moov.size + slack;
  return { size: src.size, boxes, moov, moovBytes, ...read, slack, regionEnd, layout: regionEnd >= src.size ? "tail" : "front" };
}

export function blobSource(file: Blob): ByteSource {
  return { size: file.size, read: async (o, n) => new Uint8Array(await file.slice(o, o + n).arrayBuffer()) };
}

// ---------- reading ----------

interface Located {
  udta: Child | null;
  /** The mdir meta inside udta, with its payload bounds. */
  meta: { box: Child; start: number; end: number } | null;
  ilst: Child | null;
}

/** Where the index's children start (8, or 16 for a 64-bit size). */
function moovStart(moov: Uint8Array): number {
  const h = header(moov, 0, moov.length);
  if (!h || h.type !== "moov") throw new Error("not a moov box");
  return h.header;
}

function locate(moov: Uint8Array): Located {
  const top = children(moov, moovStart(moov), moov.length).boxes;
  const udta = top.find((c) => c.type === "udta") ?? null;
  if (!udta) return { udta: null, meta: null, ilst: null };
  for (const c of children(moov, udta.start + udta.header, udta.start + udta.size).boxes) {
    if (c.type !== "meta") continue;
    const start = metaPayloadStart(moov, c);
    const end = c.start + c.size;
    if (handlerOf(moov, start, end) !== "mdir") continue;
    const ilst = children(moov, start, end).boxes.find((x) => x.type === "ilst") ?? null;
    return { udta, meta: { box: c, start, end }, ilst };
  }
  return { udta, meta: null, ilst: null };
}

/** The value of an item's first data box: text for the well-known text types, an integer for the int types, else null. */
function itemValue(moov: Uint8Array, item: Child): { text?: string; int?: number } | null {
  const data = children(moov, item.start + item.header, item.start + item.size).boxes.find((c) => c.type === "data");
  if (!data || data.size < 16) return null;
  const p = payload(moov, data);
  const type = dv(p).getUint32(0) & 0xffffff;
  const value = p.subarray(8);
  // 1 = UTF-8, 2 = UTF-16, 21/22 = integer; 0 ("implicit") is text for the text atoms and an integer for stik.
  const asInt = () => {
    if (value.length < 1 || value.length > 4) return null;
    let n = 0;
    for (const c of value) n = n * 256 + c;
    return { int: n };
  };
  if (type === 21 || type === 22) return asInt();
  if (type === 2) return { text: new TextDecoder("utf-16be").decode(value) };
  if (type === 1 || type === 0) return item.type === KIND_ATOM ? asInt() : { text: utf8d.decode(value) };
  return null;
}

export function readTags(moov: Uint8Array): { tags: FileTags; encoder: string | null; kept: string[]; fragmented: boolean } {
  const fragmented = children(moov, moovStart(moov), moov.length).boxes.some((c) => c.type === "mvex");
  const tags: FileTags = { ...EMPTY_TAGS };
  let encoder: string | null = null;
  const kept: string[] = [];
  const { udta, ilst } = locate(moov);
  const atomKey = new Map(Object.entries(TEXT_ATOMS).map(([k, a]) => [a, k as TextTagKey]));
  if (ilst) {
    for (const item of children(moov, ilst.start + ilst.header, ilst.start + ilst.size).boxes) {
      const key = atomKey.get(item.type);
      const v = itemValue(moov, item);
      if (key && v?.text !== undefined) tags[key] = v.text;
      else if (item.type === KIND_ATOM && v?.int !== undefined) tags.kind = v.int;
      else if (item.type === ENCODER_ATOM && v?.text !== undefined) encoder = v.text;
      else if (!kept.includes(item.type)) kept.push(item.type);
    }
  }
  // QuickTime text atoms straight under udta fill in whatever the item list did not set.
  if (udta) {
    for (const c of children(moov, udta.start + udta.header, udta.start + udta.size).boxes) {
      const key = atomKey.get(c.type);
      if (!key || tags[key] || c.size < 12) continue;
      const p = payload(moov, c);
      const n = dv(p).getUint16(0);
      if (n + 4 <= p.length) tags[key] = utf8d.decode(p.subarray(4, 4 + n));
    }
  }
  return { tags, encoder, kept, fragmented };
}

// ---------- writing ----------

function textData(value: string): Uint8Array {
  return box("data", be32(1), [0, 0, 0, 0], utf8.encode(value));
}

function intData(value: number): Uint8Array {
  return box("data", be32(21), [0, 0, 0, 0], [value & 0xff]);
}

function mdirHandler(): Uint8Array {
  return fullBox("hdlr", [0, 0, 0, 0], typeBytes("mdir"), typeBytes("appl"), [0, 0, 0, 0, 0, 0, 0, 0], [0]);
}

/** The QuickTime text atom (u16 length, u16 language, text) as ffmpeg writes it for .mov. */
function qtText(type: string, value: string): Uint8Array {
  const bytes = utf8.encode(value);
  return box(type, [(bytes.length >>> 8) & 0xff, bytes.length & 0xff, 0x55, 0xc4], bytes);
}

/** The ilst items the tags call for, keyed by atom (empty values mean "remove"). */
function wanted(tags: FileTags): Map<string, Uint8Array | null> {
  const m = new Map<string, Uint8Array | null>();
  for (const [key, atom] of Object.entries(TEXT_ATOMS) as [TextTagKey, string][]) {
    const v = tags[key].trim();
    m.set(atom, v ? box(atom, textData(v)) : null);
  }
  m.set(KIND_ATOM, tags.kind === null ? null : box(KIND_ATOM, intData(tags.kind)));
  return m;
}

/** A copy of the index with the tags applied; everything else is carried over byte for byte. */
export function withTags(moov: Uint8Array, tags: FileTags): Uint8Array<ArrayBuffer> {
  const want = wanted(tags);
  const { udta, meta, ilst } = locate(moov);

  // item list: existing items in order, managed ones replaced or dropped, missing ones appended
  const items: Uint8Array[] = [];
  const seen = new Set<string>();
  if (ilst) {
    for (const item of children(moov, ilst.start + ilst.header, ilst.start + ilst.size).boxes) {
      if (want.has(item.type)) {
        if (seen.has(item.type)) continue;
        seen.add(item.type);
        const w = want.get(item.type);
        if (w) items.push(w);
      } else items.push(raw(moov, item));
    }
  }
  for (const [atom, w] of want) if (!seen.has(atom) && w) items.push(w);
  const newIlst = box("ilst", ...items);

  // meta: keep its other children (free, keys…) between the handler and the list
  const metaInner: Uint8Array[] = [];
  let hdlr: Uint8Array | null = null;
  if (meta) {
    for (const c of children(moov, meta.start, meta.end).boxes) {
      if (c.type === "hdlr") hdlr = raw(moov, c);
      else if (c.type !== "ilst") metaInner.push(raw(moov, c));
    }
  }
  const newMeta = fullBox("meta", hdlr ?? mdirHandler(), ...metaInner, newIlst);

  // udta: QuickTime text atoms follow the tags, the mdir meta is replaced or appended, the rest stays
  const udtaInner: Uint8Array[] = [];
  let placed = false;
  let udtaTail: Uint8Array = new Uint8Array(0);
  if (udta) {
    const { boxes, tail } = children(moov, udta.start + udta.header, udta.start + udta.size);
    for (const c of boxes) {
      if (meta && c.start === meta.box.start) {
        udtaInner.push(newMeta);
        placed = true;
      } else if (want.has(c.type) && c.type !== KIND_ATOM) {
        const key = (Object.entries(TEXT_ATOMS) as [TextTagKey, string][]).find(([, a]) => a === c.type)![0];
        const v = tags[key].trim();
        if (v) udtaInner.push(qtText(c.type, v));
      } else udtaInner.push(raw(moov, c));
    }
    udtaTail = moov.subarray(tail, udta.start + udta.size);
  }
  if (!placed) udtaInner.push(newMeta);
  const newUdta = box("udta", ...udtaInner, udtaTail);

  // moov
  const top = children(moov, moovStart(moov), moov.length);
  const out: Uint8Array[] = [];
  let udtaPlaced = false;
  for (const c of top.boxes) {
    if (udta && c.start === udta.start) {
      out.push(newUdta);
      udtaPlaced = true;
    } else out.push(raw(moov, c));
  }
  if (!udtaPlaced) out.push(newUdta);
  return box("moov", ...out, moov.subarray(top.tail));
}

/** Add `delta` to every chunk offset at or past `threshold`; returns how many entries moved. */
export function shiftChunkOffsets(moov: Uint8Array, threshold: number, delta: number): number {
  let moved = 0;
  const v = dv(moov);
  const walk = (start: number, end: number, depth: number) => {
    for (const c of children(moov, start, end).boxes) {
      if (c.type === "stco" && c.size >= 16) {
        const p = c.start + c.header + 4;
        const n = v.getUint32(p);
        for (let i = 0; i < n; i++) {
          const o = p + 4 + i * 4;
          const x = v.getUint32(o);
          if (x >= threshold) {
            if (x + delta > 0xffffffff) throw new Error("A chunk offset would no longer fit in 32 bits after moving the media; the file needs a 64-bit chunk table.");
            v.setUint32(o, x + delta);
            moved++;
          }
        }
      } else if (c.type === "co64" && c.size >= 16) {
        const p = c.start + c.header + 4;
        const n = v.getUint32(p);
        for (let i = 0; i < n; i++) {
          const o = p + 4 + i * 8;
          const x = v.getBigUint64(o);
          if (x >= BigInt(threshold)) {
            v.setBigUint64(o, x + BigInt(delta));
            moved++;
          }
        }
      } else if (["trak", "mdia", "minf", "stbl"].includes(c.type) && depth < 5) walk(c.start + c.header, c.start + c.size, depth + 1);
    }
  };
  walk(moovStart(moov), moov.length, 0);
  return moved;
}

function freeBox(n: number): Uint8Array<ArrayBuffer> {
  if (n < 8) throw new Error("free box needs 8 bytes");
  const out = new Uint8Array(n);
  out.set(be32(n), 0);
  out.set(typeBytes("free"), 4);
  return out;
}

/** How to get `newMoov` into the file described by `ins`. */
export function planWrite(ins: Inspection, newMoov: Uint8Array<ArrayBuffer>): WritePlan {
  const at = ins.moov.offset;
  if (ins.layout === "tail") {
    return { mode: "tail", parts: [{ from: 0, to: at }, { bytes: newMoov }], patch: { at, bytes: newMoov, truncateTo: at + newMoov.length }, size: at + newMoov.length, delta: 0 };
  }
  const region = ins.regionEnd - at;
  if (newMoov.length === region || newMoov.length + 8 <= region) {
    const bytes = newMoov.length === region ? newMoov : concat([newMoov, freeBox(region - newMoov.length)]);
    return { mode: "fit", parts: [{ from: 0, to: at }, { bytes }, { from: ins.regionEnd, to: ins.size }], patch: { at, bytes, truncateTo: null }, size: ins.size, delta: 0 };
  }
  if (ins.fragmented) throw new Error("The tags no longer fit in the space the index has, and this file is fragmented, so its media cannot be moved. Shorten the tags, or remux the file first.");
  const moved = new Uint8Array(newMoov);
  const delta = moved.length + SHIFT_PAD - region;
  shiftChunkOffsets(moved, ins.regionEnd, delta);
  const padded = concat([moved, freeBox(SHIFT_PAD)]);
  return { mode: "shift", parts: [{ from: 0, to: at }, { bytes: padded }, { from: ins.regionEnd, to: ins.size }], patch: null, size: ins.size + delta, delta };
}

/** Everything the save needs, from an inspection and the edited tags. */
export function planTags(ins: Inspection, tags: FileTags): WritePlan {
  return planWrite(ins, withTags(ins.moovBytes, tags));
}

export function sameTags(a: FileTags, b: FileTags): boolean {
  return (Object.keys(EMPTY_TAGS) as (keyof FileTags)[]).every((k) => (k === "kind" ? a.kind === b.kind : (a[k] as string).trim() === (b[k] as string).trim()));
}

/** Bytes a plan writes, as opposed to copies: the user-visible cost of a save. */
export function planBytes(plan: WritePlan): { written: number; copied: number } {
  let written = 0, copied = 0;
  if (plan.patch) return { written: plan.patch.bytes.length, copied: 0 };
  for (const p of plan.parts) {
    if ("bytes" in p) written += p.bytes.length;
    else copied += p.to - p.from;
  }
  return { written, copied };
}
