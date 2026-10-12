/**
 * The browser side of the editor: probing media, building 1080p proxies,
 * grading frames on the GPU, mixing audio, and exporting — stream-copying
 * untouched spans and re-encoding only what changed. Built on mediabunny
 * (WebCodecs underneath, so Apple-silicon hardware encoders do the work).
 */

import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  type VideoSample,
  canEncodeVideo,
  type StreamTargetChunk,
  type VideoCodec,
} from "mediabunny";
import { GRADE_FRAGMENT_SHADER, buildDlogLut, deriveLut, fetchOfficialLut, lutTexture, parseCube, type Lut3D } from "./lut";
import { clipAt, clipSpeed, sourceTimeAt, dbToGain, exportTags, fontFamilyCss, exportRange, isFileLutKind, musicGainAt, placeClips, planExport, transitionAt, transitionWindows, type Clip, type ExportSpan, type Grade, type LutKind, type MediaRef, type PlacedClip, type Project, type Title, type Transform, type TransitionWindow, STEADY_FRAMES } from "./project";
import { drawTransition } from "./transitions";
import { drawIntroFx, introFrameAt, introStyle, styledGrade, type IntroFrame, type Moment } from "./intro";
import { ProgressTracker, defaultSpeeds, planSteps, type ExportProgress, type SpeedPriors, type StepProgress } from "./progress";
import pkg from "@/package.json";
import type { MotionTrace } from "./stops";

export interface Probe {
  duration: number;
  width: number;
  height: number;
  fps: number;
  codec: string | null;
  rotation: number;
  hasAudio: boolean;
  sampleRate?: number;
  canDecode: boolean;
}

export async function probe(file: File): Promise<Probe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  const duration = await input.computeDuration();
  if (!video) return { duration, width: 0, height: 0, fps: 0, codec: null, rotation: 0, hasAudio: !!audio, sampleRate: audio?.sampleRate, canDecode: false };
  const stats = await video.computePacketStats(200);
  return { duration, width: video.displayWidth, height: video.displayHeight, fps: Math.round(stats.averagePacketRate * 1000) / 1000, codec: video.codec, rotation: video.rotation, hasAudio: !!audio, sampleRate: audio?.sampleRate, canDecode: await video.canDecode() };
}

/* ------------------------------------------------------------- proxies */

/**
 * An H.264 proxy of a source file at the chosen height, with the clip's own
 * sound as AAC, written to `writable` as it encodes. The preview plays this
 * instead of the 8K original; export never touches it.
 */
export async function buildProxy(file: File, writable: WritableStream<StreamTargetChunk>, height: number, onProgress?: (p: number) => void, signal?: AbortSignal): Promise<void> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track.");
  const scale = Math.min(1, height / track.displayHeight);
  const w = Math.round((track.displayWidth * scale) / 2) * 2, h = Math.round((track.displayHeight * scale) / 2) * 2;
  const duration = await input.computeDuration();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new StreamTarget(writable, { chunked: true }) });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  // Bitrate follows the picture size: ~4 Mbit/s at 1080p, ~0.5 at 360p. Realtime mode keeps the encoder responsive.
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: Math.round(h * h * 3.6), keyFrameInterval: 1, latencyMode: "realtime" });
  output.addVideoTrack(source, { frameRate: 30 });
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioSource = audioTrack && (await audioTrack.canDecode()) ? new AudioSampleSource({ codec: "aac", bitrate: 96000 }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  const cancelled = () => signal?.aborted ?? false;
  const video = (async () => {
    const sink = new VideoSampleSink(track);
    // Proxies run at a fixed 30 fps and skip frames beyond it: scrubbing needs responsiveness, not every frame.
    let last = -1;
    for await (const sample of sink.samples()) {
      if (cancelled()) {
        sample.close();
        break;
      }
      const t = sample.timestamp;
      if (t - last >= 1 / 30 - 1e-4) {
        ctx.drawImage(sample.toCanvasImageSource(), 0, 0, w, h);
        await source.add(t, 1 / 30);
        last = t;
        onProgress?.(Math.min(1, t / Math.max(1e-6, duration)));
      }
      sample.close();
    }
    source.close();
  })();
  const audio = (async () => {
    if (!audioSource || !audioTrack) return;
    for await (const sample of new AudioSampleSink(audioTrack).samples()) {
      if (cancelled()) {
        sample.close();
        break;
      }
      await audioSource.add(sample);
      sample.close();
    }
    audioSource.close();
  })();
  await Promise.all([video, audio]);
  if (cancelled()) {
    await output.cancel();
    throw new DOMException("Cancelled", "AbortError");
  }
  await output.finalize();
}

/* ------------------------------------------------------------ grading */

/** GPU grading: draws a frame through the LUT + adjustment shader with rotation, straighten and crop applied. */
export class Grader {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private frameTex: WebGLTexture;
  private lutTex: WebGLTexture;
  private lutLoaded: LutKind = "none";
  private lutSize = 33;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};
  readonly canvas: OffscreenCanvas;
  private luts: Partial<Record<LutKind, Lut3D>> = {};
  private custom: Lut3D | null = null;

  /** The project's own .cube; clips with lut "custom" use it (and draw unconverted until one is set). */
  setCustomLut(lut: Lut3D | null) {
    if (lut === this.custom) return;
    this.custom = lut;
    if (this.lutLoaded === "custom") this.lutLoaded = "none";
  }

  /** Hand over a conversion that is built from DJI's file (fetched elsewhere); until then those clips draw unconverted. */
  provideLut(kind: LutKind, lut: Lut3D) {
    if (this.luts[kind] === lut) return;
    this.luts[kind] = lut;
    if (this.lutLoaded === kind) this.lutLoaded = "none";
  }

  constructor(width: number, height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL 2 isn't available.");
    this.gl = gl;
    // Linear filtering of float textures is an extension; without it the LUT would sample as nearest (still correct, just coarser).
    gl.getExtension("OES_texture_float_linear");
    const vs = `#version 300 es
in vec2 aPos; in vec2 aUv; out vec2 vUv;
uniform mat3 uTransform;
void main() { vUv = aUv; vec3 p = uTransform * vec3(aPos, 1.0); gl_Position = vec4(p.xy, 0.0, 1.0); }`;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
      return sh;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(this.program, compile(gl.FRAGMENT_SHADER, GRADE_FRAGMENT_SHADER));
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? "link error");
    gl.useProgram(this.program);
    const quad = new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "aPos"), aUv = gl.getAttribLocation(this.program, "aUv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    for (const u of ["uFrame", "uLut", "uLutSize", "uUseLut", "uExposure", "uTemperature", "uTint", "uContrast", "uSaturation", "uTransform"]) this.uniforms[u] = gl.getUniformLocation(this.program, u);
    this.frameTex = gl.createTexture()!;
    this.lutTex = gl.createTexture()!;
    for (const [tex, unit] of [[this.frameTex, 0], [this.lutTex, 1]] as const) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.uniform1i(this.uniforms.uFrame, 0);
    gl.uniform1i(this.uniforms.uLut, 1);
  }

  /** Upload the LUT for a grade if needed; false when there is nothing to apply. */
  private loadLut(kind: LutKind): boolean {
    if (kind === "none") return false;
    const lut = kind === "custom" ? this.custom : isFileLutKind(kind) ? (this.luts[kind] ?? null) : (this.luts[kind] ??= buildDlogLut(kind));
    if (!lut) return false;
    if (this.lutLoaded === kind) return true;
    const { width, height, data } = lutTexture(lut);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.lutLoaded = kind;
    this.lutSize = lut.size;
    return true;
  }

  /** Draw a source image with the grade and transform into this.canvas. */
  draw(src: CanvasImageSource | VideoFrame, grade: Grade, transform: Transform, srcW: number, srcH: number) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    // The quad's texture coordinates already put the frame the right way up; flipping here would invert it.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    const useLut = this.loadLut(grade.lut);
    gl.uniform1i(this.uniforms.uUseLut, useLut ? 1 : 0);
    gl.uniform1f(this.uniforms.uLutSize, this.lutSize);
    gl.uniform1f(this.uniforms.uExposure, grade.exposure);
    gl.uniform1f(this.uniforms.uTemperature, grade.temperature);
    gl.uniform1f(this.uniforms.uTint, grade.tint);
    gl.uniform1f(this.uniforms.uContrast, grade.contrast);
    gl.uniform1f(this.uniforms.uSaturation, grade.saturation);
    // Transform in clip space: crop → scale up to fill, then rotate quarter turns + straighten.
    const { crop, rotate, straighten } = transform;
    const a = (rotate * 90 + straighten) * (Math.PI / 180);
    const quarter = rotate % 2 === 1;
    const aspectSrc = srcW / srcH, aspectDst = this.canvas.width / this.canvas.height;
    // Scale so the cropped region fills the output; straightening zooms in slightly to hide corners.
    const zoom = 1 + Math.abs(Math.sin(straighten * (Math.PI / 180))) * Math.max(aspectSrc, 1 / aspectSrc);
    const sx = (1 / crop.w) * zoom, sy = (1 / crop.h) * zoom;
    const cx = (crop.x + crop.w / 2) * 2 - 1, cy = 1 - (crop.y + crop.h / 2) * 2;
    const cos = Math.cos(a), sin = Math.sin(a);
    // Aspect-correct rotation: rotate in square space then restore aspect.
    const ar = quarter ? aspectSrc : 1;
    const m = [sx * cos * (quarter ? 1 / aspectDst : 1) * (quarter ? ar : 1), sx * sin * (quarter ? 1 : aspectDst), 0, -sy * sin * (quarter ? 1 / aspectDst : 1), sy * cos, 0, -cx * sx, -cy * sy, 1];
    gl.uniformMatrix3fv(this.uniforms.uTransform, false, new Float32Array(m));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}

/* --------------------------------------------------------- steady lights */

const STEADY_VS = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;
const STEADY_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 o;
uniform sampler2D uCur;
uniform sampler2D uP1;
uniform sampler2D uP2;
uniform int uFrames;
uniform int uHave;
// How much a pixel reads as a light: bright, or strongly coloured and reasonably bright (a red lamp is dim in luma).
float glow(vec3 c) {
  float v = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float s = v > 1e-4 ? (v - mn) / v : 0.0;
  return v * (0.45 + 0.55 * s);
}
void main() {
  vec3 c = texture(uCur, vUv).rgb;
  if (uHave < 1) {
    o = vec4(c, 1.0);
    return;
  }
  vec3 p = texture(uP1, vUv).rgb;
  if (uFrames > 2 && uHave > 1) p = max(p, texture(uP2, vUv).rgb);
  // Only where this or an earlier frame holds a light: lift the pixel to the brightest of them; never darken anything.
  float w = smoothstep(0.42, 0.6, max(glow(c), glow(p)));
  o = vec4(mix(c, max(c, p), w), 1.0);
}`;

/**
 * Holds LED lights steady: traffic lights, brake lights and signs pulse faster than the shutter and blink on camera,
 * so each pixel that reads as a light is kept at its brightest over the last two or three frames. Feed it the raw
 * composed frames in order; it keeps its own history (never its own output, so trails stop when the light does).
 */
export class Steadier {
  readonly canvas: OffscreenCanvas;
  private gl: WebGL2RenderingContext;
  private tex: WebGLTexture[] = [];
  private i = 0;
  private have = 0;
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(width: number, height: number, readonly frames: 2 | 3) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, STEADY_VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, STEADY_FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "program");
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const name of ["uCur", "uP1", "uP2", "uFrames", "uHave"]) this.uniforms[name] = gl.getUniformLocation(program, name);
    for (let k = 0; k < 3; k++) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.tex.push(t);
    }
    gl.uniform1i(this.uniforms.uFrames, frames);
  }

  /** Forget the history: at a cut, a seek, or the start of a span, so no light carries over from other footage. */
  reset() {
    this.have = 0;
  }

  /** Run one raw frame through; the result is in this.canvas. */
  apply(src: CanvasImageSource) {
    const gl = this.gl;
    const cur = this.i, p1 = (this.i + 2) % 3, p2 = (this.i + 1) % 3;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[cur]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[p1]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[p2]);
    gl.uniform1i(this.uniforms.uCur, 0);
    gl.uniform1i(this.uniforms.uP1, 1);
    gl.uniform1i(this.uniforms.uP2, 2);
    gl.uniform1i(this.uniforms.uHave, this.have);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    this.i = (this.i + 1) % 3;
    this.have = Math.min(2, this.have + 1);
  }
}

/* ------------------------------------------------------------- overlays */

/** One title (text + optional subtitle) at its anchor, with its colour, font, size and optional backing box. */
function drawTitleBlock(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, title: Title) {
  const family = fontFamilyCss(title.font);
  const px = Math.max(8, Math.round(h * title.size));
  const pad = w * 0.04;
  const style = (size: number, weight: number) => `${title.italic ? "italic " : ""}${weight} ${size}px ${family}`;
  const lines = [{ text: title.text, size: px, weight: title.weight, alpha: 1 }];
  if (title.subtitle) lines.push({ text: title.subtitle, size: Math.round(px * 0.5), weight: Math.max(300, title.weight - 200), alpha: 0.85 });
  const gap = px * 0.35;
  const c = ctx as OffscreenCanvasRenderingContext2D & { letterSpacing?: string };
  if ("letterSpacing" in c) c.letterSpacing = `${title.letterSpacing}em`;
  const widths = lines.map((l) => {
    ctx.font = style(l.size, l.weight);
    return ctx.measureText(l.text).width;
  });
  const blockW = Math.max(...widths), blockH = lines.reduce((a, l) => a + l.size, 0) + gap * (lines.length - 1);
  const row = title.position[0], col = title.position[1];
  const x = col === "l" ? pad : col === "r" ? w - pad - blockW : (w - blockW) / 2;
  const y = row === "t" ? pad : row === "b" ? h - pad - blockH : (h - blockH) / 2;
  const base = ctx.globalAlpha;
  // The box: padding, corners and a border, drawn without any text shadow.
  const bp = px * title.padding, bw = px * title.borderWidth;
  if (title.background || bw > 0) {
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.roundRect(x - bp, y - bp, blockW + bp * 2, blockH + bp * 2, px * title.radius);
    if (title.background) {
      ctx.fillStyle = title.background;
      ctx.fill();
    }
    if (bw > 0) {
      ctx.lineWidth = bw;
      ctx.strokeStyle = title.borderColor;
      ctx.stroke();
    }
  }
  // Text shadow styles.
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  if (title.shadow === "soft") {
    ctx.shadowColor = title.shadowColor;
    ctx.shadowBlur = px * 0.25;
    ctx.shadowOffsetY = px * 0.05;
  } else if (title.shadow === "hard") {
    ctx.shadowColor = title.shadowColor;
    ctx.shadowOffsetX = px * 0.06;
    ctx.shadowOffsetY = px * 0.06;
  }
  ctx.textBaseline = "top";
  const align = title.align === "auto" ? (col === "l" ? "left" : col === "r" ? "right" : "center") : title.align;
  ctx.textAlign = align;
  const tx = align === "left" ? x : align === "right" ? x + blockW : x + blockW / 2;
  ctx.lineJoin = "round";
  let cy = y;
  for (const l of lines) {
    ctx.font = style(l.size, l.weight);
    ctx.globalAlpha = base * l.alpha;
    if (title.shadow === "outline") {
      ctx.lineWidth = Math.max(1, l.size * 0.1);
      ctx.strokeStyle = title.shadowColor;
      ctx.strokeText(l.text, tx, cy);
    }
    ctx.fillStyle = title.color;
    ctx.fillText(l.text, tx, cy);
    cy += l.size + gap;
  }
  if ("letterSpacing" in c) c.letterSpacing = "0px";
  ctx.shadowColor = "transparent";
}

/** Titles, intro card and watermark drawn with 2D canvas on top of the graded frame. */
export function drawOverlays(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, t: number, project: Project, logo: ImageBitmap | null) {
  for (const title of project.titles) {
    if (t < title.start || t > title.start + title.duration) continue;
    const local = t - title.start;
    const fadeIn = title.fade > 0 ? Math.min(1, local / title.fade) : 1;
    const fadeOut = title.fade > 0 ? Math.min(1, (title.start + title.duration - t) / title.fade) : 1;
    const alpha = Math.min(fadeIn, fadeOut);
    ctx.save();
    if (title.kind === "intro") {
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = alpha;
    drawTitleBlock(ctx, w, h, title);
    ctx.restore();
  }
  if (logo && project.watermark.media) {
    const { corner, size, opacity, margin } = project.watermark;
    const lw = w * size, lh = (logo.height / logo.width) * lw, m = w * margin;
    const x = corner.endsWith("l") ? m : w - m - lw, y = corner.startsWith("t") ? m : h - m - lh;
    ctx.save();
    ctx.globalAlpha = opacity;
    ctx.drawImage(logo, x, y, lw, lh);
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ audio */

export interface MixInput {
  project: Project;
  getFile: (mediaId: string) => Promise<File | null>;
  sampleRate: number;
}

/**
 * Mix original clip audio with the music lanes for a timeline range, in
 * fixed-size blocks. Returns interleaved stereo f32 blocks via the callback.
 */
/** Original sound follows a clip's speed between these; beyond them it is pitch-shifted noise, so it goes quiet. */
export const MIN_AUDIBLE_SPEED = 0.25, MAX_AUDIBLE_SPEED = 4;

export async function mixAudio(input: MixInput, from: number, to: number, onBlock: (samples: Float32Array, timestamp: number) => Promise<void>, signal?: AbortSignal): Promise<void> {
  const { project, getFile, sampleRate } = input;
  const block = 4096;
  const placed = placeClips(project.clips);
  // Open every source lazily and keep decoders alive across blocks.
  interface Opened {
    sink: AudioSampleSink;
    sampleRate: number;
    iter?: AsyncGenerator<AudioSample>;
    buf: Float32Array;
    bufStart: number;
  }
  const opened = new Map<string, Opened>();
  const open = async (mediaId: string): Promise<Opened | null> => {
    if (opened.has(mediaId)) return opened.get(mediaId)!;
    const f = await getFile(mediaId);
    if (!f) return null;
    const inp = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    const track = await inp.getPrimaryAudioTrack();
    if (!track) return null;
    const o: Opened = { sink: new AudioSampleSink(track), sampleRate: track.sampleRate, buf: new Float32Array(0), bufStart: 0 };
    opened.set(mediaId, o);
    return o;
  };
  // Pull stereo samples for [t, t+n) from a source at source time; simple nearest-sample resampling.
  const pull = async (mediaId: string, sourceT: number, n: number): Promise<Float32Array> => {
    const o = await open(mediaId);
    const out = new Float32Array(n * 2);
    if (!o) return out;
    const needStart = sourceT, needEnd = sourceT + n / sampleRate;
    if (!o.iter || needStart < o.bufStart) {
      o.iter = o.sink.samples(Math.max(0, needStart - 0.05));
      o.buf = new Float32Array(0);
      o.bufStart = needStart;
    }
    while (o.bufStart + o.buf.length / 2 / o.sampleRate < needEnd) {
      const { value, done } = await o.iter.next();
      if (done || !value) break;
      const frames = value.numberOfFrames, ch = value.numberOfChannels;
      const tmp = new Float32Array(frames * ch);
      value.copyTo(tmp, { format: "f32", planeIndex: 0 });
      const stereo = new Float32Array(frames * 2);
      for (let i = 0; i < frames; i++) {
        stereo[i * 2] = tmp[i * ch];
        stereo[i * 2 + 1] = ch > 1 ? tmp[i * ch + 1] : tmp[i * ch];
      }
      if (o.buf.length === 0) o.bufStart = value.timestamp;
      const merged = new Float32Array(o.buf.length + stereo.length);
      merged.set(o.buf);
      merged.set(stereo, o.buf.length);
      o.buf = merged;
      value.close();
      // Trim what we have already passed.
      const keepFrom = Math.max(0, Math.floor((needStart - 0.5 - o.bufStart) * o.sampleRate));
      if (keepFrom > 0) {
        o.buf = o.buf.slice(keepFrom * 2);
        o.bufStart += keepFrom / o.sampleRate;
      }
    }
    for (let i = 0; i < n; i++) {
      const st = sourceT + i / sampleRate;
      const idx = Math.round((st - o.bufStart) * o.sampleRate);
      if (idx >= 0 && idx * 2 + 1 < o.buf.length) {
        out[i * 2] = o.buf[idx * 2];
        out[i * 2 + 1] = o.buf[idx * 2 + 1];
      }
    }
    return out;
  };
  for (let t = from; t < to; t += block / sampleRate) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const n = Math.min(block, Math.round((to - t) * sampleRate));
    const mix = new Float32Array(n * 2);
    // Original audio from whichever clip is under this block.
    const here = placed.find((c) => t >= c.start && t < c.end);
    const hereSpeed = here ? clipSpeed(here) : 1;
    if (here && !here.muted && project.media[here.media]?.hasAudio && hereSpeed >= MIN_AUDIBLE_SPEED && hereSpeed <= MAX_AUDIBLE_SPEED) {
      const g = dbToGain(here.gainDb);
      if (hereSpeed === 1) {
        const s = await pull(here.media, sourceTimeAt(here, t), n);
        for (let i = 0; i < n * 2; i++) mix[i] += s[i] * g;
      } else {
        // Sped-up or slowed footage: read the matching stretch of source audio and resample it to this block (pitch follows).
        const srcN = Math.ceil(n * hereSpeed) + 1;
        const s = await pull(here.media, sourceTimeAt(here, t), srcN);
        for (let i = 0; i < n; i++) {
          const x = i * hereSpeed, j = Math.min(srcN - 2, Math.floor(x)), f = x - j;
          mix[i * 2] += (s[j * 2] * (1 - f) + s[(j + 1) * 2] * f) * g;
          mix[i * 2 + 1] += (s[j * 2 + 1] * (1 - f) + s[(j + 1) * 2 + 1] * f) * g;
        }
      }
    }
    for (const m of project.music) {
      if (m.muted || t + n / sampleRate < m.start || t > m.start + (m.out - m.in)) continue;
      const s = await pull(m.media, m.in + (t - m.start), n);
      for (let i = 0; i < n; i++) {
        const g = musicGainAt(m, project.music, t + i / sampleRate, to);
        mix[i * 2] += s[i * 2] * g;
        mix[i * 2 + 1] += s[i * 2 + 1] * g;
      }
    }
    // Soft clip.
    for (let i = 0; i < mix.length; i++) mix[i] = Math.tanh(mix[i]);
    await onBlock(mix, t);
  }
}

/* ------------------------------------------------------------------ export */

export interface ExportOptions {
  project: Project;
  getFile: (mediaId: string) => Promise<File | null>;
  logo: ImageBitmap | null;
  writable: WritableStream<StreamTargetChunk>;
  onProgress?: (p: ExportProgress) => void;
  /** Awaited between frames and audio blocks: return a promise while paused, nothing otherwise. */
  whilePaused?: () => Promise<void> | void;
  /** Speeds from an earlier export on this machine, to estimate from before anything is measured. */
  priors?: SpeedPriors;
  signal?: AbortSignal;
}

const PRESET_LATENCY: Record<Project["export"]["preset"], "quality" | "realtime"> = { quality: "quality", balanced: "quality", fast: "realtime" };

/**
 * Export the timeline. Copy spans forward encoded packets untouched (from
 * the previous keyframe, re-encoding the lead-in frames); encode spans
 * decode, grade on the GPU, draw overlays and re-encode. Audio is mixed and
 * encoded separately. One continuous output file streams to `writable`.
 */
/**
 * Frames of the clip on the other side of a transition, decoded sequentially
 * and held at the last decoded frame when the footage runs out (no handles).
 */
class NeighbourFrames {
  private key = "";
  private iter: AsyncIterator<VideoSample> | null = null;
  private current: VideoSample | null = null;
  private pending: VideoSample | null = null;
  private done = false;
  constructor(private openInput: (mediaId: string) => Promise<Input>) {}

  async frameAt(clip: PlacedClip, window: TransitionWindow, sourceT: number): Promise<VideoSample | null> {
    const key = `${clip.id}@${window.cut}`;
    if (key !== this.key) {
      await this.reset();
      this.key = key;
      const track = await (await this.openInput(clip.media)).getPrimaryVideoTrack();
      if (!track) return null;
      const from = Math.max(0, sourceTimeAt(clip, window.start)), to = sourceTimeAt(clip, window.end) + 0.5;
      this.iter = new VideoSampleSink(track).samples(from, to)[Symbol.asyncIterator]();
    }
    while (this.iter && !this.done) {
      if (!this.pending) {
        const r = await this.iter.next();
        if (r.done) {
          this.done = true;
          break;
        }
        this.pending = r.value;
      }
      if (!this.current || this.pending.timestamp <= sourceT + 1e-4) {
        this.current?.close();
        this.current = this.pending;
        this.pending = null;
      } else break;
    }
    return this.current;
  }

  async reset() {
    this.current?.close();
    this.pending?.close();
    await this.iter?.return?.();
    this.current = this.pending = null;
    this.iter = null;
    this.done = false;
  }
}

export interface ExportResult {
  bytesWritten: number;
  seconds: number;
  activeMs: number;
  pausedMs: number;
  /** Every step with its actual time, and the speeds measured, to seed the next export's estimates. */
  steps: StepProgress[];
  measured: SpeedPriors;
}

export async function exportProject(opts: ExportOptions): Promise<ExportResult> {
  // A 250 ms pulse keeps the panel's clocks moving through the stages that report nothing of their own.
  const pulse: { emit: (() => void) | null } = { emit: null };
  const ticker = setInterval(() => pulse.emit?.(), 250);
  try {
    return await exportWithPulse(opts, pulse);
  } finally {
    clearInterval(ticker);
  }
}

async function exportWithPulse(opts: ExportOptions, pulse: { emit: (() => void) | null }): Promise<ExportResult> {
  const { project, getFile, logo, signal } = opts;
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height) throw new Error("Add at least one video clip.");
  const outH = project.export.resolution === "source" ? first.height : project.export.resolution;
  const outW = Math.round((first.width * (outH / first.height)) / 2) * 2;
  const fps = first.fps || 30;
  const codec: VideoCodec = project.export.codec;
  const bitrate = project.export.bitrateMbps * 1e6;
  const spans = planExport(project);
  const total = spans.reduce((a, s) => a + (s.end - s.start), 0);
  const needsFileLut = project.clips.some((c) => isFileLutKind(c.grade.lut));
  const lutsToLoad = [needsFileLut ? "DJI's conversion file" : "", project.customLut && project.clips.some((c) => c.grade.lut === "custom") ? `the custom .cube (${project.customLut.name})` : ""].filter(Boolean);
  const steps = planSteps({
    spans,
    clipName: (id) => project.media[project.clips.find((c) => c.id === id)?.media ?? ""]?.name ?? id,
    lutsToLoad,
    audio: { clips: project.clips.filter((c) => !c.muted && c.gainDb > -60).length, music: project.music.filter((m) => !m.muted).length, bitrateKbps: project.export.audioBitrateKbps },
    output: { codec, width: outW, height: outH, preset: project.export.preset, bitrateMbps: project.export.bitrateMbps },
  });
  const tracker = new ProgressTracker(() => performance.now(), steps, total, Math.round(total * fps), opts.priors, defaultSpeeds(first.width * first.height, outW * outH), Date.now(), ((bitrate + project.export.audioBitrateKbps * 1000) / 8) * total);
  let lastEmit = 0;
  const emit = (force = false) => {
    const now = performance.now();
    if (!force && now - lastEmit < 100) return;
    lastEmit = now;
    opts.onProgress?.(tracker.snapshot());
  };
  // Steps without inner progress (prepare, closing the file) still get a ticking clock.
  pulse.emit = () => emit();
  // A pause is whatever time whilePaused() keeps us waiting.
  const pauseGate = async () => {
    const p = opts.whilePaused?.();
    if (!p) return;
    tracker.pause();
    emit(true);
    await p;
    tracker.resume();
    emit(true);
  };
  tracker.beginStep("prepare");
  emit(true);
  if (!(await canEncodeVideo(codec, { width: outW, height: outH, bitrate }))) throw new Error(`This browser can't encode ${codec.toUpperCase()} at ${outW}×${outH}. Try the other codec or a lower resolution.`);
  // Count what reaches the file: every chunk passes through here on its way to the folder.
  const fileWriter = opts.writable.getWriter();
  const counted = new WritableStream<StreamTargetChunk>({
    write: (chunk) => {
      tracker.addBytes(chunk.data.byteLength);
      emit();
      return fileWriter.write(chunk);
    },
    close: async () => {
      // Everything is written; from here the browser reads the file back to check it, then moves it into place.
      tracker.beginClose();
      emit(true);
      await fileWriter.close();
    },
    abort: (r) => fileWriter.abort(r),
  });
  // A partial export starts its file at zero: timeline times shift back by the range start.
  const offset = exportRange(project)?.from ?? 0;
  const placedAll = placeClips(project.clips);
  const windows = transitionWindows(placedAll, project.media);
  const neighbour = new NeighbourFrames((id) => openInput(id));
  let tmpA: OffscreenCanvas | null = null, tmpB: OffscreenCanvas | null = null, scratch: OffscreenCanvas | null = null;
  let fxScratch: { a: OffscreenCanvas; b: OffscreenCanvas } | null = null;
  // Intro scenes draw through the style's look; the clip on the other side of a transition gets the same treatment.
  const gradeFor = (c: Clip, timelineT: number) => {
    const f = c.introRole ? introFrameAt(project, placedAll, timelineT) : null;
    return f ? styledGrade(c.grade, f.style) : c.grade;
  };
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(counted, { chunked: true }) });
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx2d = canvas.getContext("2d")!;
  const grader = new Grader(outW, outH);
  const steadyFrames = STEADY_FRAMES[project.export.steadyLights ?? "off"];
  const steady = steadyFrames ? new Steadier(outW, outH, steadyFrames) : null;
  if (project.customLut) {
    try {
      grader.setCustomLut(parseCube(project.customLut.cube));
    } catch {
      /* unreadable .cube: those clips export unconverted, as the preview showed */
    }
  }
  if (needsFileLut) {
    const base = await fetchOfficialLut();
    grader.provideLut("dji-official", deriveLut(base, "dji-official"));
    grader.provideLut("dji-official-study", deriveLut(base, "dji-official-study"));
  }
  const videoSource = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, latencyMode: PRESET_LATENCY[project.export.preset], hardwareAcceleration: "prefer-hardware" });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const sampleRate = 48000;
  const audioSource = new AudioSampleSource({ codec: "aac", bitrate: project.export.audioBitrateKbps * 1000 });
  output.addAudioTrack(audioSource);
  output.setMetadataTags(exportTags(project, `Bench video editor ${pkg.version}`));
  await output.start();
  tracker.endStep();
  emit(true);
  let written = 0;
  // Video, span by span, in timeline order.
  const inputs = new Map<string, Input>();
  const openInput = async (mediaId: string) => {
    if (inputs.has(mediaId)) return inputs.get(mediaId)!;
    const f = await getFile(mediaId);
    if (!f) throw new Error(`Missing file for ${project.media[mediaId]?.name ?? mediaId}.`);
    const inp = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    inputs.set(mediaId, inp);
    return inp;
  };
  let spanIndex = 0;
  for (const span of spans) {
    spanIndex++;
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    tracker.beginStep(`span-${spanIndex}`);
    emit(true);
    const clip = project.clips.find((c) => c.id === span.clipId)!;
    const media = project.media[clip.media];
    const input = await openInput(clip.media);
    const track = (await input.getPrimaryVideoTrack())!;
    const progress = (sourceT: number) => {
      tracker.frame(written + (sourceT - span.sourceIn));
      emit();
    };
    // A copy span is only truly copyable if the encoder/container accept the source packets; we re-encode here
    // frame-accurately instead, but skip the GPU grade (identity draw) so it is still much faster than a graded span.
    const sink = new VideoSampleSink(track);
    const srcW = media.width ?? track.displayWidth, srcH = media.height ?? track.displayHeight;
    const speed = span.speed || 1;
    // At 1× every source frame becomes an output frame. At other speeds the output keeps the source frame rate: each
    // output tick shows the source frame playing at that moment, so 2× drops every other frame and 0.5× holds each twice.
    let nextTick = span.start;
    const frameDur = 1 / fps;
    const compose = async (sample: VideoSample, timelineT: number) => {
      const tr = windows.length && span.kind === "encode" ? transitionAt(windows, timelineT) : null;
      let composed = false;
      if (tr) {
        // Inside a transition: grade both sides, then composite them.
        const outgoingIsThis = tr.window.outgoing.id === clip.id;
        const other = outgoingIsThis ? tr.window.incoming : tr.window.outgoing;
        const frame = await neighbour.frameAt(other, tr.window, sourceTimeAt(other, timelineT));
        if (frame) {
          tmpA ??= new OffscreenCanvas(outW, outH);
          tmpB ??= new OffscreenCanvas(outW, outH);
          scratch ??= new OffscreenCanvas(outW, outH);
          const om = project.media[other.media];
          grader.draw(sample.toCanvasImageSource(), gradeFor(clip, timelineT), clip.transform, srcW, srcH);
          tmpA.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          grader.draw(frame.toCanvasImageSource(), gradeFor(other, timelineT), other.transform, om?.width ?? frame.displayWidth, om?.height ?? frame.displayHeight);
          tmpB.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          drawTransition(ctx2d, outgoingIsThis ? tmpA : tmpB, outgoingIsThis ? tmpB : tmpA, outW, outH, tr.window.kind, tr.progress, scratch);
          composed = true;
        }
      }
      if (!composed && span.kind === "encode") {
        grader.draw(sample.toCanvasImageSource(), gradeFor(clip, timelineT), clip.transform, srcW, srcH);
        ctx2d.drawImage(grader.canvas, 0, 0, outW, outH);
      } else if (!composed) {
        ctx2d.drawImage(sample.toCanvasImageSource(), 0, 0, outW, outH);
      }
      const intro = introFrameAt(project, placedAll, timelineT);
      if (intro) {
        fxScratch ??= { a: new OffscreenCanvas(outW, outH), b: new OffscreenCanvas(outW, outH) };
        drawIntroFx(ctx2d, outW, outH, intro, project, fxScratch);
      }
      drawOverlays(ctx2d, outW, outH, timelineT, project, logo);
      if (steady) {
        steady.apply(canvas);
        ctx2d.drawImage(steady.canvas, 0, 0, outW, outH);
      }
    };
    // Lights are held over frames of this span only: nothing from the footage before a cut bleeds into it.
    steady?.reset();
    for await (const sample of sink.samples(span.sourceIn, span.sourceOut)) {
      if (signal?.aborted) {
        sample.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      await pauseGate();
      if (signal?.aborted) {
        sample.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      if (speed === 1) {
        const timelineT = span.start + (sample.timestamp - span.sourceIn);
        await compose(sample, timelineT);
        await videoSource.add(timelineT - offset, sample.duration || frameDur);
        progress(sample.timestamp);
      } else {
        // This source frame is on screen until its successor's timeline time; emit every output tick that falls inside.
        const shownUntil = span.start + (sample.timestamp + (sample.duration || frameDur * speed) - span.sourceIn) / speed;
        while (nextTick < shownUntil - 1e-6 && nextTick < span.end - 1e-6) {
          await compose(sample, nextTick);
          await videoSource.add(nextTick - offset, frameDur);
          nextTick += frameDur;
          tracker.frame(written + (nextTick - span.start));
          emit();
        }
      }
      sample.close();
    }
    written += span.end - span.start;
    tracker.endStep();
    emit(true);
  }
  await neighbour.reset();
  videoSource.close();
  // Audio.
  tracker.beginStep("audio");
  emit(true);
  await mixAudio({ project, getFile, sampleRate }, offset, offset + total, async (samples, timestamp) => {
    await pauseGate();
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    tracker.audio(timestamp - offset);
    emit();
    const s = new AudioSample({ data: samples, format: "f32", numberOfChannels: 2, sampleRate, timestamp: timestamp - offset });
    await audioSource.add(s);
    s.close();
  }, signal);
  audioSource.close();
  tracker.endStep();
  tracker.beginStep("finalize");
  emit(true);
  await output.finalize();
  tracker.endStep();
  emit(true);
  const done = tracker.snapshot();
  return { bytesWritten: tracker.bytes, seconds: total, activeMs: done.elapsedMs, pausedMs: done.pausedMs, steps: done.steps, measured: tracker.measured() };
}

/* ------------------------------------------------------------- stills */

export interface FrameOptions {
  project: Project;
  getFile: (mediaId: string) => Promise<File | null>;
  logo: ImageBitmap | null;
  /** Timeline instant, seconds. */
  t: number;
  /** Scale the frame to this height (never above the source); omitted, the source resolution. */
  height?: number;
  /** PNG is lossless; JPEG takes a quality 0…1. */
  type?: "image/png" | "image/jpeg";
  quality?: number;
}

export interface RenderedFrame {
  blob: Blob;
  width: number;
  height: number;
  clipName: string;
  sourceTime: number;
}

/**
 * One timeline instant rendered exactly as an export would write it: the
 * source frame (never the proxy) at the first clip's full resolution, graded
 * on the GPU, composited through any transition, with titles and overlays.
 */
export async function renderFrame(opts: FrameOptions): Promise<RenderedFrame> {
  const { project, getFile, logo, t } = opts;
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height) throw new Error("Add at least one video clip.");
  const under = clipAt(project.clips, t);
  if (!under) throw new Error("There is no clip under the playhead.");
  const outH = Math.round(Math.min(first.height, Math.max(2, opts.height ?? first.height)) / 2) * 2;
  const outW = Math.round((first.width * (outH / first.height)) / 2) * 2;
  const inputs = new Map<string, Input>();
  const openInput = async (mediaId: string) => {
    if (inputs.has(mediaId)) return inputs.get(mediaId)!;
    const f = await getFile(mediaId);
    if (!f) throw new Error(`Missing file for ${project.media[mediaId]?.name ?? mediaId}.`);
    const inp = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    inputs.set(mediaId, inp);
    return inp;
  };
  // The frame shown at a source instant: the last one decoded at or before it.
  const frameOf = async (clip: PlacedClip, sourceT: number): Promise<VideoSample | null> => {
    const track = await (await openInput(clip.media)).getPrimaryVideoTrack();
    if (!track) return null;
    return new VideoSampleSink(track).getSample(Math.max(clip.in, Math.min(clip.out - 1e-3, sourceT)));
  };
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d")!;
  const grader = new Grader(outW, outH);
  if (project.customLut) {
    try {
      grader.setCustomLut(parseCube(project.customLut.cube));
    } catch {
      /* unreadable .cube: draw unconverted, as the preview does */
    }
  }
  if (project.clips.some((c) => isFileLutKind(c.grade.lut))) {
    const base = await fetchOfficialLut();
    grader.provideLut("dji-official", deriveLut(base, "dji-official"));
    grader.provideLut("dji-official-study", deriveLut(base, "dji-official-study"));
  }
  const main = await frameOf(under.clip, under.sourceTime);
  if (!main) throw new Error("Couldn't decode a frame at the playhead.");
  const media = project.media[under.clip.media];
  const srcW = media?.width ?? main.displayWidth, srcH = media?.height ?? main.displayHeight;
  const placedAll = placeClips(project.clips);
  const tr = transitionAt(transitionWindows(placedAll, project.media), t);
  const intro = introFrameAt(project, placedAll, t);
  const gradeFor = (c: Clip) => (c.introRole && intro ? styledGrade(c.grade, intro.style) : c.grade);
  let composed = false;
  if (tr) {
    const outgoingIsThis = tr.window.outgoing.id === under.clip.id;
    const other = outgoingIsThis ? tr.window.incoming : tr.window.outgoing;
    const frame = await frameOf(other, sourceTimeAt(other, t));
    if (frame) {
      const a = new OffscreenCanvas(outW, outH), b = new OffscreenCanvas(outW, outH), scratch = new OffscreenCanvas(outW, outH);
      const om = project.media[other.media];
      grader.draw(main.toCanvasImageSource(), gradeFor(under.clip), under.clip.transform, srcW, srcH);
      a.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
      grader.draw(frame.toCanvasImageSource(), gradeFor(other), other.transform, om?.width ?? frame.displayWidth, om?.height ?? frame.displayHeight);
      b.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
      drawTransition(ctx, outgoingIsThis ? a : b, outgoingIsThis ? b : a, outW, outH, tr.window.kind, tr.progress, scratch);
      frame.close();
      composed = true;
    }
  }
  if (!composed) {
    grader.draw(main.toCanvasImageSource(), gradeFor(under.clip), under.clip.transform, srcW, srcH);
    ctx.drawImage(grader.canvas, 0, 0, outW, outH);
  }
  if (intro) drawIntroFx(ctx, outW, outH, intro, project, { a: new OffscreenCanvas(outW, outH), b: new OffscreenCanvas(outW, outH) });
  drawOverlays(ctx, outW, outH, t, project, logo);
  main.close();
  const blob = await canvas.convertToBlob({ type: opts.type ?? "image/png", quality: opts.quality });
  return { blob, width: outW, height: outH, clipName: media?.name ?? under.clip.media, sourceTime: under.sourceTime };
}

/* --------------------------------------------------------------- intro */

/**
 * How lively each candidate moment is: the contrast within a small frame and the motion against a frame a
 * beat later. Decoded at thumbnail size from whichever file is handed over (a proxy, ideally).
 */
export async function scanMoments(fileFor: (mediaId: string) => Promise<File | null>, project: Project, windows: Moment[][], opts: { beat?: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<Map<Moment, { motion: number; contrast: number }>> {
  const beat = opts.beat ?? 0.4;
  const all = windows.flat();
  const stats = new Map<Moment, { motion: number; contrast: number }>();
  const W = 64, H = 36;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const luma = (img: CanvasImageSource) => {
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  };
  const byMedia = new Map<string, Moment[]>();
  for (const m of all) {
    const clip = project.clips.find((c) => c.id === m.clipId);
    if (!clip) continue;
    const list = byMedia.get(clip.media) ?? [];
    list.push(m);
    byMedia.set(clip.media, list);
  }
  let done = 0;
  for (const [mediaId, moments] of byMedia) {
    const f = await fileFor(mediaId);
    if (!f) continue;
    const input = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) continue;
    const sink = new VideoSampleSink(track);
    const media = project.media[mediaId];
    for (const m of moments.sort((a, b) => a.sourceTime - b.sourceTime)) {
      if (opts.signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const a = await sink.getSample(m.sourceTime);
      const b = await sink.getSample(Math.max(0, Math.min((media?.duration ?? m.sourceTime + beat) - 0.05, m.sourceTime + beat)));
      if (a && b) {
        const la = luma(a.toCanvasImageSource()), lb = luma(b.toCanvasImageSource());
        let mean = 0;
        for (const v of la) mean += v;
        mean /= la.length;
        let varSum = 0, diff = 0;
        for (let i = 0; i < la.length; i++) {
          varSum += (la[i] - mean) ** 2;
          diff += Math.abs(la[i] - lb[i]);
        }
        stats.set(m, { contrast: Math.sqrt(varSum / la.length) / 128, motion: diff / la.length / 255 });
      }
      a?.close();
      b?.close();
      done++;
      opts.onProgress?.(done, all.length);
    }
  }
  return stats;
}

/** Small styled stills of the intro's scenes (and card), keyed by clip id, as JPEG object URLs the caller revokes. */
export async function renderSceneThumbs(fileFor: (mediaId: string) => Promise<File | null>, project: Project, clips: Clip[], height = 72, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height || !clips.length) return out;
  const h = height, w = Math.round((first.width * h) / first.height / 2) * 2;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const grader = new Grader(w, h);
  const scratch = { a: new OffscreenCanvas(w, h), b: new OffscreenCanvas(w, h) };
  const style = introStyle(project.intro.style);
  const sinks = new Map<string, { sink: VideoSampleSink; w: number; h: number }>();
  const scenes = clips.filter((c) => c.introRole === "scene");
  for (const c of clips) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    let s = sinks.get(c.media);
    if (!s) {
      const f = await fileFor(c.media);
      if (!f) continue;
      const track = await new Input({ source: new BlobSource(f), formats: ALL_FORMATS }).getPrimaryVideoTrack();
      if (!track) continue;
      s = { sink: new VideoSampleSink(track), w: track.displayWidth, h: track.displayHeight };
      sinks.set(c.media, s);
    }
    const sample = await s.sink.getSample(c.in + (c.out - c.in) * (c.introRole === "card" ? 0.5 : 0.35));
    if (!sample) continue;
    grader.draw(sample.toCanvasImageSource(), styledGrade(c.grade, style), c.transform, s.w, s.h);
    sample.close();
    ctx.drawImage(grader.canvas, 0, 0, w, h);
    const length = Math.max(0.01, (c.out - c.in) / clipSpeed(c));
    const frame: IntroFrame = { style, role: c.introRole === "card" ? "card" : "scene", index: c.introRole === "card" ? scenes.length : scenes.indexOf(c), count: scenes.length, local: length * 0.6, length, introT: 10, introLength: 20 };
    drawIntroFx(ctx, w, h, frame, project, scratch);
    out.set(c.id, URL.createObjectURL(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 })));
  }
  return out;
}

/** Whether this browser can hardware-encode the project's codec at a given size. */
export async function encoderSupport(width: number, height: number): Promise<{ hevc: boolean; avc: boolean }> {
  const [hevc, avc] = await Promise.all([canEncodeVideo("hevc", { width, height, bitrate: 100e6 }).catch(() => false), canEncodeVideo("avc", { width, height, bitrate: 100e6 }).catch(() => false)]);
  return { hevc, avc };
}

export type { ExportSpan, Clip, MediaRef, Title };
export { EncodedPacketSink, EncodedVideoPacketSource };

/**
 * How much the picture changes through a recording: the mean absolute luma difference between 64×36 frames taken every
 * `step` seconds, 0–1. Every frame is decoded (the sink runs in order), so proxies make this many times faster than 8K.
 */
export async function scanMotion(file: File, opts: { step?: number; signal?: AbortSignal; onProgress?: (seconds: number, total: number) => void } = {}): Promise<MotionTrace> {
  const step = opts.step ?? 0.25;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track in this file.");
  const total = await input.computeDuration();
  const W = 64, H = 36;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const luma = (img: CanvasImageSource) => {
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  };
  const sink = new VideoSampleSink(track);
  const scores: number[] = [];
  let prev: Float32Array | null = null;
  let next = 0, lastReport = -1;
  for await (const sample of sink.samples()) {
    if (opts.signal?.aborted) {
      sample.close();
      throw new DOMException("Cancelled", "AbortError");
    }
    const t = sample.timestamp;
    if (t + 1e-6 >= next) {
      const l = luma(sample.toCanvasImageSource());
      if (prev) {
        let d = 0;
        for (let i = 0; i < l.length; i++) d += Math.abs(l[i] - prev[i]);
        scores.push(d / l.length / 255);
      }
      prev = l;
      next = Math.floor(t / step + 1e-6) * step + step;
      if (t - lastReport >= 1) {
        lastReport = t;
        opts.onProgress?.(t, total);
      }
    }
    sample.close();
  }
  opts.onProgress?.(total, total);
  return { step, scores };
}
