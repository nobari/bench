/**
 * Editing a Telegram sticker (Lottie) by parts. A part is a shape group that carries paint — fills, strokes and
 * gradients — with the geometry it paints; a layer holds parts. Edits are a list of operations over the original
 * document (never mutated): hiding, renaming, opacity, a paint's colour or width, moving, scaling and rotating,
 * reordering, duplicating and adding shapes with a motion preset. `applyEdits` makes the edited document and tags
 * every layer, group and paint with its address, so the parts tree, the picking render and the highlight all speak
 * of the same things. Everything here is data in, data out; the widget renders.
 */
import { hexToRgb, type LottieJson } from "./tgs";

/** A layer "L3", a group "L3/0/1" (shape indices from the layer), a paint "L3/0/1#2" (its index in the group), or an added node "A4". */
export type Addr = string;
/** The key an edited document's nodes carry their address under (stripped at export). */
export const ADDR_KEY = "_ba";

export type PaintKind = "fill" | "stroke" | "gradient" | "gradientStroke";
const PAINT_TYPES: Record<string, PaintKind> = { fl: "fill", st: "stroke", gf: "gradient", gs: "gradientStroke" };
const GEOMETRY_TYPES = new Set(["sh", "el", "rc", "sr"]);

export interface PaintInfo {
  addr: Addr;
  kind: PaintKind;
  name: string;
  /** The colour now (a gradient's first stop), or null when it is keyframed. */
  hex: string | null;
  /** A gradient's colour stops now. */
  stops: string[];
  /** Stroke width now (strokes). */
  width: number | null;
  animated: boolean;
  hidden: boolean;
  /** What the original document had here (before any edit), to key the palette by. */
  origHex: string | null;
  origStops: string[];
}

export interface PartInfo {
  addr: Addr;
  name: string;
  /** The layer's index in the document. */
  layer: number;
  depth: number;
  hidden: boolean;
  opacity: number;
  paints: PaintInfo[];
  /** Geometry items painted by this part (its own and those of paint-less groups inside it). */
  geometry: number;
  added: boolean;
}

export interface LayerInfo {
  addr: Addr;
  index: number;
  name: string;
  /** 4 = shapes; others (precomp, solid, image, null, text) are listed without parts. */
  type: number;
  hidden: boolean;
  opacity: number;
  parts: PartInfo[];
  added: boolean;
}

/* ------------------------------------------------------------------ edits */

export type MotionKind = "none" | "pulse" | "bounce" | "spin" | "wiggle" | "fade" | "slide";
export const MOTIONS: { id: MotionKind; name: string; hint: string }[] = [
  { id: "none", name: "Still", hint: "No motion of its own" },
  { id: "pulse", name: "Pulse", hint: "Grows and shrinks once per loop" },
  { id: "bounce", name: "Bounce", hint: "Hops up and lands once per loop" },
  { id: "spin", name: "Spin", hint: "One full turn per loop" },
  { id: "wiggle", name: "Wiggle", hint: "Rocks left and right" },
  { id: "fade", name: "Fade", hint: "Dims and returns once per loop" },
  { id: "slide", name: "Slide in", hint: "Comes in from the left at the start" },
];
export type ShapeKind = "ellipse" | "rect" | "star" | "polygon" | "line" | "path";

export interface AddedShape {
  kind: ShapeKind;
  name?: string;
  /** Centre and size in the target layer's space (the sticker's 512 × 512 for the added layer). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius (rect). */
  r?: number;
  /** Points (star, polygon) and the star's inner radius as a fraction of the outer. */
  points?: number;
  inner?: number;
  /** A drawn path's points, in the layer's space; closed joins the last to the first; smooth rounds the corners. */
  path?: { x: number; y: number }[];
  closed?: boolean;
  smooth?: boolean;
  fill?: string | null;
  stroke?: string | null;
  width?: number;
  motion?: MotionKind;
  /** Motion size: percent for pulse, pixels for bounce and slide, degrees for wiggle, percent for fade. */
  amount?: number;
}

export type Op =
  | { t: "hide"; at: Addr }
  | { t: "show"; at: Addr }
  | { t: "name"; at: Addr; v: string }
  | { t: "opacity"; at: Addr; v: number }
  | { t: "color"; at: Addr; v: string; stop?: number }
  | { t: "width"; at: Addr; v: number }
  | { t: "move"; at: Addr; dx: number; dy: number }
  | { t: "scale"; at: Addr; f: number; cx?: number; cy?: number }
  | { t: "rotate"; at: Addr; deg: number; cx?: number; cy?: number }
  | { t: "order"; at: Addr; d: -1 | 1 }
  | { t: "dup"; at: Addr; id: Addr }
  | { t: "add"; id: Addr; shape: AddedShape };

export interface Edits {
  /** Original hex → new hex, over every paint still showing its original colour. */
  colors: Record<string, string>;
  ops: Op[];
}
export const emptyEdits = (): Edits => ({ colors: {}, ops: [] });
export const hasEdits = (e: Edits) => e.ops.length > 0 || Object.keys(e.colors).length > 0;

/** The layer added parts go into (made by the first add, on top). */
export const ADDED_LAYER = "A0";
export const MAX_OPS = 2000;

/** The next free id for an added or duplicated node. */
export function nextAddedId(edits: Edits): Addr {
  let n = 0;
  for (const op of edits.ops) {
    const id = op.t === "add" ? op.id : op.t === "dup" ? op.id : null;
    if (id && /^A\d+$/.test(id)) n = Math.max(n, Number(id.slice(1)));
  }
  return `A${n + 1}`;
}

/* ------------------------------------------------------------- the model */

type Node = Record<string, unknown>;
const isObj = (v: unknown): v is Node => !!v && typeof v === "object" && !Array.isArray(v);
const arr = (v: unknown): Node[] => (Array.isArray(v) ? (v as Node[]) : []);
const toHex = (k: unknown, o = 0): string | null => {
  if (!Array.isArray(k) || typeof k[o] !== "number" || k.length < o + 3) return null;
  return "#" + [k[o], k[o + 1], k[o + 2]].map((v) => Math.max(0, Math.min(255, Math.round((v as number) * 255))).toString(16).padStart(2, "0")).join("");
};
const staticValue = (prop: unknown): unknown => (isObj(prop) ? (prop.a === 1 ? undefined : prop.k) : prop);
const numberOf = (prop: unknown, fallback: number): number => {
  const v = staticValue(prop);
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
};

/** The stops of a gradient's static colour array: [offset, r, g, b] × p. */
function gradientStops(g: unknown): string[] {
  if (!isObj(g)) return [];
  const p = typeof g.p === "number" && g.p > 0 ? g.p : Infinity;
  const kk = isObj(g.k) ? g.k.k : undefined;
  if (!Array.isArray(kk) || typeof kk[0] !== "number") return [];
  const n = Math.min(p, Math.floor(kk.length / 4));
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(toHex(kk, i * 4 + 1) ?? "#000000");
  return out;
}

function paintInfo(node: Node, addr: Addr, orig: Node | null): PaintInfo {
  const kind = PAINT_TYPES[node.ty as string];
  const gradient = kind === "gradient" || kind === "gradientStroke";
  const animated = gradient ? isObj(node.g) && isObj((node.g as Node).k) && ((node.g as Node).k as Node).a === 1 : isObj(node.c) && (node.c as Node).a === 1;
  const stops = gradient ? gradientStops(node.g) : [];
  const origStops = gradient && orig ? gradientStops(orig.g) : [];
  return {
    addr,
    kind,
    name: typeof node.nm === "string" ? node.nm : kind === "fill" ? "Fill" : kind === "stroke" ? "Stroke" : "Gradient",
    hex: gradient ? (stops[0] ?? null) : toHex(staticValue(node.c)),
    stops,
    width: kind === "stroke" || kind === "gradientStroke" ? numberOf(node.w, 1) : null,
    animated,
    hidden: node.hd === true,
    origHex: orig ? (gradient ? (origStops[0] ?? null) : toHex(staticValue(orig.c))) : gradient ? (stops[0] ?? null) : toHex(staticValue(node.c)),
    origStops,
  };
}

/** A group's own geometry plus the geometry of groups inside it that carry no paint of their own. */
function geometryCount(items: Node[]): number {
  let n = 0;
  for (const it of items) {
    if (GEOMETRY_TYPES.has(it.ty as string)) n++;
    else if (it.ty === "gr" && !arr(it.it).some((x) => PAINT_TYPES[x.ty as string])) n += geometryCount(arr(it.it));
  }
  return n;
}

/**
 * The layers and parts of an edited document (one from `applyEdits`, whose nodes carry addresses) or of an original
 * (addresses derived from positions). `orig` supplies each paint's original colour when the document is an edited one.
 */
export function partsOf(doc: LottieJson, orig?: LottieJson): LayerInfo[] {
  const origIndex = orig ? indexNodes(orig) : null;
  const layers = arr(doc.layers);
  return layers.map((layer, li) => {
    const laddr = (layer[ADDR_KEY] as Addr | undefined) ?? `L${li}`;
    const parts: PartInfo[] = [];
    const walk = (items: Node[], prefix: Addr, depth: number) => {
      items.forEach((it, i) => {
        if (it.ty !== "gr") return;
        const addr = (it[ADDR_KEY] as Addr | undefined) ?? `${prefix}/${i}`;
        const inner = arr(it.it);
        const paints: PaintInfo[] = [];
        inner.forEach((x, j) => {
          if (!PAINT_TYPES[x.ty as string]) return;
          const paddr = (x[ADDR_KEY] as Addr | undefined) ?? `${addr}#${j}`;
          paints.push(paintInfo(x, paddr, origIndex?.get(paddr) ?? null));
        });
        if (paints.length) {
          const tr = inner.find((x) => x.ty === "tr");
          parts.push({ addr, name: typeof it.nm === "string" && it.nm ? it.nm : `Part ${parts.length + 1}`, layer: li, depth, hidden: it.hd === true, opacity: tr ? numberOf(tr.o, 100) : 100, paints, geometry: geometryCount(inner), added: addr.startsWith("A") });
        }
        walk(inner, addr, depth + 1);
      });
    };
    walk(arr(layer.shapes), laddr, 0);
    return { addr: laddr, index: li, name: typeof layer.nm === "string" && layer.nm ? layer.nm : `Layer ${li + 1}`, type: typeof layer.ty === "number" ? layer.ty : -1, hidden: layer.hd === true, opacity: isObj(layer.ks) ? numberOf((layer.ks as Node).o, 100) : 100, parts, added: laddr.startsWith("A") };
  });
}

/** Every layer, group and paint of an original document by its positional address. */
function indexNodes(doc: LottieJson): Map<Addr, Node> {
  const map = new Map<Addr, Node>();
  arr(doc.layers).forEach((layer, li) => {
    const laddr = `L${li}`;
    map.set(laddr, layer);
    const walk = (items: Node[], prefix: Addr) => {
      items.forEach((it, i) => {
        if (it.ty === "gr") {
          const addr = `${prefix}/${i}`;
          map.set(addr, it);
          arr(it.it).forEach((x, j) => {
            if (PAINT_TYPES[x.ty as string]) map.set(`${addr}#${j}`, x);
          });
          walk(arr(it.it), addr);
        }
      });
    };
    walk(arr(layer.shapes), laddr);
  });
  return map;
}

/** Tag every layer, group and paint of a document copy with its positional address. */
function tagNodes(doc: LottieJson): Map<Addr, Node> {
  const map = indexNodes(doc);
  for (const [addr, node] of map) node[ADDR_KEY] = addr;
  return map;
}

/* --------------------------------------------------------------- colours */

/** Write a colour into a paint: a solid's `c` (every keyframe when animated), or one stop (or all) of a gradient. */
function writePaintColor(node: Node, hex: string, stop?: number) {
  const rgb = hexToRgb(hex);
  const kind = PAINT_TYPES[node.ty as string];
  if (kind === "fill" || kind === "stroke") {
    const c = isObj(node.c) ? node.c : (node.c = { a: 0, k: [0, 0, 0, 1] });
    const k = c.k;
    if (Array.isArray(k) && typeof k[0] === "number") {
      k[0] = rgb[0];
      k[1] = rgb[1];
      k[2] = rgb[2];
    } else if (Array.isArray(k)) {
      for (const kf of k as Node[]) {
        const s = kf?.s;
        if (Array.isArray(s) && typeof s[0] === "number") {
          s[0] = rgb[0];
          s[1] = rgb[1];
          s[2] = rgb[2];
        }
      }
    }
    return;
  }
  const g = isObj(node.g) ? node.g : null;
  if (!g) return;
  const p = typeof g.p === "number" && g.p > 0 ? g.p : Infinity;
  const write = (a: number[]) => {
    const n = Math.min(p, Math.floor(a.length / 4));
    for (let i = 0; i < n; i++) {
      if (stop !== undefined && stop !== i) continue;
      a[i * 4 + 1] = rgb[0];
      a[i * 4 + 2] = rgb[1];
      a[i * 4 + 3] = rgb[2];
    }
  };
  const kk = isObj(g.k) ? g.k.k : undefined;
  if (Array.isArray(kk) && typeof kk[0] === "number") write(kk as number[]);
  else if (Array.isArray(kk)) for (const kf of kk as Node[]) if (Array.isArray(kf?.s)) write(kf.s as number[]);
}

/* ------------------------------------------------------------ transforms */

type Mat = [number, number, number, number, number, number];
const IDENTITY: Mat = [1, 0, 0, 1, 0, 0];
const mul = (a: Mat, b: Mat): Mat => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
const translate = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const scaleM = (x: number, y: number): Mat => [x, 0, 0, y, 0, 0];
const rotateM = (deg: number): Mat => {
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [c, s, -s, c, 0, 0];
};
export function invert(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}
export const applyMat = (m: Mat, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
export type { Mat };

/** A property's value at a frame: static, or linearly between keyframes (easing ignored — placement needs no more). */
export function valueAt(prop: unknown, frame: number): number[] | null {
  if (!isObj(prop)) return null;
  const k = prop.k;
  if (prop.a !== 1) return typeof k === "number" ? [k] : Array.isArray(k) && typeof k[0] === "number" ? (k as number[]) : null;
  const kfs = arr(k).filter((kf) => typeof kf.t === "number");
  if (!kfs.length) return null;
  const vec = (kf: Node): number[] | null => (Array.isArray(kf.s) ? (kf.s as number[]) : typeof kf.s === "number" ? [kf.s] : null);
  if (frame <= (kfs[0].t as number)) return vec(kfs[0]);
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    const ta = a.t as number, tb = b.t as number;
    if (frame >= ta && frame <= tb) {
      const va = vec(a), vb = vec(b) ?? (Array.isArray(a.e) ? (a.e as number[]) : null);
      if (!va) return null;
      if (!vb || a.h === 1 || tb === ta) return va;
      const f = (frame - ta) / (tb - ta);
      return va.map((v, j) => v + ((vb[j] ?? v) - v) * f);
    }
  }
  const last = kfs[kfs.length - 1];
  return vec(last) ?? (Array.isArray(kfs[kfs.length - 2]?.e) ? (kfs[kfs.length - 2].e as number[]) : null);
}

/** The matrix of a transform property set (a layer's `ks` or a group's `tr`) at a frame. */
function transformMat(t: Node | undefined, frame: number): Mat {
  if (!t) return IDENTITY;
  const a = valueAt(t.a, frame) ?? [0, 0];
  let p = valueAt(t.p, frame);
  if (!p && isObj(t.p) && (t.p as Node).s === true) p = [valueAt((t.p as Node).x, frame)?.[0] ?? 0, valueAt((t.p as Node).y, frame)?.[0] ?? 0];
  const pos = p ?? [0, 0];
  const s = valueAt(t.s, frame) ?? [100, 100];
  const r = valueAt(t.r, frame)?.[0] ?? 0;
  return mul(mul(mul(translate(pos[0] ?? 0, pos[1] ?? 0), rotateM(r)), scaleM((s[0] ?? 100) / 100, (s[1] ?? 100) / 100)), translate(-(a[0] ?? 0), -(a[1] ?? 0)));
}

/**
 * The matrix from a node's own coordinate space to the sticker's, at a frame: the layer's parents, the layer, then
 * each group down to (and including, for a group) the node's own transform. For a part's parent space pass `own: false`.
 */
export function matrixTo(doc: LottieJson, addr: Addr, frame: number, own = true): Mat {
  const layers = arr(doc.layers);
  const found = findNode(doc, addr);
  if (!found) return IDENTITY;
  let m = IDENTITY;
  // parents by `parent` (layer ind), outermost first
  const chain: Node[] = [];
  let layer: Node | undefined = found.layer;
  const seen = new Set<Node>();
  while (layer && !seen.has(layer)) {
    seen.add(layer);
    chain.unshift(layer);
    const pid: unknown = layer.parent;
    layer = typeof pid === "number" ? layers.find((l) => l.ind === pid) : undefined;
  }
  for (const l of chain) m = mul(m, transformMat(isObj(l.ks) ? l.ks : undefined, frame));
  const groups = found.groups;
  const upto = own ? groups.length : Math.max(0, groups.length - 1);
  for (let i = 0; i < upto; i++) m = mul(m, transformMat(arr(groups[i].it).find((x) => x.ty === "tr"), frame));
  return m;
}

/** A node by address in a document whose nodes carry addresses (or an original, by position): the layer and the groups down to it. */
export function findNode(doc: LottieJson, addr: Addr): { layer: Node; groups: Node[]; node: Node; parentItems: Node[] | null } | null {
  for (const layer of arr(doc.layers)) {
    const laddr = layer[ADDR_KEY] as Addr | undefined;
    if (addr === laddr) return { layer, groups: [], node: layer, parentItems: null };
    const walk = (items: Node[], groups: Node[]): ReturnType<typeof findNode> => {
      for (const it of items) {
        if (it.ty !== "gr") continue;
        const a = it[ADDR_KEY] as Addr | undefined;
        if (a === addr) return { layer, groups: [...groups, it], node: it, parentItems: items };
        for (const x of arr(it.it)) if (PAINT_TYPES[x.ty as string] && x[ADDR_KEY] === addr) return { layer, groups: [...groups, it], node: x, parentItems: arr(it.it) };
        const deeper = walk(arr(it.it), [...groups, it]);
        if (deeper) return deeper;
      }
      return null;
    };
    const r = walk(arr(layer.shapes), []);
    if (r) return r;
  }
  return null;
}

/** Add to a static or keyframed vector property. */
function offsetProp(t: Node, key: string, dx: number, dy: number) {
  const prop = isObj(t[key]) ? (t[key] as Node) : (t[key] = { a: 0, k: [0, 0] });
  if (prop.a === 1) {
    for (const kf of arr(prop.k)) {
      if (Array.isArray(kf.s)) {
        (kf.s as number[])[0] += dx;
        (kf.s as number[])[1] += dy;
      }
    }
  } else if (prop.s === true) {
    offsetProp(prop, "x", dx, 0);
    offsetProp(prop, "y", dy, 0);
  } else if (Array.isArray(prop.k)) {
    (prop.k as number[])[0] += dx;
    (prop.k as number[])[1] = ((prop.k as number[])[1] ?? 0) + dy;
  } else if (typeof prop.k === "number") prop.k += dx;
}
function mapProp(t: Node, key: string, fn: (v: number[]) => number[]) {
  const prop = isObj(t[key]) ? (t[key] as Node) : (t[key] = { a: 0, k: [0, 0] });
  if (prop.a === 1) {
    for (const kf of arr(prop.k)) if (Array.isArray(kf.s)) kf.s = fn(kf.s as number[]);
  } else if (Array.isArray(prop.k)) prop.k = fn(prop.k as number[]);
  else if (typeof prop.k === "number") prop.k = fn([prop.k])[0];
}
const transformOf = (node: Node): Node => {
  if (typeof node.ty === "number") return (node.ks = isObj(node.ks) ? node.ks : {}) as Node;
  const items = arr(node.it);
  let tr = items.find((x) => x.ty === "tr");
  if (!tr) {
    tr = { ty: "tr", p: { a: 0, k: [0, 0] }, a: { a: 0, k: [0, 0] }, s: { a: 0, k: [100, 100] }, r: { a: 0, k: 0 }, o: { a: 0, k: 100 } };
    items.push(tr);
    node.it = items;
  }
  return tr;
};

/* ------------------------------------------------------------ apply */

/**
 * The edited document: a copy of the original with every op applied in order (added and duplicated nodes resolved
 * by id), colours from `colors` on paints still showing their original colour, and every node tagged with its address.
 */
export function applyEdits(orig: LottieJson, edits: Edits): LottieJson {
  const doc = structuredClone(orig);
  const nodes = tagNodes(doc);
  const layers = arr(doc.layers);
  const fr = typeof doc.fr === "number" ? doc.fr : 60, ip = typeof doc.ip === "number" ? doc.ip : 0, outPoint = typeof doc.op === "number" ? doc.op : 60;
  const touched = new Set<Addr>();
  const resolve = (at: Addr) => nodes.get(at) ?? null;
  const ensureAddedLayer = (): Node => {
    const have = nodes.get(ADDED_LAYER);
    if (have) return have;
    const maxInd = layers.reduce((m, l) => Math.max(m, typeof l.ind === "number" ? l.ind : 0), 0);
    const layer: Node = { ddd: 0, ind: maxInd + 1, ty: 4, nm: "Added parts", sr: 1, ks: { o: { a: 0, k: 100 }, r: { a: 0, k: 0 }, p: { a: 0, k: [0, 0, 0] }, a: { a: 0, k: [0, 0, 0] }, s: { a: 0, k: [100, 100, 100] } }, ao: 0, shapes: [], ip, op: outPoint, st: 0, bm: 0, [ADDR_KEY]: ADDED_LAYER };
    layers.unshift(layer);
    doc.layers = layers;
    nodes.set(ADDED_LAYER, layer);
    return layer;
  };
  /** The list a node sits in and the node owning that list (null for the layers themselves). */
  const parentOf = (node: Node): { owner: Node | null; list: Node[] } | null => {
    if (typeof node.ty === "number") return { owner: null, list: layers };
    for (const [, cand] of nodes) {
      if (cand === node) continue;
      const items = typeof cand.ty === "number" ? arr(cand.shapes) : cand.ty === "gr" ? arr(cand.it) : [];
      if (items.includes(node)) return { owner: cand, list: items };
    }
    return null;
  };
  const containerOf = (node: Node): Node[] | null => parentOf(node)?.list ?? null;
  for (const raw of edits.ops.slice(0, MAX_OPS)) {
    const op = raw;
    if (op.t === "add") {
      const layer = ensureAddedLayer();
      const group = buildShape(op.shape, op.id, { fr, ip, op: outPoint });
      arr(layer.shapes).unshift(group);
      layer.shapes = arr(layer.shapes);
      nodes.set(op.id, group);
      arr(group.it).forEach((x, j) => {
        if (PAINT_TYPES[x.ty as string]) {
          x[ADDR_KEY] = `${op.id}#${j}`;
          nodes.set(`${op.id}#${j}`, x);
        }
      });
      continue;
    }
    const node = resolve(op.at);
    if (!node) continue;
    switch (op.t) {
      case "hide":
        node.hd = true;
        break;
      case "show":
        delete node.hd;
        break;
      case "name":
        node.nm = op.v;
        break;
      case "opacity": {
        const t = transformOf(node);
        t.o = { a: 0, k: Math.max(0, Math.min(100, op.v)) };
        break;
      }
      case "color":
        if (PAINT_TYPES[node.ty as string]) {
          writePaintColor(node, op.v, op.stop);
          touched.add(op.at);
        }
        break;
      case "width":
        if (node.ty === "st" || node.ty === "gs") node.w = { a: 0, k: Math.max(0, op.v) };
        break;
      case "move":
        offsetProp(transformOf(node), "p", op.dx, op.dy);
        break;
      case "scale": {
        const t = transformOf(node);
        const f = Math.max(0.01, op.f);
        mapProp(t, "s", (v) => v.map((x, i) => (i < 2 ? x * f : x)));
        if (op.cx !== undefined && op.cy !== undefined) mapProp(t, "p", (v) => [op.cx! - f * (op.cx! - v[0]), op.cy! - f * (op.cy! - (v[1] ?? 0)), ...v.slice(2)]);
        break;
      }
      case "rotate": {
        const t = transformOf(node);
        mapProp(t, "r", (v) => [(v[0] ?? 0) + op.deg]);
        if (op.cx !== undefined && op.cy !== undefined) {
          const m = rotateM(op.deg);
          mapProp(t, "p", (v) => {
            const [x, y] = applyMat(m, v[0] - op.cx!, (v[1] ?? 0) - op.cy!);
            return [x + op.cx!, y + op.cy!, ...v.slice(2)];
          });
        }
        break;
      }
      case "order": {
        // Among what is drawn beside it: a part that is alone in its group moves its group instead, and a group's
        // transform (always last) is never passed.
        let target = node;
        let at = parentOf(target);
        while (at && at.owner && typeof at.owner.ty !== "number" && at.list.filter((x) => x.ty !== "tr").length < 2) {
          target = at.owner;
          at = parentOf(target);
        }
        if (!at) break;
        const siblings = at.list.filter((x) => x.ty !== "tr");
        const i = siblings.indexOf(target), j = i + op.d;
        if (i < 0 || j < 0 || j >= siblings.length) break;
        const ii = at.list.indexOf(target), jj = at.list.indexOf(siblings[j]);
        [at.list[ii], at.list[jj]] = [at.list[jj], at.list[ii]];
        break;
      }
      case "dup": {
        const list = containerOf(node);
        if (!list) break;
        const copy = structuredClone(node) as Node;
        retag(copy, op.id, nodes);
        if (typeof copy.nm === "string") copy.nm = `${copy.nm} copy`;
        if (typeof copy.ty === "number") {
          const maxInd = layers.reduce((m, l) => Math.max(m, typeof l.ind === "number" ? l.ind : 0), 0);
          copy.ind = maxInd + 1;
        }
        list.splice(list.indexOf(node), 0, copy);
        break;
      }
    }
  }
  // The player honours the hidden flag on layers and paints but not on groups, so a hidden group's transform also
  // goes to opacity 0 (its children inherit it); the export prunes the group anyway.
  for (const [, node] of nodes) {
    if (node.ty === "gr" && node.hd === true) {
      const tr = transformOf(node);
      tr.o = { a: 0, k: 0 };
    }
  }
  // Palette colours: paints still showing their original colour take the mapped one; per-paint colours stay.
  if (Object.keys(edits.colors).length) {
    for (const [addr, node] of nodes) {
      if (!PAINT_TYPES[node.ty as string] || touched.has(addr)) continue;
      const kind = PAINT_TYPES[node.ty as string];
      if (kind === "fill" || kind === "stroke") {
        const k = isObj(node.c) ? node.c.k : undefined;
        const slots: number[][] = Array.isArray(k) && typeof k[0] === "number" ? [k as number[]] : arr(k).map((kf) => kf.s).filter((s): s is number[] => Array.isArray(s) && typeof s[0] === "number");
        for (const s of slots) {
          const to = edits.colors[toHex(s) ?? ""];
          if (to) {
            const rgb = hexToRgb(to);
            s[0] = rgb[0];
            s[1] = rgb[1];
            s[2] = rgb[2];
          }
        }
      } else {
        const g = isObj(node.g) ? node.g : null;
        const p = g && typeof g.p === "number" && g.p > 0 ? g.p : Infinity;
        const kk = g && isObj(g.k) ? g.k.k : undefined;
        const slots: number[][] = Array.isArray(kk) && typeof kk[0] === "number" ? [kk as number[]] : arr(kk).map((kf) => kf.s).filter((s): s is number[] => Array.isArray(s) && typeof s[0] === "number");
        for (const s of slots) {
          const n = Math.min(p, Math.floor(s.length / 4));
          for (let i = 0; i < n; i++) {
            const to = edits.colors[toHex(s, i * 4 + 1) ?? ""];
            if (to) {
              const rgb = hexToRgb(to);
              s[i * 4 + 1] = rgb[0];
              s[i * 4 + 2] = rgb[1];
              s[i * 4 + 3] = rgb[2];
            }
          }
        }
      }
    }
  }
  return doc;
}

/** Give a duplicated subtree fresh addresses under `id` ("A5", "A5/0", "A5#1" …) and register them. */
function retag(node: Node, id: Addr, nodes: Map<Addr, Node>) {
  node[ADDR_KEY] = id;
  nodes.set(id, node);
  const items = typeof node.ty === "number" ? arr(node.shapes) : arr(node.it);
  items.forEach((x, i) => {
    if (PAINT_TYPES[x.ty as string]) {
      x[ADDR_KEY] = `${id}#${i}`;
      nodes.set(`${id}#${i}`, x);
    } else if (x.ty === "gr") retag(x, `${id}/${i}`, nodes);
  });
}

/* ------------------------------------------------------------ shapes */

const kf = (t: number, s: number[], ease = true) => (ease ? { t, s, i: { x: s.map(() => 0.42), y: s.map(() => 1) }, o: { x: s.map(() => 0.58), y: s.map(() => 0) } } : { t, s, i: { x: s.map(() => 0.833), y: s.map(() => 0.833) }, o: { x: s.map(() => 0.167), y: s.map(() => 0.167) } });

/** The keyframes a motion preset puts on a new part's transform, sized to the sticker's length so the loop is seamless. */
export function motionKeyframes(motion: MotionKind, amount: number | undefined, at: { x: number; y: number }, time: { ip: number; op: number }): Partial<Record<"p" | "s" | "r" | "o", Node>> {
  const { ip, op } = time;
  const len = Math.max(1, op - ip);
  const mid = ip + len / 2, q = len / 4;
  switch (motion) {
    case "pulse": {
      const a = amount ?? 12;
      return { s: { a: 1, k: [kf(ip, [100, 100]), kf(mid, [100 + a, 100 + a]), { t: op, s: [100, 100] }] } };
    }
    case "bounce": {
      const a = amount ?? 40;
      return { p: { a: 1, k: [kf(ip, [at.x, at.y]), kf(mid, [at.x, at.y - a]), { t: op, s: [at.x, at.y] }] } };
    }
    case "spin":
      return { r: { a: 1, k: [kf(ip, [0], false), { t: op, s: [360] }] } };
    case "wiggle": {
      const a = amount ?? 8;
      return { r: { a: 1, k: [kf(ip, [0]), kf(ip + q, [a]), kf(mid, [0]), kf(ip + 3 * q, [-a]), { t: op, s: [0] }] } };
    }
    case "fade": {
      const a = amount ?? 70;
      return { o: { a: 1, k: [kf(ip, [100]), kf(mid, [Math.max(0, 100 - a)]), { t: op, s: [100] }] } };
    }
    case "slide": {
      const a = amount ?? 560;
      return { p: { a: 1, k: [kf(ip, [at.x - a, at.y]), { t: ip + Math.max(2, Math.round(len * 0.4)), s: [at.x, at.y] }] } };
    }
    default:
      return {};
  }
}

/** A drawn path as Lottie bezier data (vertices with in/out tangents relative to each vertex). */
export function pathData(points: { x: number; y: number }[], closed: boolean, smooth: boolean): Node {
  const n = points.length;
  const v = points.map((p) => [p.x, p.y]);
  const i: number[][] = [], o: number[][] = [];
  for (let k = 0; k < n; k++) {
    if (!smooth || n < 3) {
      i.push([0, 0]);
      o.push([0, 0]);
      continue;
    }
    // Catmull-Rom tangents: a sixth of the chord between the neighbours, clamped at open ends.
    const prev = points[closed ? (k - 1 + n) % n : Math.max(0, k - 1)], next = points[closed ? (k + 1) % n : Math.min(n - 1, k + 1)];
    const tx = (next.x - prev.x) / 6, ty = (next.y - prev.y) / 6;
    i.push([-tx, -ty]);
    o.push([tx, ty]);
  }
  return { a: 0, k: { i, o, v, c: closed } };
}

/** The shape group an add op makes: geometry, fill and/or stroke, and a transform carrying the motion. */
export function buildShape(shape: AddedShape, id: Addr, time: { fr: number; ip: number; op: number }): Node {
  const w = Math.max(1, shape.w), h = Math.max(1, shape.h);
  const geometry: Node = (() => {
    switch (shape.kind) {
      case "ellipse":
        return { ty: "el", nm: "Ellipse", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, d: 1 };
      case "rect":
        return { ty: "rc", nm: "Rectangle", p: { a: 0, k: [0, 0] }, s: { a: 0, k: [w, h] }, r: { a: 0, k: Math.max(0, Math.min(shape.r ?? 0, Math.min(w, h) / 2)) }, d: 1 };
      case "star":
      case "polygon": {
        const star = shape.kind === "star";
        const orad = Math.min(w, h) / 2;
        return { ty: "sr", nm: star ? "Star" : "Polygon", sy: star ? 1 : 2, pt: { a: 0, k: Math.max(3, Math.round(shape.points ?? (star ? 5 : 6))) }, p: { a: 0, k: [0, 0] }, r: { a: 0, k: 0 }, or: { a: 0, k: orad }, os: { a: 0, k: 0 }, ...(star ? { ir: { a: 0, k: orad * Math.max(0.1, Math.min(0.95, shape.inner ?? 0.5)) }, is: { a: 0, k: 0 } } : {}), d: 1 };
      }
      case "line":
        return { ty: "sh", nm: "Line", ks: pathData([{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }], false, false), d: 1 };
      case "path": {
        const pts = (shape.path ?? []).map((p) => ({ x: p.x - shape.x, y: p.y - shape.y }));
        return { ty: "sh", nm: "Path", ks: pathData(pts.length >= 2 ? pts : [{ x: -w / 2, y: 0 }, { x: w / 2, y: 0 }], shape.closed ?? pts.length > 2, shape.smooth ?? false), d: 1 };
      }
    }
  })();
  const items: Node[] = [geometry];
  const lineLike = shape.kind === "line" || (shape.kind === "path" && !(shape.closed ?? (shape.path?.length ?? 0) > 2));
  const fill = shape.fill === undefined ? (lineLike ? null : "#5ab3d6") : shape.fill;
  const stroke = shape.stroke === undefined ? (lineLike ? "#2b2b2b" : null) : shape.stroke;
  if (stroke) items.push({ ty: "st", nm: "Stroke", c: { a: 0, k: [...hexToRgb(stroke), 1] }, o: { a: 0, k: 100 }, w: { a: 0, k: Math.max(0.5, shape.width ?? 8) }, lc: 2, lj: 2, bm: 0 });
  if (fill) items.push({ ty: "fl", nm: "Fill", c: { a: 0, k: [...hexToRgb(fill), 1] }, o: { a: 0, k: 100 }, r: 1, bm: 0 });
  const motion = motionKeyframes(shape.motion ?? "none", shape.amount, { x: shape.x, y: shape.y }, time);
  items.push({ ty: "tr", nm: "Transform", p: motion.p ?? { a: 0, k: [shape.x, shape.y] }, a: { a: 0, k: [0, 0] }, s: motion.s ?? { a: 0, k: [100, 100] }, r: motion.r ?? { a: 0, k: 0 }, o: motion.o ?? { a: 0, k: 100 }, sk: { a: 0, k: 0 }, sa: { a: 0, k: 0 } });
  const names: Record<ShapeKind, string> = { ellipse: "Circle", rect: "Rectangle", star: "Star", polygon: "Polygon", line: "Line", path: "Path" };
  return { ty: "gr", nm: shape.name || names[shape.kind], bm: 0, it: items, [ADDR_KEY]: id };
}

/* ------------------------------------------------------------ picking */

/** The flat colour that stands for paint number `i` (1-based) in a picking render; blue is a marker so blends are told apart. (The renderer floors colour × 255, so the document carries each channel half a step up.) */
export const idColor = (i: number): [number, number, number] => [i & 255, (i >> 8) & 255, 85];
/** The paint index a rendered pixel stands for, or 0 when the pixel is a blend of two or transparent. */
export function idAtPixel(r: number, g: number, b: number, a: number): number {
  if (a < 250 || Math.abs(b - 85) > 2) return 0;
  return r + g * 256;
}

/**
 * A copy of an edited document in which every paint is a colour that names it — rendered once at a frame, a pixel
 * then says which paint drew it. The solid form makes every paint flat and fully opaque (gradients included) and
 * every opacity 100, so the topmost paint at a pixel is found whatever its transparency; the `alpha` form keeps each
 * paint's opacity and a gradient's alpha stops, so a pixel decodes only where that paint really covers it (a blend
 * decodes to nobody). Paints in `hide` draw nothing. Returns the document and the paints by index (index 0 unused);
 * the indices are the same in both forms.
 */
export function pickingDoc(doc: LottieJson, opts: { alpha?: boolean; hide?: Set<Addr> } = {}): { doc: LottieJson; paints: Addr[] } {
  const copy = structuredClone(doc);
  const paints: Addr[] = [""];
  const alpha = opts.alpha === true;
  const walk = (node: Node) => {
    if (typeof node.ty === "number") {
      if (!alpha && isObj(node.ks)) (node.ks as Node).o = { a: 0, k: 100 };
      node.bm = 0;
      delete node.tt;
    }
    const items = typeof node.ty === "number" ? arr(node.shapes) : arr(node.it);
    for (const it of items) {
      const kind = PAINT_TYPES[it.ty as string];
      if (kind) {
        const addr = (it[ADDR_KEY] as Addr) ?? `?${paints.length}`;
        const dropped = it.hd === true || !!opts.hide?.has(addr);
        // Every visible paint takes an id (the same in both forms); a hidden or dropped one draws nothing.
        const id = it.hd === true ? 0 : paints.push(addr) - 1;
        const [r, g, b] = idColor(id || 1).map((v) => (v + 0.5) / 255);
        const stroke = kind === "stroke" || kind === "gradientStroke";
        const gradient = kind === "gradient" || kind === "gradientStroke";
        if (dropped) {
          it.o = { a: 0, k: 0 };
          continue;
        }
        if (alpha && gradient) {
          // The gradient stays, its colour stops all the id, its alpha stops as they are.
          writePaintColor(it, "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join(""));
          it.bm = 0;
          continue;
        }
        const w = it.w, o = it.o;
        for (const key of Object.keys(it)) if (!["nm", ADDR_KEY, "hd"].includes(key)) delete it[key];
        it.ty = stroke ? "st" : "fl";
        it.c = { a: 0, k: [r, g, b, 1] };
        it.o = alpha && isObj(o) ? o : { a: 0, k: 100 };
        it.bm = 0;
        if (stroke) {
          it.w = w ?? { a: 0, k: 1 };
          it.lc = 2;
          it.lj = 2;
        } else it.r = 1;
      } else if (it.ty === "tr") {
        if (!alpha) it.o = { a: 0, k: 100 };
      } else if (it.ty === "gr") {
        it.bm = 0;
        walk(it);
      }
    }
  };
  for (const layer of arr(copy.layers)) walk(layer);
  return { doc: copy, paints };
}

/** A copy in which only the given paints keep their colour; every other paint is `dim`. */
export function highlightPaints(doc: LottieJson, keep: Set<Addr>, dim = "#9a9a9a"): LottieJson {
  const copy = structuredClone(doc);
  const walk = (items: Node[]) => {
    for (const it of items) {
      if (PAINT_TYPES[it.ty as string]) {
        if (!keep.has(it[ADDR_KEY] as Addr)) writePaintColor(it, dim);
      } else if (it.ty === "gr") walk(arr(it.it));
    }
  };
  for (const layer of arr(copy.layers)) walk(arr(layer.shapes));
  return copy;
}

/* ------------------------------------------------------------ export */

/** The document to export or share as a file: hidden parts and layers gone (a hidden layer another layer is parented to stays), addresses stripped. */
export function exportDoc(doc: LottieJson): LottieJson {
  const copy = structuredClone(doc);
  const layers = arr(copy.layers);
  const parents = new Set(layers.map((l) => l.parent).filter((p): p is number => typeof p === "number"));
  const kept = layers.filter((l) => !(l.hd === true && !parents.has(l.ind as number)));
  const prune = (items: Node[]): Node[] =>
    items
      .filter((it) => it.hd !== true)
      .map((it) => (it.ty === "gr" ? { ...it, it: prune(arr(it.it)) } : it))
      .filter((it) => it.ty !== "gr" || arr(it.it).some((x) => x.ty !== "tr"));
  for (const l of kept) if (Array.isArray(l.shapes)) l.shapes = prune(arr(l.shapes));
  copy.layers = kept;
  const strip = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(strip);
    else if (isObj(v)) {
      delete v[ADDR_KEY];
      Object.values(v).forEach(strip);
    }
  };
  strip(copy);
  return copy;
}

/* ------------------------------------------------------------ the palette */

export interface Swatch {
  /** The palette key: an original hex, or a paint's address for a separated paint. */
  key: string;
  /** What the swatch shows now. */
  hex: string;
  /** A separated gradient's stops (the swatch then edits one stop at a time). */
  stops: string[];
  paints: PaintInfo[];
  parts: PartInfo[];
  separated: boolean;
  gradientUses: number;
}

/**
 * The palette of an edited document: one swatch per original colour, holding the paints that still show it (as
 * mapped), and one per paint given a colour of its own. `separated` names those paints.
 */
export function paletteOf(layers: LayerInfo[], edits: Edits): Swatch[] {
  const separated = new Set(edits.ops.filter((o): o is Extract<Op, { t: "color" }> => o.t === "color").map((o) => o.at));
  const byHex = new Map<string, Swatch>();
  const own: Swatch[] = [];
  for (const layer of layers) {
    for (const part of layer.parts) {
      for (const paint of part.paints) {
        if (paint.hidden || part.hidden) continue;
        const gradient = paint.kind === "gradient" || paint.kind === "gradientStroke";
        if (separated.has(paint.addr) || paint.addr.startsWith("A")) {
          own.push({ key: paint.addr, hex: paint.hex ?? "#000000", stops: paint.stops, paints: [paint], parts: [part], separated: true, gradientUses: gradient ? 1 : 0 });
          continue;
        }
        const origs = gradient ? paint.origStops : paint.origHex ? [paint.origHex] : [];
        origs.forEach((orig, i) => {
          const sw = byHex.get(orig) ?? { key: orig, hex: edits.colors[orig] ?? orig, stops: [], paints: [], parts: [], separated: false, gradientUses: 0 };
          if (!sw.paints.includes(paint)) sw.paints.push(paint);
          if (!sw.parts.includes(part)) sw.parts.push(part);
          if (gradient && i === 0) sw.gradientUses++;
          byHex.set(orig, sw);
        });
      }
    }
  }
  return [...[...byHex.values()].sort((a, b) => b.paints.length - a.paints.length), ...own];
}

/* ------------------------------------------------------------ links */

const HEX = /^#[0-9a-f]{6}$/i;
const ADDR = /^(L\d+(\/\d+)*(#\d+)?|A\d+((\/\d+)*(#\d+)?)?)$/;
const num = (v: unknown, lo: number, hi: number): number | null => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** The ops of a link made whole: unknown kinds, bad addresses and wild numbers dropped; at most MAX_OPS. */
export function parseOps(input: unknown): Op[] {
  if (!Array.isArray(input)) return [];
  const out: Op[] = [];
  for (const raw of input.slice(0, MAX_OPS)) {
    if (!isObj(raw) || typeof raw.t !== "string") continue;
    const at = typeof raw.at === "string" && ADDR.test(raw.at) ? raw.at : null;
    switch (raw.t) {
      case "hide":
      case "show":
        if (at) out.push({ t: raw.t, at });
        break;
      case "name":
        if (at && typeof raw.v === "string") out.push({ t: "name", at, v: raw.v.slice(0, 80) });
        break;
      case "opacity": {
        const v = num(raw.v, 0, 100);
        if (at && v !== null) out.push({ t: "opacity", at, v });
        break;
      }
      case "color":
        if (at && typeof raw.v === "string" && HEX.test(raw.v)) out.push({ t: "color", at, v: raw.v.toLowerCase(), ...(num(raw.stop, 0, 64) !== null ? { stop: raw.stop as number } : {}) });
        break;
      case "width": {
        const v = num(raw.v, 0, 512);
        if (at && v !== null) out.push({ t: "width", at, v });
        break;
      }
      case "move": {
        const dx = num(raw.dx, -1e5, 1e5), dy = num(raw.dy, -1e5, 1e5);
        if (at && dx !== null && dy !== null) out.push({ t: "move", at, dx, dy });
        break;
      }
      case "scale": {
        const f = num(raw.f, 0.01, 100);
        if (at && f !== null) out.push({ t: "scale", at, f, ...(num(raw.cx, -1e5, 1e5) !== null && num(raw.cy, -1e5, 1e5) !== null ? { cx: raw.cx as number, cy: raw.cy as number } : {}) });
        break;
      }
      case "rotate": {
        const deg = num(raw.deg, -36000, 36000);
        if (at && deg !== null) out.push({ t: "rotate", at, deg, ...(num(raw.cx, -1e5, 1e5) !== null && num(raw.cy, -1e5, 1e5) !== null ? { cx: raw.cx as number, cy: raw.cy as number } : {}) });
        break;
      }
      case "order":
        if (at && (raw.d === -1 || raw.d === 1)) out.push({ t: "order", at, d: raw.d });
        break;
      case "dup":
        if (at && typeof raw.id === "string" && /^A\d+$/.test(raw.id)) out.push({ t: "dup", at, id: raw.id });
        break;
      case "add": {
        const s = raw.shape;
        if (typeof raw.id !== "string" || !/^A\d+$/.test(raw.id) || !isObj(s)) break;
        const kind = ["ellipse", "rect", "star", "polygon", "line", "path"].includes(s.kind as string) ? (s.kind as ShapeKind) : null;
        const x = num(s.x, -1e5, 1e5), y = num(s.y, -1e5, 1e5), w = num(s.w, 0, 1e5), h = num(s.h, 0, 1e5);
        if (!kind || x === null || y === null || w === null || h === null) break;
        const shape: AddedShape = { kind, x, y, w, h };
        if (typeof s.name === "string") shape.name = s.name.slice(0, 80);
        if (num(s.r, 0, 1e5) !== null) shape.r = s.r as number;
        if (num(s.points, 3, 100) !== null) shape.points = s.points as number;
        if (num(s.inner, 0.05, 1) !== null) shape.inner = s.inner as number;
        if (Array.isArray(s.path)) shape.path = s.path.filter((p): p is { x: number; y: number } => isObj(p) && num(p.x, -1e5, 1e5) !== null && num(p.y, -1e5, 1e5) !== null).slice(0, 2000).map((p) => ({ x: p.x, y: p.y }));
        if (typeof s.closed === "boolean") shape.closed = s.closed;
        if (typeof s.smooth === "boolean") shape.smooth = s.smooth;
        if (s.fill === null || (typeof s.fill === "string" && HEX.test(s.fill))) shape.fill = s.fill === null ? null : (s.fill as string).toLowerCase();
        if (s.stroke === null || (typeof s.stroke === "string" && HEX.test(s.stroke))) shape.stroke = s.stroke === null ? null : (s.stroke as string).toLowerCase();
        if (num(s.width, 0, 512) !== null) shape.width = s.width as number;
        if (MOTIONS.some((m) => m.id === s.motion)) shape.motion = s.motion as MotionKind;
        if (num(s.amount, -1e4, 1e4) !== null) shape.amount = s.amount as number;
        out.push({ t: "add", id: raw.id, shape });
        break;
      }
    }
  }
  return out;
}

/** Consecutive moves, scales and rotations of one node fold into one op, so a drag leaves a single step. */
export function coalesce(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const op of ops) {
    const last = out[out.length - 1];
    if (last && last.t === op.t && "at" in last && "at" in op && last.at === op.at) {
      if (op.t === "move" && last.t === "move") {
        out[out.length - 1] = { ...last, dx: last.dx + op.dx, dy: last.dy + op.dy };
        continue;
      }
      if (op.t === "scale" && last.t === "scale" && last.cx === op.cx && last.cy === op.cy) {
        out[out.length - 1] = { ...last, f: last.f * op.f };
        continue;
      }
      if (op.t === "rotate" && last.t === "rotate" && last.cx === op.cx && last.cy === op.cy) {
        out[out.length - 1] = { ...last, deg: last.deg + op.deg };
        continue;
      }
      if ((op.t === "opacity" || op.t === "width" || op.t === "name") && last.t === op.t) {
        out[out.length - 1] = op;
        continue;
      }
      if (op.t === "color" && last.t === "color" && last.stop === op.stop) {
        out[out.length - 1] = op;
        continue;
      }
    }
    out.push(op);
  }
  return out;
}
