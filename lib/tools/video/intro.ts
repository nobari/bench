/**
 * The intro: a handful of short scenes lifted from the drive itself, cut together in one of ten
 * looks and ended on a title card — the cold open YouTube videos put before the content.
 *
 * Scenes are ordinary clips at the head of the timeline tagged with introRole, so the preview,
 * timeline, transitions, audio mix and export all treat them as footage. The look is applied
 * at render time: a grade adjustment folded into the clip's own grade, then post effects drawn
 * over the finished frame (zoom, bars, vignette, grain, flash, glitch, the title card).
 */

import { clipLength, clipSpeed, fontFamilyCss, newId, placeClips, type Clip, type Grade, type PlacedClip, type Project, type Transition } from "./project";

export type IntroStyleId = "teaser" | "cinematic" | "punch" | "mono" | "pop" | "retro" | "glitch" | "spotlight" | "hyper" | "clean";

/** Post effects drawn over the graded frame; every value is a strength, 0 or missing means off. */
export interface IntroFx {
  /** Black bars top and bottom, as a fraction of the height each. */
  letterbox?: number;
  /** Zoom gained across each scene (0.08 = ends 8 % closer). */
  pushIn?: number;
  /** Extra zoom at the start of each scene that settles within 0.35 s. */
  punch?: number;
  /** A white flash at each cut, fading over this many seconds. */
  flash?: number;
  /** Film grain opacity. */
  grain?: number;
  /** Darkened corners, 0…1. */
  vignette?: number;
  /** RGB split and sliced jitter at each cut, for this many seconds. */
  glitch?: number;
  /** Fade from black at the very start, seconds. */
  fadeIn?: number;
}

/** Added to (exposure, temperature, tint) or multiplied into (contrast, saturation) the clip's grade. */
export interface IntroLook {
  exposure: number;
  temperature: number;
  tint: number;
  contrast: number;
  saturation: number;
}

export interface IntroStyle {
  id: IntroStyleId;
  name: string;
  hint: string;
  /** Timeline seconds per scene. */
  sceneSeconds: number;
  /** Scene playback speed (8 = time-lapse). */
  speed: number;
  /** Between scenes; null is a hard cut. */
  transition: Transition | null;
  /** From the intro into the drive. */
  outro: Transition;
  look: IntroLook;
  fx: IntroFx;
}

const LOOK: IntroLook = { exposure: 0, temperature: 0, tint: 0, contrast: 1, saturation: 1 };

export const INTRO_STYLES: IntroStyle[] = [
  { id: "teaser", name: "Teaser cuts", hint: "Fast hard cuts with a white flash on every cut and a touch of push-in.", sceneSeconds: 0.8, speed: 1, transition: null, outro: { kind: "dipWhite", duration: 0.4 }, look: { ...LOOK, contrast: 1.1, saturation: 1.15 }, fx: { flash: 0.12, pushIn: 0.06, fadeIn: 0.3 } },
  { id: "cinematic", name: "Cinematic", hint: "Letterbox bars, a slow push-in, a warm soft grade and cross dissolves.", sceneSeconds: 1.6, speed: 1, transition: { kind: "dissolve", duration: 0.7 }, outro: { kind: "dipBlack", duration: 0.8 }, look: { ...LOOK, temperature: 15, contrast: 1.05, saturation: 0.9 }, fx: { letterbox: 0.12, pushIn: 0.08, fadeIn: 0.8 } },
  { id: "punch", name: "Punch zoom", hint: "Each scene lands with a punch zoom that settles; hard cuts, crisp colour.", sceneSeconds: 1, speed: 1, transition: null, outro: { kind: "dipBlack", duration: 0.5 }, look: { ...LOOK, contrast: 1.15, saturation: 1.2 }, fx: { punch: 0.25, fadeIn: 0.2 } },
  { id: "mono", name: "Mono", hint: "High-contrast black and white with a vignette and a little grain.", sceneSeconds: 1.4, speed: 1, transition: { kind: "dissolve", duration: 0.5 }, outro: { kind: "dipBlack", duration: 0.6 }, look: { ...LOOK, exposure: 0.1, contrast: 1.35, saturation: 0 }, fx: { vignette: 0.5, grain: 0.06, fadeIn: 0.6 } },
  { id: "pop", name: "Colour pop", hint: "Vivid saturation and punchy contrast; hard cuts with a short flash.", sceneSeconds: 1, speed: 1, transition: null, outro: { kind: "dipWhite", duration: 0.4 }, look: { ...LOOK, contrast: 1.2, saturation: 1.55 }, fx: { flash: 0.08, pushIn: 0.05, fadeIn: 0.3 } },
  { id: "retro", name: "Retro film", hint: "Grain, faded blacks, a warm tint and a soft vignette; dissolves.", sceneSeconds: 1.5, speed: 1, transition: { kind: "dissolve", duration: 0.6 }, outro: { kind: "dipBlack", duration: 0.8 }, look: { ...LOOK, exposure: 0.05, temperature: 20, contrast: 0.85, saturation: 0.85 }, fx: { grain: 0.14, vignette: 0.35, fadeIn: 0.8 } },
  { id: "glitch", name: "Glitch", hint: "RGB split and sliced jitter at every cut; hard cuts.", sceneSeconds: 0.9, speed: 1, transition: null, outro: { kind: "dipBlack", duration: 0.4 }, look: { ...LOOK, contrast: 1.1, saturation: 0.9 }, fx: { glitch: 0.35, fadeIn: 0.1 } },
  { id: "spotlight", name: "Spotlight", hint: "A dark vignette closes in around the centre with a slow zoom; soft dissolves.", sceneSeconds: 1.5, speed: 1, transition: { kind: "dissolve", duration: 0.8 }, outro: { kind: "dipBlack", duration: 0.8 }, look: { ...LOOK, exposure: -0.1, contrast: 1.1 }, fx: { vignette: 0.85, pushIn: 0.12, fadeIn: 1 } },
  { id: "hyper", name: "Hyper-lapse", hint: "Scenes race by at 8× with a speed blur at the cuts.", sceneSeconds: 1.5, speed: 8, transition: { kind: "blur", duration: 0.4 }, outro: { kind: "blur", duration: 0.6 }, look: { ...LOOK, contrast: 1.05, saturation: 1.1 }, fx: { pushIn: 0.04, fadeIn: 0.4 } },
  { id: "clean", name: "Clean", hint: "No effects: the scenes as they are, a dip to black between them, then the title.", sceneSeconds: 1.4, speed: 1, transition: { kind: "dipBlack", duration: 0.5 }, outro: { kind: "dipBlack", duration: 0.6 }, look: { ...LOOK }, fx: { fadeIn: 0.5 } },
];

export const DEFAULT_INTRO_STYLE: IntroStyleId = "cinematic";

export function introStyle(id: string): IntroStyle {
  return INTRO_STYLES.find((s) => s.id === id) ?? INTRO_STYLES.find((s) => s.id === DEFAULT_INTRO_STYLE)!;
}

/** Seconds per new scene: the project's choice, else the style's own. */
export const sceneSecondsFor = (p: Project) => p.intro.sceneSeconds ?? introStyle(p.intro.style).sceneSeconds;

/* ----------------------------------------------------------------- region */

export interface IntroRegion {
  scenes: PlacedClip[];
  card: PlacedClip | null;
  /** Timeline end of the intro (the main content starts here). */
  end: number;
}

/** The intro is the run of tagged clips at the head of the timeline; tagged clips elsewhere are just footage. */
export function introRegion(placed: PlacedClip[]): IntroRegion | null {
  const scenes: PlacedClip[] = [];
  let card: PlacedClip | null = null;
  for (const c of placed) {
    if (c.introRole === "scene" && !card) scenes.push(c);
    else if (c.introRole === "card" && !card) card = c;
    else break;
  }
  if (!scenes.length && !card) return null;
  const last = card ?? scenes[scenes.length - 1];
  return { scenes, card, end: last.end };
}

export const hasIntro = (clips: Clip[]) => !!clips.length && !!clips[0].introRole;

/** Timeline length of the intro (0 without one). */
export function introLength(clips: Clip[]): number {
  return introRegion(placeClips(clips))?.end ?? 0;
}

/** Everything after the intro. */
export function mainClips(placed: PlacedClip[]): PlacedClip[] {
  const region = introRegion(placed);
  const n = region ? region.scenes.length + (region.card ? 1 : 0) : 0;
  return placed.slice(n);
}

/* ------------------------------------------------------------- rendering */

/** What the intro is doing at one timeline instant. */
export interface IntroFrame {
  style: IntroStyle;
  role: "scene" | "card";
  /** Scene number (0-based); the card counts as `count`. */
  index: number;
  count: number;
  /** Seconds into this scene or card, and its length. */
  local: number;
  length: number;
  /** Seconds into the intro, and its length. */
  introT: number;
  introLength: number;
}

export function introFrameAt(project: Project, placed: PlacedClip[], t: number): IntroFrame | null {
  const region = introRegion(placed);
  if (!region || t >= region.end || t < 0) return null;
  const all = region.card ? [...region.scenes, region.card] : region.scenes;
  const clip = all.find((c) => t >= c.start && t < c.end) ?? all[all.length - 1];
  const index = clip.introRole === "card" ? region.scenes.length : region.scenes.indexOf(clip);
  return { style: introStyle(project.intro.style), role: clip.introRole === "card" ? "card" : "scene", index, count: region.scenes.length, local: t - clip.start, length: clip.end - clip.start, introT: t, introLength: region.end };
}

/** The clip's grade with the style's look folded in. */
export function styledGrade(grade: Grade, style: IntroStyle): Grade {
  const l = style.look;
  const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
  return { ...grade, exposure: clamp(grade.exposure + l.exposure, -3, 3), temperature: clamp(grade.temperature + l.temperature, -100, 100), tint: clamp(grade.tint + l.tint, -100, 100), contrast: clamp(grade.contrast * l.contrast, 0, 2.5), saturation: clamp(grade.saturation * l.saturation, 0, 2.5) };
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type Canvas = OffscreenCanvas | HTMLCanvasElement;

const ease = (p: number) => {
  const x = Math.min(1, Math.max(0, p));
  return x * x * (3 - 2 * x);
};

/** Deterministic noise so the preview, Save frame and the export draw the same frame. */
const hash = (n: number) => {
  let x = Math.imul(n | 0, 374761393) + 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

let grainTile: Canvas | null = null;
function grainPattern(ctx: Ctx): CanvasPattern | null {
  if (!grainTile) {
    const n = 192;
    let tile: Canvas;
    if (typeof OffscreenCanvas !== "undefined") tile = new OffscreenCanvas(n, n);
    else {
      const c = document.createElement("canvas");
      c.width = c.height = n;
      tile = c;
    }
    const tc = tile.getContext("2d") as Ctx;
    const img = tc.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = 96 + Math.floor(hash(i * 7 + 1) * 64);
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    tc.putImageData(img, 0, 0);
    grainTile = tile;
  }
  return ctx.createPattern(grainTile as CanvasImageSource, "repeat");
}

/** Multiply a canvas by one colour in place (keeps that channel). */
function keepChannel(c: Canvas, w: number, h: number, colour: string) {
  const cc = c.getContext("2d") as Ctx;
  cc.save();
  cc.globalCompositeOperation = "multiply";
  cc.fillStyle = colour;
  cc.fillRect(0, 0, w, h);
  cc.restore();
}

/**
 * Draw the style's post effects over the frame already in `ctx` (graded, through any transition). The two scratch
 * canvases must match the frame size; they are used for zoom, glitch and the card's blur.
 */
export function drawIntroFx(ctx: Ctx, w: number, h: number, f: IntroFrame, project: Project, scratch: { a: Canvas; b: Canvas }) {
  const { fx } = f.style;
  const frameNo = Math.floor(f.introT * 60);
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.filter = "none";
  // zoom: push-in across the scene, a punch that settles at its start
  let zoom = 1;
  if (fx.pushIn) zoom *= 1 + fx.pushIn * ease(f.local / Math.max(0.01, f.length));
  if (fx.punch && f.role === "scene") zoom *= 1 + fx.punch * Math.max(0, 1 - f.local / 0.35) ** 2;
  const glitch = fx.glitch && f.role === "scene" && f.local < fx.glitch ? 1 - f.local / fx.glitch : 0;
  const blur = f.role === "card" ? Math.min(h * 0.006, 24) * ease(f.local / 0.6) : 0;
  if (zoom !== 1 || glitch > 0 || blur > 0.3) {
    const a = scratch.a.getContext("2d") as Ctx;
    a.save();
    a.globalCompositeOperation = "source-over";
    a.globalAlpha = 1;
    a.filter = "none";
    a.clearRect(0, 0, w, h);
    a.drawImage(ctx.canvas, 0, 0, w, h);
    a.restore();
    const dw = w * zoom, dh = h * zoom, dx = (w - dw) / 2, dy = (h - dh) / 2;
    if (glitch > 0) {
      // RGB split: green stays, red and blue slide apart; then a few horizontal slices jump sideways.
      const shift = w * 0.014 * glitch * (0.5 + hash(frameNo * 3 + 1));
      ctx.drawImage(scratch.a, dx, dy, dw, dh);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(0, 0, w, h);
      const b = scratch.b.getContext("2d") as Ctx;
      b.clearRect(0, 0, w, h);
      b.drawImage(scratch.a, 0, 0, w, h);
      keepChannel(scratch.b, w, h, "#ff0000");
      ctx.globalCompositeOperation = "lighter";
      ctx.drawImage(scratch.b, dx + shift, dy, dw, dh);
      b.clearRect(0, 0, w, h);
      b.drawImage(scratch.a, 0, 0, w, h);
      keepChannel(scratch.b, w, h, "#0000ff");
      ctx.drawImage(scratch.b, dx - shift, dy, dw, dh);
      ctx.globalCompositeOperation = "source-over";
      const slices = 2 + Math.round(glitch * 5);
      for (let k = 0; k < slices; k++) {
        const y = Math.floor(hash(frameNo * 11 + k * 3) * h), bh = Math.max(2, Math.floor(h * (0.02 + 0.06 * hash(frameNo * 13 + k * 5))));
        const off = (hash(frameNo * 17 + k * 7) - 0.5) * w * 0.08 * glitch;
        ctx.drawImage(scratch.a, 0, y, w, bh, off, y, w, bh);
      }
    } else {
      if (blur > 0.3) ctx.filter = `blur(${blur.toFixed(1)}px)`;
      ctx.drawImage(scratch.a, dx, dy, dw, dh);
      ctx.filter = "none";
    }
  }
  // the card: dim the footage and set the title on it
  if (f.role === "card") {
    const fade = ease(f.local / 0.5);
    ctx.fillStyle = `rgba(0,0,0,${(0.55 * fade).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
    const text = project.intro.card.text.trim() || project.name;
    const sub = project.intro.card.subtitle.trim();
    const px = Math.round(h * 0.1), subPx = Math.round(h * 0.042);
    const rise = (1 - fade) * h * 0.025;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = px * 0.25;
    ctx.shadowOffsetY = px * 0.04;
    const c = ctx as Ctx & { letterSpacing?: string };
    if ("letterSpacing" in c) c.letterSpacing = "0.02em";
    ctx.globalAlpha = fade;
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${px}px ${fontFamilyCss("sans")}`;
    const cy = sub ? h / 2 - subPx * 0.9 : h / 2;
    ctx.fillText(text, w / 2, cy + rise);
    if (sub) {
      ctx.globalAlpha = fade * 0.85;
      ctx.font = `400 ${subPx}px ${fontFamilyCss("sans")}`;
      if ("letterSpacing" in c) c.letterSpacing = "0.12em";
      ctx.fillText(sub.toUpperCase(), w / 2, cy + px * 0.85 + rise);
    }
    if ("letterSpacing" in c) c.letterSpacing = "0px";
    ctx.shadowColor = "transparent";
    ctx.globalAlpha = 1;
  }
  if (fx.vignette) {
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) / 2);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${fx.vignette})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.grain) {
    const pat = grainPattern(ctx);
    if (pat) {
      const s = Math.max(1, h / 1080);
      ctx.save();
      ctx.globalCompositeOperation = "overlay";
      ctx.globalAlpha = fx.grain;
      ctx.translate(Math.floor(hash(frameNo * 5 + 2) * 192 * s), Math.floor(hash(frameNo * 5 + 3) * 192 * s));
      ctx.scale(s, s);
      ctx.fillStyle = pat;
      ctx.fillRect(-192 * 2, -192 * 2, w / s + 192 * 4, h / s + 192 * 4);
      ctx.restore();
    }
  }
  if (fx.letterbox) {
    const bar = Math.round(h * fx.letterbox);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, bar);
    ctx.fillRect(0, h - bar, w, bar);
  }
  if (fx.flash && f.role === "scene" && f.index > 0 && f.local < fx.flash) {
    ctx.fillStyle = `rgba(255,255,255,${((1 - f.local / fx.flash) ** 2).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  if (fx.fadeIn && f.introT < fx.fadeIn) {
    ctx.fillStyle = `rgba(0,0,0,${(1 - f.introT / fx.fadeIn).toFixed(3)})`;
    ctx.fillRect(0, 0, w, h);
  }
  ctx.restore();
}

/* ------------------------------------------------------------- picking */

export interface Moment {
  clipId: string;
  /** Where in the source the scene is centred on. */
  sourceTime: number;
  /** Where on the timeline that is (for the UI and for ordering). */
  timelineT: number;
  /** Liveliness from the scan (motion and contrast), when one ran. */
  score?: number;
}

/**
 * Candidate instants for the scenes: `count` equal windows across the main content, skipping `margin` of it at
 * each end (the parking lot and the arrival), with `perWindow` instants spread inside each window. Each instant
 * needs `needSeconds` of footage around it within its clip, else it slides to where there is.
 */
export function introCandidates(main: PlacedClip[], count: number, perWindow: number, needSeconds: number, margin = 0.06): Moment[][] {
  if (!main.length || count < 1 || perWindow < 1) return [];
  const t0 = main[0].start, t1 = main[main.length - 1].end, len = t1 - t0;
  if (len <= 0) return [];
  const a = t0 + len * margin, span = len * (1 - 2 * margin);
  const wlen = span / count;
  const out: Moment[][] = [];
  for (let i = 0; i < count; i++) {
    const window: Moment[] = [];
    for (let j = 0; j < perWindow; j++) {
      const t = a + wlen * (i + (j + 0.5) / perWindow);
      const clip = main.find((c) => t >= c.start && t < c.end) ?? main[main.length - 1];
      const speed = clipSpeed(clip);
      const lead = needSeconds * speed * 0.3, tail = needSeconds * speed - lead;
      let src = clip.in + (t - clip.start) * speed;
      src = Math.min(src, clip.out - tail);
      src = Math.max(src, clip.in + lead);
      if (src < clip.in) src = clip.in;
      if (src > clip.out) src = clip.out;
      window.push({ clipId: clip.id, sourceTime: src, timelineT: clip.start + (src - clip.in) / speed });
    }
    out.push(window);
  }
  return out;
}

/** One moment per window: the liveliest when scores are known, else the middle one. */
export function pickMoments(windows: Moment[][]): Moment[] {
  return windows
    .filter((w) => w.length)
    .map((w) => {
      if (w.every((m) => typeof m.score === "number")) return w.reduce((best, m) => (m.score! > best.score! ? m : best), w[0]);
      return w[Math.floor(w.length / 2)];
    });
}

/** Liveliness: motion between two frames a beat apart, and contrast within the frame, each normalised over the whole set. */
export function scoreMoments(windows: Moment[][], stats: Map<Moment, { motion: number; contrast: number }>): Moment[][] {
  const all = windows.flat();
  const maxM = Math.max(1e-6, ...all.map((m) => stats.get(m)?.motion ?? 0)), maxC = Math.max(1e-6, ...all.map((m) => stats.get(m)?.contrast ?? 0));
  return windows.map((w) =>
    w.map((m) => {
      const s = stats.get(m);
      return s ? { ...m, score: 0.6 * (s.motion / maxM) + 0.4 * (s.contrast / maxC) } : m;
    }),
  );
}

/* ------------------------------------------------------------- building */

const strip = (c: PlacedClip | Clip): Clip => {
  const { start, end, index, ...rest } = c as PlacedClip;
  void start;
  void end;
  void index;
  return rest;
};

/** A scene clip lifted from `source` around `sourceTime`, `seconds` long on the timeline at the style's speed. */
function sceneClip(project: Project, source: Clip, sourceTime: number, seconds: number, style: IntroStyle): Clip {
  const media = project.media[source.media];
  const need = seconds * style.speed;
  const lead = need * 0.3;
  const lo = Math.max(0, source.in), hi = Math.min(media?.duration ?? source.out, source.out);
  let start = sourceTime - lead;
  if (start + need > hi) start = hi - need;
  if (start < lo) start = lo;
  const out = Math.min(hi, start + need);
  const clip: Clip = { id: newId(), media: source.media, in: start, out, transform: { ...source.transform, crop: { ...source.transform.crop } }, grade: { ...source.grade }, gainDb: source.gainDb, muted: !project.intro.keepAudio, introRole: "scene", introSeconds: seconds };
  if (style.speed !== 1) clip.speed = style.speed;
  return clip;
}

/** The title card: the last scene's footage carrying on at 1× under the dimmed title. */
function cardClip(project: Project, after: Clip, seconds: number, id = newId()): Clip {
  const media = project.media[after.media];
  const hi = media?.duration ?? after.out;
  let start = after.out;
  if (start + seconds > hi) start = Math.max(0, hi - seconds);
  return { id, media: after.media, in: start, out: Math.min(hi, start + seconds), transform: { ...after.transform, crop: { ...after.transform.crop } }, grade: { ...after.grade }, gainDb: after.gainDb, muted: !project.intro.keepAudio, introRole: "card" };
}

/**
 * Every intro edit ends here: the scenes get the style's speed (keeping their timeline length) and transitions,
 * the card is rebuilt to carry on from the last scene at the settings' length (keeping its id), and the first
 * clip of the drive gets the outro cut. Without scenes there is no intro at all.
 */
function stampStyle(scenes: Clip[], main: Clip[], project: Project, cardId?: string): Clip[] {
  const style = introStyle(project.intro.style);
  const restyled = scenes
    .filter((c) => c.introRole === "scene")
    .map((c, i) => {
      // The scene keeps its intended timeline length at the style's speed; when the footage runs out it slides back (and is shorter).
      const need = (c.introSeconds ?? clipLength(c)) * style.speed;
      const hi = project.media[c.media]?.duration ?? c.out;
      let start = c.in;
      if (start + need > hi) start = Math.max(0, hi - need);
      const next: Clip = { ...c, in: start, out: Math.min(hi, start + need), muted: !project.intro.keepAudio };
      delete next.speed;
      if (style.speed !== 1) next.speed = style.speed;
      delete next.transitionIn;
      delete next.joinedToPrevious;
      if (i > 0 && style.transition) next.transitionIn = { ...style.transition };
      return next;
    });
  const mainOut = main.map((c) => ({ ...c }));
  if (!restyled.length) {
    if (mainOut[0]) delete mainOut[0].transitionIn;
    return mainOut;
  }
  const cards: Clip[] = [];
  if (project.intro.card.seconds > 0) {
    const card = cardClip(project, restyled[restyled.length - 1], project.intro.card.seconds, cardId);
    if (style.transition) card.transitionIn = { ...style.transition };
    cards.push(card);
  }
  if (mainOut[0]) {
    delete mainOut[0].joinedToPrevious;
    mainOut[0].transitionIn = { ...style.outro };
  }
  return [...restyled, ...cards, ...mainOut];
}

/** The intro's scenes, the drive, and the card's id (so a rebuilt card keeps its thumbnail and key). */
function parts(project: Project): { scenes: Clip[]; main: Clip[]; cardId?: string } {
  const placed = placeClips(project.clips);
  const region = introRegion(placed);
  return { scenes: region?.scenes.map(strip) ?? [], main: mainClips(placed).map(strip), cardId: region?.card?.id };
}

/** Scenes at the chosen moments (in timeline order), the card, then the drive — replacing any intro already there. */
export function buildIntro(project: Project, moments: Moment[], sceneSeconds = sceneSecondsFor(project)): Clip[] {
  const style = introStyle(project.intro.style);
  const { main, cardId } = parts(project);
  const ordered = [...moments].sort((a, b) => a.timelineT - b.timelineT);
  const scenes: Clip[] = [];
  for (const m of ordered) {
    const source = main.find((c) => c.id === m.clipId);
    if (!source) continue;
    scenes.push(sceneClip(project, source, m.sourceTime, sceneSeconds, style));
  }
  return stampStyle(scenes, main, project, cardId);
}

/** Re-stamp the current style (after the style, card or audio setting changed). */
export function restyleIntro(project: Project): Clip[] {
  const { scenes, main, cardId } = parts(project);
  if (!scenes.length) return project.clips;
  return stampStyle(scenes, main, project, cardId);
}

/** Add a scene taken from the drive at a timeline instant (inside the main content) to the end of the intro. */
export function addSceneAt(project: Project, t: number, sceneSeconds = sceneSecondsFor(project)): Clip[] | null {
  const placed = placeClips(project.clips);
  const under = mainClips(placed).find((c) => t >= c.start && t < c.end);
  if (!under) return null;
  const { scenes, main, cardId } = parts(project);
  const scene = sceneClip(project, strip(under), under.in + (t - under.start) * clipSpeed(under), sceneSeconds, introStyle(project.intro.style));
  return stampStyle([...scenes, scene], main, project, cardId);
}

/** Drop the intro; the drive starts the file again. */
export function removeIntro(clips: Clip[]): Clip[] {
  const main = mainClips(placeClips(clips)).map(strip);
  if (main[0]) {
    const first = { ...main[0] };
    delete first.transitionIn;
    main[0] = first;
  }
  return main;
}

/** Remove one scene from the intro (the last one takes the intro with it). */
export function removeScene(project: Project, clipId: string): Clip[] {
  const { scenes, main, cardId } = parts(project);
  return stampStyle(scenes.filter((c) => c.id !== clipId), main, project, cardId);
}

/** Move a scene earlier or later in the intro. */
export function moveScene(project: Project, clipId: string, dir: -1 | 1): Clip[] {
  const { scenes, main, cardId } = parts(project);
  const i = scenes.findIndex((c) => c.id === clipId), j = i + dir;
  if (i < 0 || j < 0 || j >= scenes.length) return project.clips;
  [scenes[i], scenes[j]] = [scenes[j], scenes[i]];
  return stampStyle(scenes, main, project, cardId);
}

/** Set a scene's timeline length, keeping its start in the source where the footage allows; the card follows. */
export function setSceneSeconds(project: Project, clipId: string, seconds: number): Clip[] {
  const { scenes, main, cardId } = parts(project);
  const next = scenes.map((c) => (c.id === clipId ? { ...c, introSeconds: Math.max(0.3, seconds) } : c));
  return stampStyle(next, main, project, cardId);
}

/** Titles and the export range sit on the drive: when the intro changes length they move with it. */
export function shiftAfterIntro(project: Project, delta: number): Project {
  if (!delta) return project;
  const titles = project.titles.map((t) => ({ ...t, start: Math.max(0, t.start + delta) }));
  const range = project.export.range ? { from: Math.max(0, project.export.range.from + delta), to: Math.max(0, project.export.range.to + delta) } : null;
  return { ...project, titles, export: { ...project.export, range } };
}

/** The intro's shape in words. */
export function describeIntro(project: Project): string | null {
  const region = introRegion(placeClips(project.clips));
  if (!region) return null;
  const style = introStyle(project.intro.style);
  const scenes = region.scenes.length;
  const sceneLen = region.scenes.reduce((a, c) => a + (c.end - c.start), 0);
  const parts = [`${scenes} scene${scenes === 1 ? "" : "s"} (${sceneLen.toFixed(1)} s)`];
  if (region.card) parts.push(`title card ${(region.card.end - region.card.start).toFixed(1)} s`);
  return `${style.name}: ${parts.join(" + ")} = ${region.end.toFixed(1)} s before the drive`;
}
