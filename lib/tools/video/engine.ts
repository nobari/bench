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
  type InputVideoTrack,
  type VideoSample,
  canEncodeVideo,
  type StreamTargetChunk,
  type VideoCodec,
} from "mediabunny";
import {
  GRADE_FRAGMENT_SHADER,
  buildDlogLut,
  deriveLut,
  fetchOfficialLut,
  lutTexture,
  parseCube,
  type Lut3D,
} from "./lut";
import {
  clipAt,
  clipSpeed,
  sourceTimeAt,
  dbToGain,
  exportTags,
  fontFamilyCss,
  exportRange,
  isFileLutKind,
  FILE_LUT_KINDS,
  musicGainAt,
  placeClips,
  planExport,
  transitionAt,
  transitionWindows,
  type Clip,
  type ExportSpan,
  type Grade,
  type LutKind,
  type MediaRef,
  type PlacedClip,
  type Project,
  type Title,
  type Transform,
  type TransitionWindow,
  STEADY_FRAMES,
} from "./project";
import { drawTransition } from "./transitions";
import {
  drawIntroFx,
  introFrameAt,
  introStyle,
  styledGrade,
  type IntroFrame,
  type Moment,
  introBlendAt,
} from "./intro";
import {
  ProgressTracker,
  defaultSpeeds,
  fmtBytes,
  fmtMs,
  planSteps,
  type ExportProgress,
  type SpeedPriors,
  type StepProgress,
} from "./progress";
import pkg from "@/package.json";
import type { MotionTrace } from "./stops";
import { isSpaceError } from "./space";

/** The drive refused a write: the export stops at the last finished part, and the editor can tell why. */
const spaceStop = (cause: unknown) => {
  // the stream's stored error comes back through every later write and close: already ours, pass it on as it is
  if (cause instanceof DOMException && cause.name === "QuotaExceededError" && cause.message.startsWith("The drive holding")) return cause;
  const why = (cause as { message?: string } | null)?.message || (cause as { name?: string } | null)?.name || "no room";
  return new DOMException(`The drive holding the project folder refused a write (${why}): it is full.`, "QuotaExceededError");
};
import { LoudnessMeter, softLimit, type Loudness } from "./loudness";
import { patchKindType } from "./tags";

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
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  // A clip is as long as its picture. DJI's audio (and so the container) runs a few frames past the last video
  // frame; a clip planned to that length would end on nothing to show, and an export planned from it could never
  // reach its own end.
  const duration = video ? await video.computeDuration() : await input.computeDuration();
  if (!video)
    return {
      duration,
      width: 0,
      height: 0,
      fps: 0,
      codec: null,
      rotation: 0,
      hasAudio: !!audio,
      sampleRate: audio?.sampleRate,
      canDecode: false,
    };
  const stats = await video.computePacketStats(200);
  return {
    duration,
    width: video.displayWidth,
    height: video.displayHeight,
    fps: Math.round(stats.averagePacketRate * 1000) / 1000,
    codec: video.codec,
    rotation: video.rotation,
    hasAudio: !!audio,
    sampleRate: audio?.sampleRate,
    canDecode: await video.canDecode(),
  };
}

/* ------------------------------------------------------------- proxies */

/**
 * An H.264 proxy of a source file at the chosen height, with the clip's own
 * sound as AAC, written to `writable` as it encodes. The preview plays this
 * instead of the 8K original; export never touches it.
 */
export async function buildProxy(
  file: File,
  writable: WritableStream<StreamTargetChunk>,
  height: number,
  onProgress?: (p: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track.");
  const scale = Math.min(1, height / track.displayHeight);
  const w = Math.round((track.displayWidth * scale) / 2) * 2,
    h = Math.round((track.displayHeight * scale) / 2) * 2;
  const duration = await input.computeDuration();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new StreamTarget(writable, { chunked: true }),
  });
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  // Bitrate follows the picture size: ~4 Mbit/s at 1080p, ~0.5 at 360p. Realtime mode keeps the encoder responsive.
  const source = new CanvasSource(canvas, {
    codec: "avc",
    bitrate: Math.round(h * h * 3.6),
    keyFrameInterval: 1,
    latencyMode: "realtime",
  });
  output.addVideoTrack(source, { frameRate: 30 });
  const audioTrack = await input.getPrimaryAudioTrack();
  const audioSource =
    audioTrack && (await audioTrack.canDecode())
      ? new AudioSampleSource({ codec: "aac", bitrate: 96000 })
      : null;
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
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
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
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) ?? "shader error");
      return sh;
    };
    this.program = gl.createProgram()!;
    gl.attachShader(this.program, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(
      this.program,
      compile(gl.FRAGMENT_SHADER, GRADE_FRAGMENT_SHADER),
    );
    gl.linkProgram(this.program);
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(this.program) ?? "link error");
    gl.useProgram(this.program);
    const quad = new Float32Array([
      -1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0,
    ]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(this.program, "aPos"),
      aUv = gl.getAttribLocation(this.program, "aUv");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 16, 8);
    for (const u of [
      "uFrame",
      "uLut",
      "uLutSize",
      "uUseLut",
      "uExposure",
      "uTemperature",
      "uTint",
      "uContrast",
      "uSaturation",
      "uTransform",
    ])
      this.uniforms[u] = gl.getUniformLocation(this.program, u);
    this.frameTex = gl.createTexture()!;
    this.lutTex = gl.createTexture()!;
    for (const [tex, unit] of [
      [this.frameTex, 0],
      [this.lutTex, 1],
    ] as const) {
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
    const lut =
      kind === "custom"
        ? this.custom
        : isFileLutKind(kind)
          ? (this.luts[kind] ?? null)
          : (this.luts[kind] ??= buildDlogLut(kind));
    if (!lut) return false;
    if (this.lutLoaded === kind) return true;
    const { width, height, data } = lutTexture(lut);
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lutTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      width,
      height,
      0,
      gl.RGBA,
      gl.FLOAT,
      data,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    this.lutLoaded = kind;
    this.lutSize = lut.size;
    return true;
  }

  /** Draw a source image with the grade and transform into this.canvas. */
  draw(
    src: CanvasImageSource | VideoFrame,
    grade: Grade,
    transform: Transform,
    srcW: number,
    srcH: number,
  ) {
    const gl = this.gl;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    // The quad's texture coordinates already put the frame the right way up; flipping here would invert it.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      src as TexImageSource,
    );
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
    const aspectSrc = srcW / srcH,
      aspectDst = this.canvas.width / this.canvas.height;
    // Scale so the cropped region fills the output; straightening zooms in slightly to hide corners.
    const zoom =
      1 +
      Math.abs(Math.sin(straighten * (Math.PI / 180))) *
        Math.max(aspectSrc, 1 / aspectSrc);
    const sx = (1 / crop.w) * zoom,
      sy = (1 / crop.h) * zoom;
    const cx = (crop.x + crop.w / 2) * 2 - 1,
      cy = 1 - (crop.y + crop.h / 2) * 2;
    const cos = Math.cos(a),
      sin = Math.sin(a);
    // Aspect-correct rotation: rotate in square space then restore aspect.
    const ar = quarter ? aspectSrc : 1;
    const m = [
      sx * cos * (quarter ? 1 / aspectDst : 1) * (quarter ? ar : 1),
      sx * sin * (quarter ? 1 : aspectDst),
      0,
      -sy * sin * (quarter ? 1 / aspectDst : 1),
      sy * cos,
      0,
      -cx * sx,
      -cy * sy,
      1,
    ];
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

  constructor(
    width: number,
    height: number,
    readonly frames: 2 | 3,
  ) {
    this.canvas = new OffscreenCanvas(width, height);
    const gl = this.canvas.getContext("webgl2", {
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS))
        throw new Error(gl.getShaderInfoLog(sh) ?? "shader");
      return sh;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, STEADY_VS));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, STEADY_FS));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(program) ?? "program");
    gl.useProgram(program);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aPos = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    for (const name of ["uCur", "uP1", "uP2", "uFrames", "uHave"])
      this.uniforms[name] = gl.getUniformLocation(program, name);
    for (let k = 0; k < 3; k++) {
      const t = gl.createTexture()!;
      gl.activeTexture(gl.TEXTURE0 + k);
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        width,
        height,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null,
      );
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
    const cur = this.i,
      p1 = (this.i + 2) % 3,
      p2 = (this.i + 1) % 3;
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex[cur]);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      src as TexImageSource,
    );
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
function drawTitleBlock(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  title: Title,
) {
  const family = fontFamilyCss(title.font);
  const px = Math.max(8, Math.round(h * title.size));
  const pad = w * 0.04;
  const style = (size: number, weight: number) =>
    `${title.italic ? "italic " : ""}${weight} ${size}px ${family}`;
  const lines = [
    { text: title.text, size: px, weight: title.weight, alpha: 1 },
  ];
  if (title.subtitle)
    lines.push({
      text: title.subtitle,
      size: Math.round(px * 0.5),
      weight: Math.max(300, title.weight - 200),
      alpha: 0.85,
    });
  const gap = px * 0.35;
  const c = ctx as OffscreenCanvasRenderingContext2D & {
    letterSpacing?: string;
  };
  if ("letterSpacing" in c) c.letterSpacing = `${title.letterSpacing}em`;
  const widths = lines.map((l) => {
    ctx.font = style(l.size, l.weight);
    return ctx.measureText(l.text).width;
  });
  const blockW = Math.max(...widths),
    blockH = lines.reduce((a, l) => a + l.size, 0) + gap * (lines.length - 1);
  const row = title.position[0],
    col = title.position[1];
  const x =
    col === "l" ? pad : col === "r" ? w - pad - blockW : (w - blockW) / 2;
  const y =
    row === "t" ? pad : row === "b" ? h - pad - blockH : (h - blockH) / 2;
  const base = ctx.globalAlpha;
  // The box: padding, corners and a border, drawn without any text shadow.
  const bp = px * title.padding,
    bw = px * title.borderWidth;
  if (title.background || bw > 0) {
    ctx.shadowColor = "transparent";
    ctx.beginPath();
    ctx.roundRect(
      x - bp,
      y - bp,
      blockW + bp * 2,
      blockH + bp * 2,
      px * title.radius,
    );
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
  const align =
    title.align === "auto"
      ? col === "l"
        ? "left"
        : col === "r"
          ? "right"
          : "center"
      : title.align;
  ctx.textAlign = align;
  const tx =
    align === "left" ? x : align === "right" ? x + blockW : x + blockW / 2;
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
export function drawOverlays(
  ctx: OffscreenCanvasRenderingContext2D,
  w: number,
  h: number,
  t: number,
  project: Project,
  logo: ImageBitmap | null,
) {
  for (const title of project.titles) {
    if (t < title.start || t > title.start + title.duration) continue;
    const local = t - title.start;
    const fadeIn = title.fade > 0 ? Math.min(1, local / title.fade) : 1;
    const fadeOut =
      title.fade > 0
        ? Math.min(1, (title.start + title.duration - t) / title.fade)
        : 1;
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
    const lw = w * size,
      lh = (logo.height / logo.width) * lw,
      m = w * margin;
    const x = corner.endsWith("l") ? m : w - m - lw,
      y = corner.startsWith("t") ? m : h - m - lh;
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
export const MIN_AUDIBLE_SPEED = 0.25,
  MAX_AUDIBLE_SPEED = 4;

export async function mixAudio(
  input: MixInput,
  from: number,
  to: number,
  onBlock: (samples: Float32Array, timestamp: number) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
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
    const o: Opened = {
      sink: new AudioSampleSink(track),
      sampleRate: track.sampleRate,
      buf: new Float32Array(0),
      bufStart: 0,
    };
    opened.set(mediaId, o);
    return o;
  };
  // Pull stereo samples for [t, t+n) from a source at source time; simple nearest-sample resampling.
  const pull = async (
    mediaId: string,
    sourceT: number,
    n: number,
  ): Promise<Float32Array> => {
    const o = await open(mediaId);
    const out = new Float32Array(n * 2);
    if (!o) return out;
    const needStart = sourceT,
      needEnd = sourceT + n / sampleRate;
    if (!o.iter || needStart < o.bufStart) {
      // Let the old generator release the sample it has decoded ahead before starting over.
      await o.iter?.return(undefined);
      o.iter = o.sink.samples(Math.max(0, needStart - 0.05));
      o.buf = new Float32Array(0);
      o.bufStart = needStart;
    }
    while (o.bufStart + o.buf.length / 2 / o.sampleRate < needEnd) {
      const { value, done } = await o.iter.next();
      if (done || !value) break;
      const frames = value.numberOfFrames,
        ch = value.numberOfChannels;
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
      const keepFrom = Math.max(
        0,
        Math.floor((needStart - 0.5 - o.bufStart) * o.sampleRate),
      );
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
  try {
    for (let t = from; t < to; t += block / sampleRate) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const n = Math.min(block, Math.round((to - t) * sampleRate));
      const mix = new Float32Array(n * 2);
      // Original audio from whichever clip is under this block.
      const here = placed.find((c) => t >= c.start && t < c.end);
      const hereSpeed = here ? clipSpeed(here) : 1;
      if (
        here &&
        !here.muted &&
        project.media[here.media]?.hasAudio &&
        hereSpeed >= MIN_AUDIBLE_SPEED &&
        hereSpeed <= MAX_AUDIBLE_SPEED
      ) {
        const g = dbToGain(here.gainDb);
        if (hereSpeed === 1) {
          const s = await pull(here.media, sourceTimeAt(here, t), n);
          for (let i = 0; i < n * 2; i++) mix[i] += s[i] * g;
        } else {
          // Sped-up or slowed footage: read the matching stretch of source audio and resample it to this block (pitch follows).
          const srcN = Math.ceil(n * hereSpeed) + 1;
          const s = await pull(here.media, sourceTimeAt(here, t), srcN);
          for (let i = 0; i < n; i++) {
            const x = i * hereSpeed,
              j = Math.min(srcN - 2, Math.floor(x)),
              f = x - j;
            mix[i * 2] += (s[j * 2] * (1 - f) + s[(j + 1) * 2] * f) * g;
            mix[i * 2 + 1] +=
              (s[j * 2 + 1] * (1 - f) + s[(j + 1) * 2 + 1] * f) * g;
          }
        }
      }
      for (const m of project.music) {
        if (
          m.muted ||
          t + n / sampleRate < m.start ||
          t > m.start + (m.out - m.in)
        )
          continue;
        const s = await pull(m.media, m.in + (t - m.start), n);
        for (let i = 0; i < n; i++) {
          const g = musicGainAt(m, project.music, t + i / sampleRate, to);
          mix[i * 2] += s[i * 2] * g;
          mix[i * 2 + 1] += s[i * 2 + 1] * g;
        }
      }
      // The limiter: nothing under −1.4 dBFS is touched, anything above is eased into the last stretch below full scale.
      for (let i = 0; i < mix.length; i++) mix[i] = softLimit(mix[i]);
      await onBlock(mix, t);
    }
  } finally {
    // Every decoder's generator holds a sample decoded ahead; returning it closes that sample instead of leaking it.
    for (const o of opened.values())
      await o.iter?.return(undefined).catch(() => undefined);
  }
}

/* ------------------------------------------------------------------ export */

/** Something worth a line in the export's log: a part written, a stretch skipped, the join starting. */
export interface ExportEvent {
  at: number;
  kind: "part" | "skip" | "join";
  text: string;
}
export interface ExportOptions {
  project: Project;
  getFile: (mediaId: string) => Promise<File | null>;
  logo: ImageBitmap | null;
  writable: WritableStream<StreamTargetChunk>;
  onProgress?: (p: ExportProgress) => void;
  /** Awaited between frames and audio blocks: return a promise while paused, nothing otherwise. */
  whilePaused?: () => Promise<void> | void;
  /** A write failed, most likely because the disk is full: resolve once the user has made room and the chunk is retried. */
  /** The drive refused a write for lack of room: the output being written is lost and the export stops at the last finished part once this returns. */
  onWriteBlocked?: (error: unknown) => Promise<void>;
  /** Speeds from an earlier export on this machine, to estimate from before anything is measured. */
  priors?: SpeedPriors;
  signal?: AbortSignal;
  /** Called with every video frame's timeline time as it is handed to the encoder (tests check they only go forward). */
  onFrame?: (timelineT: number) => void;
  /** The frame just composed, a few times a second at most, for a live view: the engine's own canvas and the frame's timeline time. */
  onPreview?: (frame: OffscreenCanvas, timelineT: number) => void;
  /** Lines for a log of what happened along the way. */
  onEvent?: (event: ExportEvent) => void;
  /**
   * Resumable export: finished stretches of video go to numbered part files (one every `seconds` of timeline,
   * 180 by default, and whatever was done when the export stops) and into the manifest; the file is joined from
   * the parts at the end. A manifest with parts in it continues from where they end.
   */
  parts?: {
    store: PartStore;
    manifest: ExportManifest;
    seconds?: number;
    /** Free space on the disk as the browser reports it; with less than the file needs, parts are removed as they go in. */
    freeSpace?: () => Promise<number | null>;
    onJoin?: (info: JoinInfo) => void;
    /** Tests only: force the join mode, and fail the join after this many parts. */
    testJoinMode?: "keep" | "remove";
    testFailJoinAfter?: number;
  };
  /**
   * A frame failed. Answer "skip" to leave that stretch out and carry on (the export waits for the answer), or
   * "stop" to end with what is done. Without this, the error ends the export.
   */
  onFault?: (fault: ExportFault) => Promise<"skip" | "stop">;
}

/** A finished part of a resumable export: a video-only MP4 covering [start, end) of the export's time. */
export interface ExportPart {
  file: string;
  start: number;
  end: number;
  frames: number;
  /** Already copied into a file that was not finished, and removed to make room: the stretch is exported again. */
  consumed?: boolean;
}

export interface ExportManifest {
  version: 1;
  /** A hash of everything that shapes the file; a changed project cannot continue these parts. */
  fingerprint: string;
  /** The output file's name. */
  name: string;
  /** Length of the export in seconds. */
  total: number;
  parts: ExportPart[];
  /** Stretches of the export's time left out on the user's say-so after a frame failed. */
  skipped: { from: number; to: number; message: string }[];
  /** Number of the next part file, so names stay unique across runs. */
  nextPart?: number;
  updatedAt: number;
}

export interface JoinInfo {
  /** "remove": each part is removed as soon as it is in the file, so the file needs no extra room beyond one part. */
  mode: "keep" | "remove";
  /** Bytes in the parts, and free space as reported, when the join began. */
  bytes: number;
  free: number | null;
  parts: number;
}

/** Where a resumable export keeps its parts and manifest. */
export interface PartStore {
  createWritable(file: string): Promise<WritableStream<StreamTargetChunk>>;
  file(file: string): Promise<File | null>;
  remove(file: string): Promise<void>;
  save(manifest: ExportManifest): Promise<void>;
}

export interface ExportFault {
  /** Timeline time of the frame that failed. */
  timelineT: number;
  /** Where in the footage it is. */
  sourceT: number;
  clipName: string;
  message: string;
  /** How many frames have failed in this export, this one included. */
  count: number;
  /** Seconds of timeline that "skip" leaves out: one frame, or up to the next keyframe when the decoder failed. */
  stretch: number;
}

/** A part file every so often, so a crash costs minutes, not hours. */
export const PART_SECONDS = 180;
const MAX_FAULTS = 300;

/** The spans from `from` on, the first one cut to start there. */
function trimSpans(list: ExportSpan[], from: number): ExportSpan[] {
  return list.flatMap((s) => {
    const s0 = Math.max(s.start, from);
    if (s.end - s0 <= 1e-6) return [];
    return s0 === s.start ? [s] : [{ ...s, sourceIn: s.sourceIn + (s0 - s.start) * (s.speed || 1), start: s0 }];
  });
}

const PRESET_LATENCY: Record<
  Project["export"]["preset"],
  "quality" | "realtime"
> = { quality: "quality", balanced: "quality", fast: "realtime" };

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

  async frameAt(
    clip: PlacedClip,
    window: TransitionWindow,
    sourceT: number,
  ): Promise<VideoSample | null> {
    const key = `${clip.id}@${window.cut}`;
    if (key !== this.key) {
      await this.reset();
      this.key = key;
      const track = await (
        await this.openInput(clip.media)
      ).getPrimaryVideoTrack();
      if (!track) return null;
      // Starts a touch early, so a side whose footage ends where the window starts still has a last frame to hold.
      const from = Math.max(0, sourceTimeAt(clip, window.start) - 0.25),
        to = sourceTimeAt(clip, window.end) + 0.5;
      this.iter = new VideoSampleSink(track)
        .samples(from, to)
        [Symbol.asyncIterator]();
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
  /** Stretches left out after frames failed (resumable exports remember them across runs). */
  skipped: ExportManifest["skipped"];
  /** Part files joined into the file (0 for a single-file export). */
  parts: number;
  /** Where this run started in the export's time (0 unless it continued earlier parts). */
  resumedFrom: number;
  join?: JoinInfo;
}

/** The spans inside [from, to), cut to fit. */
function trimSpansTo(list: ExportSpan[], from: number, to: number): ExportSpan[] {
  return trimSpans(list, from).flatMap((s) => {
    const e0 = Math.min(s.end, to);
    if (e0 - s.start <= 1e-6) return [];
    return e0 === s.end ? [s] : [{ ...s, sourceOut: s.sourceOut - (s.end - e0) * (s.speed || 1), end: e0 }];
  });
}

export async function exportProject(
  opts: ExportOptions,
): Promise<ExportResult> {
  // A 250 ms pulse keeps the panel's clocks moving through the stages that report nothing of their own.
  const pulse: { emit: (() => void) | null } = { emit: null };
  const ticker = setInterval(() => pulse.emit?.(), 250);
  try {
    return await exportWithPulse(opts, pulse);
  } finally {
    clearInterval(ticker);
  }
}

async function exportWithPulse(
  opts: ExportOptions,
  pulse: { emit: (() => void) | null },
): Promise<ExportResult> {
  const { project, getFile, logo, signal } = opts;
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height)
    throw new Error("Add at least one video clip.");
  const outH =
    project.export.resolution === "source"
      ? first.height
      : project.export.resolution;
  const outW = Math.round((first.width * (outH / first.height)) / 2) * 2;
  const fps = first.fps || 30;
  const codec: VideoCodec = project.export.codec;
  const bitrate = project.export.bitrateMbps * 1e6;
  const spansAll = planExport(project);
  const total = spansAll.reduce((a, s) => a + (s.end - s.start), 0);
  // A partial export starts its file at zero: timeline times shift back by the range start.
  const offset = exportRange(project)?.from ?? 0;
  const parts = opts.parts ?? null;
  const manifest = parts?.manifest ?? null;
  const partSeconds = parts?.seconds ?? PART_SECONDS;
  // Continuing earlier parts: this run covers the gaps between them — normally just the tail after the last part, but
  // also any stretch whose part was consumed by a join that did not finish.
  if (manifest) manifest.parts = manifest.parts.filter((p) => !p.consumed).sort((a, b) => a.start - b.start);
  const gaps: { from: number; to: number; before: number }[] = [];
  {
    let pos = 0, before = 0;
    for (const p of manifest?.parts ?? []) {
      if (p.start > pos + 1e-3) {
        gaps.push({ from: pos, to: p.start, before });
        before += p.start - pos;
      }
      pos = Math.max(pos, p.end);
    }
    if (total - pos > 1e-3) gaps.push({ from: pos, to: total, before });
  }
  const resumeFrom = gaps.length && gaps[0].from === 0 && gaps.length === 1 ? 0 : (manifest?.parts.length ? Math.max(...manifest.parts.map((p) => p.end)) : 0);
  const spans = gaps.flatMap((g) => trimSpansTo(spansAll, offset + g.from, offset + g.to));
  const remaining = gaps.reduce((a, g) => a + (g.to - g.from), 0);
  /** Work finished before export time t, for the progress bar: the gaps before it plus the way into its own. */
  const progressAt = (t: number) => {
    const g = gaps.find((x) => t < x.to + 1e-6) ?? gaps[gaps.length - 1];
    return g ? g.before + Math.max(0, Math.min(t, g.to) - g.from) : 0;
  };
  const needsFileLut = project.clips.some((c) => isFileLutKind(c.grade.lut));
  const lutsToLoad = [
    needsFileLut ? "DJI's conversion file" : "",
    project.customLut && project.clips.some((c) => c.grade.lut === "custom")
      ? `the custom .cube (${project.customLut.name})`
      : "",
  ].filter(Boolean);
  const steps = planSteps({
    spans,
    clipName: (id) =>
      project.media[project.clips.find((c) => c.id === id)?.media ?? ""]
        ?.name ?? id,
    lutsToLoad,
    audio: {
      clips: project.clips.filter((c) => !c.muted && c.gainDb > -60).length,
      music: project.music.filter((m) => !m.muted).length,
      bitrateKbps: project.export.audioBitrateKbps,
    },
    output: {
      codec,
      width: outW,
      height: outH,
      preset: project.export.preset,
      bitrateMbps: project.export.bitrateMbps,
    },
    parts: parts ? (manifest?.parts.length ?? 0) + Math.max(1, Math.ceil(remaining / partSeconds)) : undefined,
  });
  const tracker = new ProgressTracker(
    () => performance.now(),
    steps,
    remaining,
    Math.round(remaining * fps),
    opts.priors,
    defaultSpeeds(first.width * first.height, outW * outH),
    Date.now(),
    ((bitrate + project.export.audioBitrateKbps * 1000) / 8) * remaining,
  );
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
  if (!(await canEncodeVideo(codec, { width: outW, height: outH, bitrate })))
    throw new Error(
      `This browser can't encode ${codec.toUpperCase()} at ${outW}×${outH}. Try the other codec or a lower resolution.`,
    );
  // Count what reaches a file: every chunk passes through here on its way to the folder. The tracker sees every
  // byte (parts included, for its rates); the result reports the file's own.
  let fileBytes = 0;
  // While the file is being finalized its index goes out; the media-kind atom in it gets the integer type ffmpeg writes.
  const finalizing = { on: false };
  const countedStream = (target: WritableStream<StreamTargetChunk>, isFinal: boolean) => {
    const fileWriter = target.getWriter();
    return new WritableStream<StreamTargetChunk>({
      write: async (chunk) => {
        tracker.addBytes(chunk.data.byteLength);
        if (isFinal) fileBytes += chunk.data.byteLength;
        if (isFinal && finalizing.on) patchKindType(chunk.data);
        emit();
        try {
          await fileWriter.write(chunk);
        } catch (e) {
          if (!isSpaceError(e)) throw e;
          // A writable that has refused a write rejects every later one with the same stored error, so there is no
          // retrying it: say so, then stop the export at the last finished part (the parts are kept).
          await opts.onWriteBlocked?.(e);
          throw spaceStop(e);
        }
      },
      close: async () => {
        // Everything is written; from here the browser reads the file back to check it, then moves it into place.
        if (isFinal) {
          tracker.beginClose();
          emit(true);
        }
        await fileWriter.close();
      },
      abort: (r) => fileWriter.abort(r),
    });
  };
  const placedAll = placeClips(project.clips);
  const windows = transitionWindows(placedAll, project.media);
  const neighbour = new NeighbourFrames((id) => openInput(id));
  let tmpA: OffscreenCanvas | null = null,
    tmpB: OffscreenCanvas | null = null,
    scratch: OffscreenCanvas | null = null;
  let fxScratch: { a: OffscreenCanvas; b: OffscreenCanvas } | null = null;
  // Intro scenes draw through the style's look; the clip on the other side of a transition gets the same treatment.
  const gradeFor = (c: Clip, timelineT: number) => {
    const f = c.introRole ? introFrameAt(project, placedAll, timelineT) : null;
    return f ? styledGrade(c.grade, f.style) : c.grade;
  };
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
    for (const kind of FILE_LUT_KINDS) grader.provideLut(kind, deriveLut(base, kind));
  }
  const encoderConfig = {
    codec,
    bitrate,
    keyFrameInterval: 2,
    latencyMode: PRESET_LATENCY[project.export.preset],
    hardwareAcceleration: "prefer-hardware" as const,
  };
  const sampleRate = 48000;
  const tags = exportTags(project, `Bench video editor ${pkg.version}`);
  const newAudioSource = () =>
    new AudioSampleSource({
      codec: "aac",
      bitrate: project.export.audioBitrateKbps * 1000,
    });
  // Single file: one output with the video and the audio. Parts: a video-only output per part, joined at the end.
  let output: Output | null = null;
  let videoSource: CanvasSource | null = null;
  let audioSource: AudioSampleSource | null = null;
  if (!parts) {
    output = new Output({
      format: new Mp4OutputFormat({ fastStart: false }),
      target: new StreamTarget(countedStream(opts.writable, true), { chunked: true }),
    });
    videoSource = new CanvasSource(canvas, encoderConfig);
    output.addVideoTrack(videoSource, { frameRate: fps });
    audioSource = newAudioSource();
    output.addAudioTrack(audioSource);
    output.setMetadataTags(tags);
    await output.start();
  }
  tracker.endStep();
  emit(true);
  const inputs = new Map<string, Input>();
  const openInput = async (mediaId: string) => {
    if (inputs.has(mediaId)) return inputs.get(mediaId)!;
    const f = await getFile(mediaId);
    if (!f)
      throw new Error(
        `Missing file for ${project.media[mediaId]?.name ?? mediaId}.`,
      );
    const inp = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    inputs.set(mediaId, inp);
    return inp;
  };

  // Parts: the one being written now (export time, not timeline time).
  interface Segment {
    file: string;
    start: number;
    end: number;
    frames: number;
    output: Output;
    source: CanvasSource;
  }
  let segment: Segment | null = null;
  const partError = (message: string) => Object.assign(new Error(message), { name: "PartError" });
  const discardSegment = async (seg: Segment) => {
    try {
      await seg.output.cancel();
    } catch {
      /* already failed */
    }
    await parts!.store.remove(seg.file).catch(() => undefined);
  };
  const openSegment = async (startT: number) => {
    const n = manifest!.nextPart ?? manifest!.parts.length + 1;
    manifest!.nextPart = n + 1;
    const file = `part-${String(n).padStart(4, "0")}.mp4`;
    const writable = await parts!.store.createWritable(file);
    const seg: Segment = {
      file,
      start: startT,
      end: startT,
      frames: 0,
      output: new Output({
        format: new Mp4OutputFormat({ fastStart: false }),
        target: new StreamTarget(countedStream(writable, false), { chunked: true }),
      }),
      source: new CanvasSource(canvas, encoderConfig),
    };
    seg.output.addVideoTrack(seg.source, { frameRate: fps });
    await seg.output.start();
    segment = seg;
  };
  // The manifest is written by one hand at a time: parts can finish while another is being saved.
  let saveChain: Promise<void> = Promise.resolve();
  const saveManifest = () => (saveChain = saveChain.then(() => parts!.store.save(manifest!)));
  /** Finishes a part so it counts as done; false when it could not be finished (then it is discarded). */
  const finishSegment = async (seg: Segment): Promise<boolean> => {
    if (!seg.frames) {
      await discardSegment(seg);
      return true;
    }
    try {
      seg.source.close();
      await seg.output.finalize();
    } catch (e) {
      console.warn(`Part ${seg.file} could not be finished and is discarded:`, e);
      if (isSpaceError(e)) closeFailure ??= spaceStop(e);
      await discardSegment(seg);
      return false;
    }
    manifest!.parts.push({ file: seg.file, start: seg.start, end: seg.end, frames: seg.frames });
    manifest!.parts.sort((a, b) => a.start - b.start);
    manifest!.updatedAt = Date.now();
    runCursor = Math.max(runCursor, seg.end);
    await saveManifest();
    opts.onEvent?.({ at: Date.now(), kind: "part", text: `Part ${manifest!.parts.length} written — ${fmtMs(seg.start)} → ${fmtMs(seg.end)}, ${seg.frames.toLocaleString()} frames, safe if the export stops` });
    return true;
  };
  /** Finishes the open part now (used when the export stops or ends). */
  const closeSegment = async (): Promise<boolean> => {
    const seg = segment;
    if (!seg) return true;
    segment = null;
    return finishSegment(seg);
  };
  // Finishing a part means flushing its encoder, writing its index and closing its file, which the browser then
  // reads back to check — seconds per part. That happens in the background while the next part is encoded; a
  // failure there stops the export at the next frame, and everything is settled before the join and on any exit.
  const pendingCloses = new Set<Promise<void>>();
  let closeFailure: Error | null = null;
  const closeSegmentLater = () => {
    const seg = segment;
    segment = null;
    if (!seg) return;
    const p: Promise<void> = finishSegment(seg)
      .then((ok) => {
        if (!ok) closeFailure ??= partError(`Part ${seg.file} could not be written to the parts folder.`);
      })
      .catch((e) => {
        closeFailure ??= e instanceof Error ? e : new Error(String(e));
      })
      .finally(() => pendingCloses.delete(p));
    pendingCloses.add(p);
  };
  const settleCloses = async () => {
    await Promise.all([...pendingCloses]);
    if (closeFailure) {
      const e = closeFailure;
      closeFailure = null;
      throw e;
    }
  };
  /** Export time this run has finished work up to (the end of the last part it closed). */
  let runCursor = gaps[0]?.from ?? 0;
  const doneUntil = () => runCursor;

  // The timeline time of the last frame handed to an encoder: frames must only ever go forward, whatever the spans
  // and the footage's frame grid do, or the file would carry a frame before its predecessor (and the muxer refuses
  // one that lands on a keyframe).
  let lastFrameT = -Infinity;
  // Every output frame sits on the export's frame grid: tick k shows at offset + k / fps. The muxer rounds each
  // timestamp to its own ticks, so two frames closer together than one tick would share a timestamp — a zero-length
  // sample that YouTube's processing never gets past. Frames are gated on their grid tick, not their time in seconds:
  // strictly one per tick, the first at 0 (so no edit list), and no sub-frame slivers at the cuts.
  let lastTick = -1;
  let previewAt = 0;
  const tickOf = (timelineT: number) => Math.round((timelineT - offset) * fps);
  const gridTime = (tick: number) => offset + tick / fps;
  const addFrame = async (tick: number) => {
    const t = tick / fps;
    const duration = 1 / fps;
    if (parts) {
      if (closeFailure) await settleCloses();
      if (!segment || t - segment.start >= partSeconds) {
        if (segment) {
          closeSegmentLater();
          // Two parts finishing at once is plenty; a third waits so the disk is never asked for more.
          if (pendingCloses.size > 2) await settleCloses();
        }
        await openSegment(t);
      }
      const seg = segment!;
      await seg.source.add(t - seg.start, duration);
      seg.frames++;
      seg.end = t + duration;
    } else await videoSource!.add(t, duration);
    lastTick = tick;
    lastFrameT = gridTime(tick);
    tracker.frame(progressAt(t));
    emit();
    opts.onFrame?.(lastFrameT);
    if (opts.onPreview && performance.now() - previewAt > 400) {
      previewAt = performance.now();
      opts.onPreview(canvas, lastFrameT);
    }
  };

  // Stretches left out after a frame failed and the user chose to go on (export time).
  const skips = manifest?.skipped ?? [];
  const isSkipped = (t: number) => skips.some((k) => t >= k.from - 1e-6 && t < k.to - 1e-6);
  let current: { span: ExportSpan; track: InputVideoTrack; clipName: string; frameDur: number } | null = null;
  /** Export time of the frame being composed or encoded right now, when one is. */
  let pendingT: number | null = null;

  // Video, span by span, in timeline order, from `fromExport` on.
  const runVideo = async (fromExport: number) => {
    let spanIndex = 0;
    for (const planned of spans) {
      spanIndex++;
      if (planned.end - offset <= fromExport + 1e-6) continue;
      const [span] = trimSpans([planned], fromExport + offset);
      if (!span) continue;
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      tracker.beginStep(`span-${spanIndex}`);
      emit(true);
      const clip = project.clips.find((c) => c.id === span.clipId)!;
      const media = project.media[clip.media];
      const input = await openInput(clip.media);
      const track = (await input.getPrimaryVideoTrack())!;
      // A copy span is only truly copyable if the encoder/container accept the source packets; we re-encode here
      // frame-accurately instead, but skip the GPU grade (identity draw) so it is still much faster than a graded span.
      const sink = new VideoSampleSink(track);
      const srcW = media.width ?? track.displayWidth,
        srcH = media.height ?? track.displayHeight;
      const speed = span.speed || 1;
      // At 1× every source frame becomes an output frame. At other speeds the output keeps the source frame rate: each
      // output tick shows the source frame playing at that moment, so 2× drops every other frame and 0.5× holds each twice.
      let nextTick = span.start;
      const frameDur = 1 / fps;
      current = { span, track, clipName: media?.name ?? clip.media, frameDur };
    const compose = async (sample: VideoSample, timelineT: number) => {
      const tr =
        windows.length && span.kind === "encode"
          ? transitionAt(windows, timelineT)
          : null;
      let composed = false;
      if (tr) {
        // Inside a transition: grade both sides, then composite them.
        const outgoingIsThis = tr.window.outgoing.id === clip.id;
        const other = outgoingIsThis ? tr.window.incoming : tr.window.outgoing;
        const frame = await neighbour.frameAt(
          other,
          tr.window,
          sourceTimeAt(other, timelineT),
        );
        if (frame) {
          tmpA ??= new OffscreenCanvas(outW, outH);
          tmpB ??= new OffscreenCanvas(outW, outH);
          scratch ??= new OffscreenCanvas(outW, outH);
          const om = project.media[other.media];
          grader.draw(
            sample.toCanvasImageSource(),
            gradeFor(clip, timelineT),
            clip.transform,
            srcW,
            srcH,
          );
          tmpA.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          grader.draw(
            frame.toCanvasImageSource(),
            gradeFor(other, timelineT),
            other.transform,
            om?.width ?? frame.displayWidth,
            om?.height ?? frame.displayHeight,
          );
          tmpB.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
          drawTransition(
            ctx2d,
            outgoingIsThis ? tmpA : tmpB,
            outgoingIsThis ? tmpB : tmpA,
            outW,
            outH,
            tr.window.kind,
            tr.progress,
            scratch,
          );
          composed = true;
        }
      }
      if (!composed && span.kind === "encode") {
        grader.draw(
          sample.toCanvasImageSource(),
          gradeFor(clip, timelineT),
          clip.transform,
          srcW,
          srcH,
        );
        ctx2d.drawImage(grader.canvas, 0, 0, outW, outH);
      } else if (!composed) {
        ctx2d.drawImage(sample.toCanvasImageSource(), 0, 0, outW, outH);
      }
      const intro = introFrameAt(project, placedAll, timelineT, tr);
      if (intro) {
        fxScratch ??= {
          a: new OffscreenCanvas(outW, outH),
          b: new OffscreenCanvas(outW, outH),
        };
        drawIntroFx(
          ctx2d,
          outW,
          outH,
          intro,
          project,
          fxScratch,
          introBlendAt(project, placedAll, tr, timelineT),
        );
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
        // Whatever happens to the frame (a failure included), the sample goes back to the decoder.
        try {
          if (speed === 1) {
            // The first sample is the frame showing at the in point, which may have begun before it (the in point need
            // not sit on the frame grid): it enters at the span's start for what is left of it, or is skipped when
            // almost nothing is left. Placed where it began, it would come before the previous span's last frame.
            const lead = Math.max(0, span.sourceIn - sample.timestamp);
            const shown = (sample.duration || frameDur) - lead;
            const tick = tickOf(span.start + Math.max(0, sample.timestamp - span.sourceIn));
            if ((lead > 0 && shown < frameDur * 0.5) || tick <= lastTick || isSkipped(tick / fps)) continue;
            pendingT = tick / fps;
            await compose(sample, gridTime(tick));
            await addFrame(tick);
            pendingT = null;
          } else {
            // This source frame is on screen until its successor's timeline time; emit every output tick inside.
            const shownUntil =
              span.start +
              (sample.timestamp +
                (sample.duration || frameDur * speed) -
                span.sourceIn) /
                speed;
            while (nextTick < shownUntil - 1e-6 && nextTick < span.end - 1e-6) {
              const tick = tickOf(nextTick);
              if (tick > lastTick && !isSkipped(tick / fps)) {
                pendingT = tick / fps;
                await compose(sample, gridTime(tick));
                await addFrame(tick);
                pendingT = null;
              }
              nextTick += frameDur;
            }
          }
        } finally {
          sample.close();
        }
      }
      current = null;
      tracker.endStep();
      emit(true);
    }
  };

  /** What failed, where, and how much "skip" would leave out. */
  const describeFault = async (e: unknown, count: number): Promise<ExportFault> => {
    const c = current!;
    const message = e instanceof Error ? e.message : String(e);
    const speed = c.span.speed || 1;
    if (pendingT !== null) {
      const t = pendingT + offset;
      pendingT = null;
      return { timelineT: t, sourceT: c.span.sourceIn + (t - c.span.start) * speed, clipName: c.clipName, message, count, stretch: c.frameDur };
    }
    // The decoder failed somewhere after the last frame: leave out up to the footage's next keyframe, where decoding
    // can start afresh.
    const t = lastFrameT === -Infinity ? c.span.start : Math.max(c.span.start, lastFrameT + c.frameDur);
    const sourceT = c.span.sourceIn + (t - c.span.start) * speed;
    let stretch = c.frameDur;
    try {
      const psink = new EncodedPacketSink(c.track);
      const p = await psink.getPacket(sourceT);
      const k = p ? await psink.getNextKeyPacket(p, { verifyKeyPackets: true }) : null;
      if (k && k.timestamp > sourceT) stretch = Math.max(c.frameDur, (k.timestamp - sourceT) / speed);
    } catch {
      /* one frame then */
    }
    return { timelineT: t, sourceT, clipName: c.clipName, message, count, stretch: Math.min(stretch, Math.max(c.frameDur, c.span.end - t)) };
  };

  let joinInfo: JoinInfo | undefined;
  const isAbort = (e: unknown) => (e as DOMException)?.name === "AbortError";
  const isPartError = (e: unknown) => (e as Error)?.name === "PartError";
  let cursor = gaps[0]?.from ?? 0;
  let faults = 0;
  let lastFaultT = -1,
    sameFault = 0;
  try {
    for (;;) {
      try {
        await runVideo(cursor);
        break;
      } catch (e) {
        // What was done stays: the open part is finished — on a cancel too, so a stop can be continued from —
        // and the parts finishing in the background are waited for (a failure among them ends the export).
        if (parts) {
          await closeSegment();
          await settleCloses();
        }
        const canAsk = !!current && !isAbort(e) && !isPartError(e) && !!opts.onFault;
        const fault = canAsk ? await describeFault(e, faults + 1) : null;
        current = null;
        if (!fault) throw e;
        faults++;
        if (Math.abs(fault.timelineT - lastFaultT) < 1e-3) sameFault++;
        else sameFault = 0;
        lastFaultT = fault.timelineT;
        if (faults > MAX_FAULTS || sameFault >= 3)
          throw new Error(`${fault.message} — ${sameFault >= 3 ? "the same frame kept failing" : `${faults} frames failed`}; the export stopped, keeping what was finished.`);
        tracker.pause();
        emit(true);
        const answer = await opts.onFault!(fault);
        tracker.resume();
        emit(true);
        if (answer !== "skip") throw e;
        skips.push({ from: fault.timelineT - offset, to: fault.timelineT - offset + fault.stretch, message: fault.message });
        opts.onEvent?.({ at: Date.now(), kind: "skip", text: `Skipped ${fault.stretch < 0.1 ? "one frame" : `${fault.stretch.toFixed(2)} s`} at ${fmtMs(fault.timelineT - offset)} — ${fault.message}` });
        if (manifest) {
          manifest.skipped = skips;
          manifest.updatedAt = Date.now();
          await saveManifest();
        }
        cursor = parts ? doneUntil() : Math.max(cursor, fault.timelineT - offset);
      }
    }
    if (parts) {
      if (segment && !(await closeSegment())) throw partError("The last part could not be written to the parts folder.");
      await settleCloses();
    }
    await neighbour.reset();

    // Audio, mixed and encoded into whichever output takes the file.
    const audioInto = async (src: AudioSampleSource) => {
      tracker.beginStep("audio");
      emit(true);
      await mixAudio(
        { project, getFile, sampleRate },
        offset,
        offset + total,
        async (samples, timestamp) => {
          await pauseGate();
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          tracker.audio(timestamp - offset);
          emit();
          const s = new AudioSample({
            data: samples,
            format: "f32",
            numberOfChannels: 2,
            sampleRate,
            timestamp: timestamp - offset,
          });
          await src.add(s);
          s.close();
        },
        signal,
      );
      src.close();
      tracker.endStep();
    };

    if (parts) {
      // The file: the parts copied packet by packet (no re-encoding), each shifted to its place, then the audio.
      output = new Output({
        format: new Mp4OutputFormat({ fastStart: false }),
        target: new StreamTarget(countedStream(opts.writable, true), { chunked: true }),
      });
      const copied = new EncodedVideoPacketSource(codec);
      output.addVideoTrack(copied, { frameRate: fps });
      audioSource = newAudioSource();
      output.addAudioTrack(audioSource);
      output.setMetadataTags(tags);
      await output.start();
      tracker.beginStep("finalize");
      emit(true);
      // Getting here means the run went over every stretch between the parts and after the last one, so where they
      // leave a gap or stop short of the planned total, the footage had no frame there — a skipped stretch, or a
      // clip whose picture ends before its declared length (DJI's audio runs a few frames past the video) — and the
      // file simply ends where the picture does, as a one-piece export would. Only a part reaching back over the
      // one before it must not get in: a cut's last frame may run a little past the next part's start, no more.
      const ordered = [...manifest!.parts].sort((a, b) => a.start - b.start);
      let pos = 0;
      const files: File[] = [];
      for (const part of ordered) {
        if (part.start < pos - 0.1) throw new Error(`Part ${part.file} starts at ${part.start.toFixed(2)} s, before the part ahead of it ends (${pos.toFixed(2)} s). Discard the parts and export again.`);
        const f = await parts.store.file(part.file);
        if (!f) throw new Error(`Part ${part.file} is missing from the parts folder. Discard the parts and export again.`);
        files.push(f);
        pos = Math.max(pos, part.end);
      }
      // With less room than the file needs on top of the parts, each part goes as soon as it is in the file.
      const partBytes = files.reduce((a, f) => a + f.size, 0);
      const audioBytes = ((project.export.audioBitrateKbps * 1000) / 8) * total;
      const free = parts.freeSpace ? await parts.freeSpace() : null;
      const mode: JoinInfo["mode"] = parts.testJoinMode ?? (free !== null && free < partBytes + audioBytes + 1e9 ? "remove" : "keep");
      joinInfo = { mode, bytes: partBytes, free, parts: ordered.length };
      parts.onJoin?.(joinInfo);
      opts.onEvent?.({ at: Date.now(), kind: "join", text: `Joining ${ordered.length} parts (${fmtBytes(partBytes)}) into the file${mode === "remove" ? ", removing each as it goes in to spare the disk" : ""}` });
      let first = true;
      for (const [index, part] of ordered.entries()) {
        const inp = new Input({ source: new BlobSource(files[index]), formats: ALL_FORMATS });
        const track = await inp.getPrimaryVideoTrack();
        if (!track) throw new Error(`Part ${part.file} holds no video. Discard the parts and export again.`);
        const config = first ? await track.getDecoderConfig() : null;
        for await (const packet of new EncodedPacketSink(track).packets()) {
          if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
          await pauseGate();
          await copied.add(packet.clone({ timestamp: packet.timestamp + part.start }), first && config ? { decoderConfig: config } : undefined);
          first = false;
        }
        if (mode === "remove") {
          // Its bytes are in the file now; should the file not get finished, this stretch is exported again.
          part.consumed = true;
          manifest!.updatedAt = Date.now();
          await saveManifest();
          await parts.store.remove(part.file);
        }
        if (parts.testFailJoinAfter !== undefined && index + 1 >= parts.testFailJoinAfter) throw new Error("Test: the join was interrupted.");
        emit(true);
      }
      copied.close();
      tracker.endStep();
      await audioInto(audioSource);
    } else {
      videoSource!.close();
      await audioInto(audioSource!);
    }
    tracker.beginStep("finalize");
    emit(true);
    finalizing.on = true;
    await output!.finalize();
    tracker.endStep();
    emit(true);
  } catch (e) {
    // Nothing half-written is left behind: the output being written is dropped (the finished parts stay).
    if (parts) {
      if (segment) await closeSegment();
      await Promise.allSettled([...pendingCloses]);
    }
    await neighbour.reset().catch(() => undefined);
    try {
      await output?.cancel();
    } catch {
      /* already gone */
    }
    throw e;
  }
  const done = tracker.snapshot();
  return {
    bytesWritten: fileBytes,
    seconds: total,
    activeMs: done.elapsedMs,
    pausedMs: done.pausedMs,
    steps: done.steps,
    measured: tracker.measured(),
    skipped: skips,
    parts: manifest?.parts.length ?? 0,
    resumedFrom: resumeFrom,
    join: joinInfo,
  };
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
  if (!first?.width || !first.height)
    throw new Error("Add at least one video clip.");
  const under = clipAt(project.clips, t);
  if (!under) throw new Error("There is no clip under the playhead.");
  const outH =
    Math.round(
      Math.min(first.height, Math.max(2, opts.height ?? first.height)) / 2,
    ) * 2;
  const outW = Math.round((first.width * (outH / first.height)) / 2) * 2;
  const inputs = new Map<string, Input>();
  const openInput = async (mediaId: string) => {
    if (inputs.has(mediaId)) return inputs.get(mediaId)!;
    const f = await getFile(mediaId);
    if (!f)
      throw new Error(
        `Missing file for ${project.media[mediaId]?.name ?? mediaId}.`,
      );
    const inp = new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    inputs.set(mediaId, inp);
    return inp;
  };
  // The frame shown at a source instant: the last one decoded at or before it.
  const frameOf = async (
    clip: PlacedClip,
    sourceT: number,
  ): Promise<VideoSample | null> => {
    const track = await (await openInput(clip.media)).getPrimaryVideoTrack();
    if (!track) return null;
    return new VideoSampleSink(track).getSample(
      Math.max(clip.in, Math.min(clip.out - 1e-3, sourceT)),
    );
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
    for (const kind of FILE_LUT_KINDS) grader.provideLut(kind, deriveLut(base, kind));
  }
  const main = await frameOf(under.clip, under.sourceTime);
  if (!main) throw new Error("Couldn't decode a frame at the playhead.");
  const media = project.media[under.clip.media];
  const srcW = media?.width ?? main.displayWidth,
    srcH = media?.height ?? main.displayHeight;
  const placedAll = placeClips(project.clips);
  const tr = transitionAt(transitionWindows(placedAll, project.media), t);
  const intro = introFrameAt(project, placedAll, t, tr);
  const gradeFor = (c: Clip) =>
    c.introRole && intro ? styledGrade(c.grade, intro.style) : c.grade;
  let composed = false;
  if (tr) {
    const outgoingIsThis = tr.window.outgoing.id === under.clip.id;
    const other = outgoingIsThis ? tr.window.incoming : tr.window.outgoing;
    const frame = await frameOf(other, sourceTimeAt(other, t));
    if (frame) {
      const a = new OffscreenCanvas(outW, outH),
        b = new OffscreenCanvas(outW, outH),
        scratch = new OffscreenCanvas(outW, outH);
      const om = project.media[other.media];
      grader.draw(
        main.toCanvasImageSource(),
        gradeFor(under.clip),
        under.clip.transform,
        srcW,
        srcH,
      );
      a.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
      grader.draw(
        frame.toCanvasImageSource(),
        gradeFor(other),
        other.transform,
        om?.width ?? frame.displayWidth,
        om?.height ?? frame.displayHeight,
      );
      b.getContext("2d")!.drawImage(grader.canvas, 0, 0, outW, outH);
      drawTransition(
        ctx,
        outgoingIsThis ? a : b,
        outgoingIsThis ? b : a,
        outW,
        outH,
        tr.window.kind,
        tr.progress,
        scratch,
      );
      frame.close();
      composed = true;
    }
  }
  if (!composed) {
    grader.draw(
      main.toCanvasImageSource(),
      gradeFor(under.clip),
      under.clip.transform,
      srcW,
      srcH,
    );
    ctx.drawImage(grader.canvas, 0, 0, outW, outH);
  }
  if (intro)
    drawIntroFx(
      ctx,
      outW,
      outH,
      intro,
      project,
      {
        a: new OffscreenCanvas(outW, outH),
        b: new OffscreenCanvas(outW, outH),
      },
      introBlendAt(project, placedAll, tr, t),
    );
  drawOverlays(ctx, outW, outH, t, project, logo);
  main.close();
  const blob = await canvas.convertToBlob({
    type: opts.type ?? "image/png",
    quality: opts.quality,
  });
  return {
    blob,
    width: outW,
    height: outH,
    clipName: media?.name ?? under.clip.media,
    sourceTime: under.sourceTime,
  };
}

/* --------------------------------------------------------------- intro */

/**
 * How lively each candidate moment is: the contrast within a small frame and the motion against a frame a
 * beat later. Decoded at thumbnail size from whichever file is handed over (a proxy, ideally).
 */
export async function scanMoments(
  fileFor: (mediaId: string) => Promise<File | null>,
  project: Project,
  windows: Moment[][],
  opts: {
    beat?: number;
    signal?: AbortSignal;
    onProgress?: (done: number, total: number) => void;
  } = {},
): Promise<Map<Moment, { motion: number; contrast: number }>> {
  const beat = opts.beat ?? 0.4;
  const all = windows.flat();
  const stats = new Map<Moment, { motion: number; contrast: number }>();
  const W = 64,
    H = 36;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const luma = (img: CanvasImageSource) => {
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++)
      out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
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
    const input = new Input({
      source: new BlobSource(f),
      formats: ALL_FORMATS,
    });
    const track = await input.getPrimaryVideoTrack();
    if (!track) continue;
    const sink = new VideoSampleSink(track);
    const media = project.media[mediaId];
    for (const m of moments.sort((a, b) => a.sourceTime - b.sourceTime)) {
      if (opts.signal?.aborted)
        throw new DOMException("Cancelled", "AbortError");
      const a = await sink.getSample(m.sourceTime);
      const b = await sink.getSample(
        Math.max(
          0,
          Math.min(
            (media?.duration ?? m.sourceTime + beat) - 0.05,
            m.sourceTime + beat,
          ),
        ),
      );
      if (a && b) {
        const la = luma(a.toCanvasImageSource()),
          lb = luma(b.toCanvasImageSource());
        let mean = 0;
        for (const v of la) mean += v;
        mean /= la.length;
        let varSum = 0,
          diff = 0;
        for (let i = 0; i < la.length; i++) {
          varSum += (la[i] - mean) ** 2;
          diff += Math.abs(la[i] - lb[i]);
        }
        stats.set(m, {
          contrast: Math.sqrt(varSum / la.length) / 128,
          motion: diff / la.length / 255,
        });
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
export async function renderSceneThumbs(
  fileFor: (mediaId: string) => Promise<File | null>,
  project: Project,
  clips: Clip[],
  height = 72,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const first = project.media[project.clips[0]?.media ?? ""];
  if (!first?.width || !first.height || !clips.length) return out;
  const h = height,
    w = Math.round((first.width * h) / first.height / 2) * 2;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d")!;
  const grader = new Grader(w, h);
  const scratch = {
    a: new OffscreenCanvas(w, h),
    b: new OffscreenCanvas(w, h),
  };
  const style = introStyle(project.intro.style);
  const sinks = new Map<
    string,
    { sink: VideoSampleSink; w: number; h: number }
  >();
  const scenes = clips.filter((c) => c.introRole === "scene");
  for (const c of clips) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    let s = sinks.get(c.media);
    if (!s) {
      const f = await fileFor(c.media);
      if (!f) continue;
      const track = await new Input({
        source: new BlobSource(f),
        formats: ALL_FORMATS,
      }).getPrimaryVideoTrack();
      if (!track) continue;
      s = {
        sink: new VideoSampleSink(track),
        w: track.displayWidth,
        h: track.displayHeight,
      };
      sinks.set(c.media, s);
    }
    const sample = await s.sink.getSample(
      c.in + (c.out - c.in) * (c.introRole === "card" ? 0.5 : 0.35),
    );
    if (!sample) continue;
    grader.draw(
      sample.toCanvasImageSource(),
      styledGrade(c.grade, style),
      c.transform,
      s.w,
      s.h,
    );
    sample.close();
    ctx.drawImage(grader.canvas, 0, 0, w, h);
    const length = Math.max(0.01, (c.out - c.in) / clipSpeed(c));
    const frame: IntroFrame = {
      style,
      role: c.introRole === "card" ? "card" : "scene",
      index: c.introRole === "card" ? scenes.length : scenes.indexOf(c),
      count: scenes.length,
      local: length * 0.6,
      length,
      introT: 10,
      introLength: 20,
    };
    drawIntroFx(ctx, w, h, frame, project, scratch);
    out.set(
      c.id,
      URL.createObjectURL(
        await canvas.convertToBlob({ type: "image/jpeg", quality: 0.82 }),
      ),
    );
  }
  return out;
}

/** Whether this browser can hardware-encode the project's codec at a given size. */
export async function encoderSupport(
  width: number,
  height: number,
): Promise<{ hevc: boolean; avc: boolean }> {
  const [hevc, avc] = await Promise.all([
    canEncodeVideo("hevc", { width, height, bitrate: 100e6 }).catch(
      () => false,
    ),
    canEncodeVideo("avc", { width, height, bitrate: 100e6 }).catch(() => false),
  ]);
  return { hevc, avc };
}

export type { ExportSpan, Clip, MediaRef, Title };
/* ------------------------------------------------------------ loudness */

/**
 * The loudness of the export's sound mix over a stretch of the timeline — camera sound, music, fades, crossfades and
 * the limiter, exactly as the file would carry it — without writing anything.
 */
export async function measureLoudness(
  input: MixInput & { from: number; to: number; signal?: AbortSignal; onProgress?: (done: number, total: number) => void },
): Promise<Loudness> {
  const meter = new LoudnessMeter(input.sampleRate);
  const total = Math.max(0, input.to - input.from);
  await mixAudio(
    input,
    input.from,
    input.to,
    async (samples, t) => {
      meter.add(samples);
      input.onProgress?.(Math.min(total, t - input.from), total);
    },
    input.signal,
  );
  return meter.result();
}

/** Interleaved stereo floats from a decoded sample (a mono track is doubled). */
function stereoOf(sample: AudioSample): Float32Array {
  const frames = sample.numberOfFrames, ch = sample.numberOfChannels;
  const tmp = new Float32Array(frames * ch);
  sample.copyTo(tmp, { format: "f32", planeIndex: 0 });
  if (ch === 2) return tmp;
  const out = new Float32Array(frames * 2);
  for (let i = 0; i < frames; i++) {
    out[i * 2] = tmp[i * ch];
    out[i * 2 + 1] = ch > 1 ? tmp[i * ch + 1] : tmp[i * ch];
  }
  return out;
}

/** The loudness of a file's sound track (video files included): only the audio is decoded, so it is quick. */
export async function measureFile(file: File, opts: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {}): Promise<Loudness> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const audio = await input.getPrimaryAudioTrack();
  if (!audio) throw new Error("The file has no sound track.");
  const total = await input.computeDuration();
  const meter = new LoudnessMeter(audio.sampleRate);
  const sink = new AudioSampleSink(audio);
  for await (const sample of sink.samples()) {
    if (opts.signal?.aborted) {
      sample.close();
      throw new DOMException("Cancelled", "AbortError");
    }
    meter.add(stereoOf(sample));
    opts.onProgress?.(Math.min(total, sample.timestamp), total);
    sample.close();
  }
  return meter.result();
}

export interface FixLevelOptions {
  file: File;
  writable: WritableStream<StreamTargetChunk>;
  /** Applied to the sound before the limiter, dB. */
  gainDb: number;
  audioBitrateKbps: number;
  signal?: AbortSignal;
  onProgress?: (stage: "video" | "audio" | "finalize", fraction: number) => void;
}

/**
 * A copy of an exported file with its sound at a new level: the picture's packets are copied as they are (no
 * re-encoding), the sound is decoded, raised or lowered, limited and encoded again, and the file's tags are kept —
 * the media-kind atom with the integer type ffmpeg writes.
 */
export async function fixLevel(opts: FixLevelOptions): Promise<{ bytes: number; seconds: number }> {
  const { file, signal } = opts;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const video = await input.getPrimaryVideoTrack();
  const audio = await input.getPrimaryAudioTrack();
  if (!video || !audio) throw new Error("The file needs a picture and a sound track.");
  const codec = video.codec;
  if (!codec) throw new Error("The picture's codec is not one this browser can copy.");
  const duration = Math.max(1e-6, await input.computeDuration());
  const stats = await video.computePacketStats(200);
  const fileWriter = opts.writable.getWriter();
  const finalizing = { on: false };
  let bytes = 0;
  const counted = new WritableStream<StreamTargetChunk>({
    write: async (chunk) => {
      if (finalizing.on) patchKindType(chunk.data);
      bytes += chunk.data.byteLength;
      await fileWriter.write(chunk);
    },
    close: () => fileWriter.close(),
    abort: (reason) => fileWriter.abort(reason),
  });
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(counted, { chunked: true }),
  });
  const copied = new EncodedVideoPacketSource(codec);
  output.addVideoTrack(copied, { frameRate: stats.averagePacketRate > 0 ? stats.averagePacketRate : 30 });
  const audioSource = new AudioSampleSource({ codec: "aac", bitrate: opts.audioBitrateKbps * 1000 });
  output.addAudioTrack(audioSource);
  output.setMetadataTags(await input.getMetadataTags());
  const check = () => {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  };
  try {
    await output.start();
    const config = await video.getDecoderConfig();
    let first = true;
    for await (const packet of new EncodedPacketSink(video).packets()) {
      check();
      await copied.add(packet, first && config ? { decoderConfig: config } : undefined);
      first = false;
      opts.onProgress?.("video", Math.min(1, packet.timestamp / duration));
    }
    copied.close();
    const g = 10 ** (opts.gainDb / 20);
    for await (const sample of new AudioSampleSink(audio).samples()) {
      if (signal?.aborted) sample.close();
      check();
      const data = stereoOf(sample);
      for (let i = 0; i < data.length; i++) data[i] = softLimit(data[i] * g);
      const out = new AudioSample({ data, format: "f32", numberOfChannels: 2, sampleRate: audio.sampleRate, timestamp: sample.timestamp });
      await audioSource.add(out);
      out.close();
      opts.onProgress?.("audio", Math.min(1, sample.timestamp / duration));
      sample.close();
    }
    audioSource.close();
    opts.onProgress?.("finalize", 0);
    finalizing.on = true;
    await output.finalize();
    opts.onProgress?.("finalize", 1);
  } catch (e) {
    await output.cancel().catch(() => undefined);
    await fileWriter.abort(e).catch(() => undefined);
    throw e;
  }
  return { bytes, seconds: duration };
}

export { EncodedPacketSink, EncodedVideoPacketSource };

/**
 * How much the picture changes through a recording: the mean absolute luma difference between 64×36 frames taken every
 * `step` seconds, 0–1. Every frame is decoded (the sink runs in order), so proxies make this many times faster than 8K.
 */
export async function scanMotion(
  file: File,
  opts: {
    step?: number;
    signal?: AbortSignal;
    onProgress?: (seconds: number, total: number) => void;
  } = {},
): Promise<MotionTrace> {
  const step = opts.step ?? 0.25;
  const input = new Input({
    source: new BlobSource(file),
    formats: ALL_FORMATS,
  });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error("No video track in this file.");
  const total = await input.computeDuration();
  const W = 64,
    H = 36;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const luma = (img: CanvasImageSource) => {
    ctx.drawImage(img, 0, 0, W, H);
    const d = ctx.getImageData(0, 0, W, H).data;
    const out = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++)
      out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    return out;
  };
  const sink = new VideoSampleSink(track);
  const scores: number[] = [];
  let prev: Float32Array | null = null;
  let next = 0,
    lastReport = -1;
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
