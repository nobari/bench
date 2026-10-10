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
import { TITLE_FONTS, dbToGain, exportRange, isFileLutKind, musicGainAt, placeClips, planExport, transitionAt, transitionWindows, type Clip, type ExportSpan, type Grade, type LutKind, type MediaRef, type PlacedClip, type Project, type Title, type Transform, type TransitionWindow } from "./project";
import { drawTransition } from "./transitions";

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

/* ------------------------------------------------------------- overlays */

/** One title (text + optional subtitle) at its anchor, with its colour, font, size and optional backing box. */
function drawTitleBlock(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, title: Title) {
  const font = TITLE_FONTS[title.font] ?? TITLE_FONTS.sans;
  const px = Math.max(8, Math.round(h * title.size));
  const pad = w * 0.04;
  const lines = [{ text: title.text, size: px, weight: 600, alpha: 1 }];
  if (title.subtitle) lines.push({ text: title.subtitle, size: Math.round(px * 0.5), weight: 400, alpha: 0.85 });
  const gap = px * 0.35;
  const widths = lines.map((l) => {
    ctx.font = `${l.weight} ${l.size}px ${font}`;
    return ctx.measureText(l.text).width;
  });
  const blockW = Math.max(...widths), blockH = lines.reduce((a, l) => a + l.size, 0) + gap * (lines.length - 1);
  const row = title.position[0], col = title.position[1];
  const x = col === "l" ? pad : col === "r" ? w - pad - blockW : (w - blockW) / 2;
  const y = row === "t" ? pad : row === "b" ? h - pad - blockH : (h - blockH) / 2;
  const base = ctx.globalAlpha;
  if (title.background) {
    const bp = px * 0.4;
    ctx.fillStyle = title.background;
    ctx.fillRect(x - bp, y - bp, blockW + bp * 2, blockH + bp * 2);
  } else {
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = px * 0.15;
  }
  ctx.textBaseline = "top";
  ctx.textAlign = col === "l" ? "left" : col === "r" ? "right" : "center";
  const tx = col === "l" ? x : col === "r" ? x + blockW : x + blockW / 2;
  let cy = y;
  for (const l of lines) {
    ctx.font = `${l.weight} ${l.size}px ${font}`;
    ctx.fillStyle = title.color;
    ctx.globalAlpha = base * l.alpha;
    ctx.fillText(l.text, tx, cy);
    cy += l.size + gap;
  }
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
    if (here && !here.muted && project.media[here.media]?.hasAudio) {
      const g = dbToGain(here.gainDb);
      const s = await pull(here.media, here.in + (t - here.start), n);
      for (let i = 0; i < n * 2; i++) mix[i] += s[i] * g;
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
  onProgress?: (p: { phase: "video" | "audio" | "finalize"; fraction: number; span?: ExportSpan; message?: string }) => void;
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
      const from = Math.max(0, clip.in + (window.start - clip.start)), to = clip.in + (window.end - clip.start) + 0.5;
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

export async function exportProject(opts: ExportOptions): Promise<{ bytesWritten: number; seconds: number }> {
  const { project, getFile, logo, signal } = opts;
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height) throw new Error("Add at least one video clip.");
  const outH = project.export.resolution === "source" ? first.height : project.export.resolution;
  const outW = Math.round((first.width * (outH / first.height)) / 2) * 2;
  const fps = first.fps || 30;
  const codec: VideoCodec = project.export.codec;
  const bitrate = project.export.bitrateMbps * 1e6;
  if (!(await canEncodeVideo(codec, { width: outW, height: outH, bitrate }))) throw new Error(`This browser can't encode ${codec.toUpperCase()} at ${outW}×${outH}. Try the other codec or a lower resolution.`);
  const spans = planExport(project);
  const total = spans.reduce((a, s) => a + (s.end - s.start), 0);
  // A partial export starts its file at zero: timeline times shift back by the range start.
  const offset = exportRange(project)?.from ?? 0;
  const windows = transitionWindows(placeClips(project.clips));
  const neighbour = new NeighbourFrames((id) => openInput(id));
  let tmpA: OffscreenCanvas | null = null, tmpB: OffscreenCanvas | null = null, scratch: OffscreenCanvas | null = null;
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(opts.writable, { chunked: true }) });
  const canvas = new OffscreenCanvas(outW, outH);
  const ctx2d = canvas.getContext("2d")!;
  const grader = new Grader(outW, outH);
  if (project.customLut) {
    try {
      grader.setCustomLut(parseCube(project.customLut.cube));
    } catch {
      /* unreadable .cube: those clips export unconverted, as the preview showed */
    }
  }
  if (project.clips.some((c) => isFileLutKind(c.grade.lut))) {
    const base = await fetchOfficialLut();
    grader.provideLut("dji-official", deriveLut(base, "dji-official"));
    grader.provideLut("dji-official-study", deriveLut(base, "dji-official-study"));
  }
  const videoSource = new CanvasSource(canvas, { codec, bitrate, keyFrameInterval: 2, latencyMode: PRESET_LATENCY[project.export.preset], hardwareAcceleration: "prefer-hardware" });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const sampleRate = 48000;
  const audioSource = new AudioSampleSource({ codec: "aac", bitrate: project.export.audioBitrateKbps * 1000 });
  output.addAudioTrack(audioSource);
  await output.start();
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
  for (const span of spans) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const clip = project.clips.find((c) => c.id === span.clipId)!;
    const media = project.media[clip.media];
    const input = await openInput(clip.media);
    const track = (await input.getPrimaryVideoTrack())!;
    const progress = (sourceT: number) => opts.onProgress?.({ phase: "video", fraction: Math.min(1, (written + (sourceT - span.sourceIn)) / Math.max(1e-6, total)), span });
    // A copy span is only truly copyable if the encoder/container accept the source packets; we re-encode here
    // frame-accurately instead, but skip the GPU grade (identity draw) so it is still much faster than a graded span.
    const sink = new VideoSampleSink(track);
    const srcW = media.width ?? track.displayWidth, srcH = media.height ?? track.displayHeight;
    for await (const sample of sink.samples(span.sourceIn, span.sourceOut)) {
      if (signal?.aborted) {
        sample.close();
        throw new DOMException("Cancelled", "AbortError");
      }
      const timelineT = span.start + (sample.timestamp - span.sourceIn);
      const tr = windows.length && span.kind === "encode" ? transitionAt(windows, timelineT) : null;
      let composed = false;
      if (tr) {
        // Inside a transition: grade both sides, then composite them.
        const outgoingIsThis = tr.window.outgoing.id === clip.id;
        const other = outgoingIsThis ? tr.window.incoming : tr.window.outgoing;
        const frame = await neighbour.frameAt(other, tr.window, other.in + (timelineT - other.start));
        if (frame) {
          tmpA ??= new OffscreenCanvas(outW, outH);
          tmpB ??= new OffscreenCanvas(outW, outH);
          scratch ??= new OffscreenCanvas(outW, outH);
          const om = project.media[other.media];
          grader.draw(sample.toCanvasImageSource(), clip.grade, clip.transform, srcW, srcH);
          tmpA.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          grader.draw(frame.toCanvasImageSource(), other.grade, other.transform, om?.width ?? frame.displayWidth, om?.height ?? frame.displayHeight);
          tmpB.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          drawTransition(ctx2d, outgoingIsThis ? tmpA : tmpB, outgoingIsThis ? tmpB : tmpA, outW, outH, tr.window.kind, tr.progress, scratch);
          composed = true;
        }
      }
      if (!composed && span.kind === "encode") {
        grader.draw(sample.toCanvasImageSource(), clip.grade, clip.transform, srcW, srcH);
        ctx2d.drawImage(grader.canvas, 0, 0, outW, outH);
      } else if (!composed) {
        ctx2d.drawImage(sample.toCanvasImageSource(), 0, 0, outW, outH);
      }
      drawOverlays(ctx2d, outW, outH, timelineT, project, logo);
      await videoSource.add(timelineT - offset, sample.duration || 1 / fps);
      progress(sample.timestamp);
      sample.close();
    }
    written += span.end - span.start;
  }
  await neighbour.reset();
  videoSource.close();
  // Audio.
  await mixAudio({ project, getFile, sampleRate }, offset, offset + total, async (samples, timestamp) => {
    opts.onProgress?.({ phase: "audio", fraction: Math.min(1, (timestamp - offset) / Math.max(1e-6, total)) });
    const s = new AudioSample({ data: samples, format: "f32", numberOfChannels: 2, sampleRate, timestamp: timestamp - offset });
    await audioSource.add(s);
    s.close();
  }, signal);
  audioSource.close();
  opts.onProgress?.({ phase: "finalize", fraction: 1 });
  await output.finalize();
  return { bytesWritten: 0, seconds: total };
}

/** Whether this browser can hardware-encode the project's codec at a given size. */
export async function encoderSupport(width: number, height: number): Promise<{ hevc: boolean; avc: boolean }> {
  const [hevc, avc] = await Promise.all([canEncodeVideo("hevc", { width, height, bitrate: 100e6 }).catch(() => false), canEncodeVideo("avc", { width, height, bitrate: 100e6 }).catch(() => false)]);
  return { hevc, avc };
}

export type { ExportSpan, Clip, MediaRef, Title };
export { EncodedPacketSink, EncodedVideoPacketSource };
