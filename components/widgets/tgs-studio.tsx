"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import lottie from "lottie-web/build/player/lottie_canvas";
import type { AnimationItem } from "lottie-web";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Loader,
  Pause,
  Pipette,
  Play,
  Repeat,
  Sticker,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { ADDED_LAYER, applyEdits, applyMat, coalesce, emptyEdits, exportDoc, hasEdits, idAtPixel, highlightPaints, invert, matrixTo, nextAddedId, paletteOf, parseOps, partsOf, pickingDoc, type Addr, type Edits, type Op, type Swatch } from "@/lib/tools/image/tgs-edit";
import { PartsPanel, type AddMode } from "@/components/widgets/tgs-parts";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/tools/bytes";
import {
  TGS_MAX_BYTES,
  base64UrlToBytes,
  bytesToBase64Url,
  gunzipBytes,
  gzipJson,
  isGzipData,
  isZipData,
  parseColorMap,
  parseLottieInfo,
  pixelHex,
  sampleSticker,
  serializeTgs,
  telegramChecks,
  type LottieJson,
} from "@/lib/tools/image/tgs";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { readShareState, useShareState } from "@/lib/share-state";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { SplitPane } from "@/components/ui/split-pane";

interface Source {
  /** The original (never-mutated) animation as loaded. */
  anim: LottieJson;
  name: string;
  /** Compressed size when the input was a .tgs, else null. */
  tgsSize: number | null;
}

const SPEEDS = [0.25, 0.5, 1, 2] as const;
/** A share link carries the packed sticker up to this many characters (the shortener takes 200k); Telegram's own 64 KB cap is far below it. */
const LINK_MAX_CHARS = 180_000;
/** Every other colour while one swatch is being shown in the preview. */
const DIM_HEX = "#9a9a9a";

/** A shared sticker: packed bytes, name, colour edits and part edits from the link hash. */
function readLink(): { t: string; n: string; c: Record<string, string>; o: Op[] } | null {
  if (typeof window === "undefined") return null;
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const t = hash.get("t");
  if (!t) return null;
  let c: Record<string, string> = {};
  let o: Op[] = [];
  try {
    c = parseColorMap(JSON.parse(hash.get("c") ?? "null"));
  } catch {
    /* no colour edits */
  }
  try {
    o = parseOps(JSON.parse(hash.get("e") ?? "null"));
  } catch {
    /* no part edits */
  }
  return { t, n: hash.get("n") ?? "", c, o };
}

/** A paint's part: the address before the paint's own index. */
const partOf = (paint: Addr): Addr => paint.replace(/#\d+$/, "");
/** Where the sticker is drawn inside the square stage (xMidYMid meet). */
function fitBox(rect: DOMRect, w: number, h: number): { x: number; y: number; w: number; h: number } {
  const scale = Math.min(rect.width / w, rect.height / h);
  const bw = w * scale, bh = h * scale;
  return { x: rect.left + (rect.width - bw) / 2, y: rect.top + (rect.height - bh) / 2, w: bw, h: bh };
}
/** The most frequent paint id in a 3 × 3 neighbourhood of a picking render, or 0. */
function idAround(data: ImageData, x: number, y: number): number {
  const counts = new Map<number, number>();
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= data.width || py >= data.height) continue;
      const i = (py * data.width + px) * 4;
      const id = idAtPixel(data.data[i], data.data[i + 1], data.data[i + 2], data.data[i + 3]);
      if (id) counts.set(id, (counts.get(id) ?? 0) + (dx === 0 && dy === 0 ? 3 : 1));
    }
  }
  let best = 0, n = 0;
  for (const [id, c] of counts) if (c > n) { best = id; n = c; }
  return best;
}
type Drag = { kind: "move" | "scale" | "rotate" | "rubber"; startX: number; startY: number; base: Edits; box: { x: number; y: number; w: number; h: number }; moved: boolean; paint?: Addr | null };

const CHECKER: React.CSSProperties = {
  backgroundImage:
    "repeating-conic-gradient(rgba(255,255,255,0.05) 0% 25%, transparent 0% 50%)",
  backgroundSize: "16px 16px",
};

export function TgsStudioWidget() {
  const [src, setSrc] = useState<Source | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Every edit over the original: the palette's colour map and the part ops, with an undo history beside it. */
  const [edits, setEdits] = useState<Edits>(emptyEdits);
  const editsRef = useRef<Edits>(edits);
  const historyRef = useRef<{ past: Edits[]; future: Edits[] }>({ past: [], future: [] });
  /** How many steps back and forward there are (mirrors the history ref, which render must not read). */
  const [histSize, setHistSize] = useState({ past: 0, future: 0 });
  const colorMap = edits.colors;
  const [resetCount, setResetCount] = useState(0);
  /** The part or layer being edited, the part under the pointer on the stage, the part hovered in the list. */
  const [selected, setSelected] = useState<Addr | null>(null);
  const [hotPart, setHotPart] = useState<Addr | null>(null);
  const [hoverPart, setHoverPart] = useState<Addr | null>(null);
  /** A swatch expanded to its parts, with the parts ticked to separate. */
  const [expanded, setExpanded] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<Addr>>(new Set());
  /** Adding: the armed shape and, for a path, the points placed so far (stage units). */
  const [addMode, setAddMode] = useState<AddMode | null>(null);
  const [pathPts, setPathPts] = useState<{ x: number; y: number }[]>([]);
  const [rubber, setRubber] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** The selected part's box on the stage (stage CSS pixels, relative to the stage), for the handles. */
  const [handles, setHandles] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [packedSize, setPackedSize] = useState<number | null>(null);
  const dragRef = useRef<Drag | null>(null);
  /** Picking renders by form ("solid", "alpha", or "solid-" plus the paints peeled away), for one document and frame. */
  const pickRef = useRef<{ doc: unknown; frame: number; renders: Map<string, ImageData>; paints: Addr[] } | null>(null);
  const lastPickRef = useRef(0);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(true);
  // How the link's reader looked at it, applied softly.
  const [loop, setLoop] = useState(() => readShareState<{ loop: unknown }>("tgs")?.loop !== false);
  const [speed, setSpeed] = useState(() => {
    const v = readShareState<{ speed: unknown }>("tgs")?.speed;
    return (SPEEDS as readonly number[]).includes(v as number) ? (v as number) : 1;
  });
  useShareState("tgs", { loop, speed });
  const [link] = useState(readLink);
  /** The sticker packed for the link, for the source it was made from. */
  const [packed, setPacked] = useState<{ for: Source; data: string } | null>(null);
  /** The swatch (original hex) under the pointer, the pixel colour there, the swatch pinned by a click, and the swatch shown alone in the preview. */
  const [hot, setHot] = useState<string | null>(null);
  const [pixel, setPixel] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [spot, setSpot] = useState<string | null>(null);
  useEffect(() => {
    editsRef.current = edits;
  }, [edits]);
  const [busy, setBusy] = useState<null | "tgs" | "png" | "gif">(null);
  const [gifProgress, setGifProgress] = useState(0);
  useUnsavedWork(busy ? "A sticker export is running; leaving now would abandon it." : src && hasEdits(edits) ? "The sticker's edits would be lost." : null);
  const [note, setNote] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);

  const fileInput = useRef<HTMLInputElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<AnimationItem | null>(null);
  const scrubRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const swatchRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const frameLabelRef = useRef<HTMLSpanElement>(null);
  const playingRef = useRef(true);
  const lastFrameRef = useRef(0);
  const colorTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const urlsRef = useRef<string[]>([]);

  /** The edited document (always through applyEdits, so every node carries its address). */
  const anim = useMemo(() => (src ? applyEdits(src.anim, edits) : null), [src, edits]);
  const info = useMemo(() => (anim ? parseLottieInfo(anim) : null), [anim]);
  const layers = useMemo(() => (anim && src ? partsOf(anim, src.anim) : []), [anim, src]);
  const swatches = useMemo(() => paletteOf(layers, edits), [layers, edits]);
  /** The picking renders' documents: the solid one names the topmost paint, the alpha one says whether it really covers the pixel. */
  const picking = useMemo(() => (anim ? { solid: pickingDoc(anim), alpha: pickingDoc(anim, { alpha: true }) } : null), [anim]);
  const paintSwatch = useMemo(() => {
    const m = new Map<Addr, string>();
    for (const sw of swatches) for (const p of sw.paints) if (!m.has(p.addr)) m.set(p.addr, sw.key);
    return m;
  }, [swatches]);
  const selectedPart = useMemo(() => layers.flatMap((l) => l.parts).find((p) => p.addr === selected) ?? null, [layers, selected]);
  const checks = useMemo(() => (info ? telegramChecks(info, packedSize ?? src?.tgsSize ?? null) : []), [info, src, packedSize]);
  // The size the sticker would export at, measured a moment after each edit, so the checklist speaks of the result.
  useEffect(() => {
    if (!anim) return;
    let live = true;
    const t = setTimeout(() => {
      void serializeTgs(exportDoc(anim)).then((b) => {
        if (live) setPackedSize(b.length);
      });
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [anim]);
  /* ------------------------------------------------------------ edits */
  /** A new edits value; a step the history remembers unless it is a live one (mid-drag). */
  const commit = useCallback((fn: (e: Edits) => Edits, live = false) => {
    const prev = editsRef.current;
    const next = fn(prev);
    if (next === prev) return;
    if (!live) {
      historyRef.current.past.push(prev);
      if (historyRef.current.past.length > 200) historyRef.current.past.shift();
      historyRef.current.future = [];
    }
    editsRef.current = next;
    setEdits(next);
    setHistSize({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  }, []);
  const applyOp = useCallback(
    (op: Op) => {
      let made: Addr | null = null;
      commit((e) => {
        const ready: Op = op.t === "dup" && !op.id ? { ...op, id: (made = nextAddedId(e)) } : op;
        return { ...e, ops: coalesce([...e.ops, ready]) };
      });
      if (made) setSelected(made);
    },
    [commit],
  );
  const dropOps = useCallback((keep: (op: Op) => boolean) => commit((e) => ({ ...e, ops: e.ops.filter(keep) })), [commit]);
  const undo = useCallback(() => {
    const prev = historyRef.current.past.pop();
    if (!prev) return;
    historyRef.current.future.push(editsRef.current);
    editsRef.current = prev;
    setEdits(prev);
    setHistSize({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  }, []);
  const redo = useCallback(() => {
    const next = historyRef.current.future.pop();
    if (!next) return;
    historyRef.current.past.push(editsRef.current);
    editsRef.current = next;
    setEdits(next);
    setHistSize({ past: historyRef.current.past.length, future: historyRef.current.future.length });
  }, []);
  const resetEdits = () => {
    commit(() => emptyEdits());
    setSelected(null);
    setResetCount((c) => c + 1);
  };

  const baseName = src ? src.name.replace(/\.(tgs|json|lottie)$/i, "") || "sticker" : "sticker";
  const packedData = packed && packed.for === src ? packed.data : null;
  const linkTooLong = packedData !== null && packedData.length > LINK_MAX_CHARS;

  /* ------------------------------------------------------------ player */

  useEffect(() => {
    const stage = stageRef.current;
    if (!anim || !stage) return;
    const instance = lottie.loadAnimation<"canvas">({
      container: stage,
      renderer: "canvas",
      loop,
      autoplay: false,
      animationData: structuredClone(anim),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
    });
    const start = Math.min(lastFrameRef.current, Math.max(0, instance.totalFrames - 1));
    if (playingRef.current) instance.goToAndPlay(start, true);
    else instance.goToAndStop(start, true);
    const onFrame = () => {
      lastFrameRef.current = instance.currentFrame;
      if (scrubRef.current) scrubRef.current.value = String(Math.round(instance.currentFrame));
      if (frameLabelRef.current)
        frameLabelRef.current.textContent = String(Math.round(instance.currentFrame));
    };
    instance.addEventListener("enterFrame", onFrame);
    playerRef.current = instance;
    return () => {
      playerRef.current = null;
      instance.destroy();
    };
  }, [anim, loop]);

  useEffect(() => {
    playerRef.current?.setSpeed(speed);
  }, [speed, anim, loop]);

  /** The paints shown alone in the preview: a swatch's, or the part hovered in the list. */
  const spotKeep = useMemo(() => {
    if (spot) {
      const sw = swatches.find((x) => x.key === spot);
      return sw ? new Set(sw.paints.map((p) => p.addr)) : null;
    }
    if (hoverPart) {
      const part = layers.flatMap((l) => l.parts).find((p) => p.addr === hoverPart);
      return part ? new Set(part.paints.map((p) => p.addr)) : null;
    }
    return null;
  }, [spot, hoverPart, swatches, layers]);
  // One swatch or part shown alone: a second player over the stage draws the sticker with every other paint greyed,
  // on the same frame as the main one.
  useEffect(() => {
    const host = overlayRef.current;
    const main = playerRef.current;
    if (!spotKeep || !anim || !host || !main) return;
    const inst = lottie.loadAnimation<"canvas">({
      container: host,
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: highlightPaints(anim, spotKeep, DIM_HEX),
      rendererSettings: { preserveAspectRatio: "xMidYMid meet", clearCanvas: true },
    });
    const sync = () => inst.goToAndStop(main.currentFrame, true);
    sync();
    main.addEventListener("enterFrame", sync);
    return () => {
      // The main player may already be gone (an edit remakes it first); a destroyed player has no listeners to remove.
      try {
        main.removeEventListener("enterFrame", sync);
      } catch {
        /* already destroyed */
      }
      inst.destroy();
    };
  }, [spotKeep, anim, loop]);

  // The sticker is packed once per source, so Share can write it into the link at once.
  useEffect(() => {
    if (!src) return;
    let active = true;
    gzipJson(src.anim).then((bytes) => {
      if (active) setPacked({ for: src, data: bytesToBase64Url(bytes) });
    });
    return () => {
      active = false;
    };
  }, [src]);

  // A link that carries a sticker: unpack it and apply its colour edits.
  useEffect(() => {
    if (!link) return;
    let active = true;
    (async () => {
      try {
        const bytes = base64UrlToBytes(link.t);
        const parsed = JSON.parse(new TextDecoder().decode(await gunzipBytes(bytes))) as LottieJson;
        parseLottieInfo(parsed);
        if (!active) return;
        lastFrameRef.current = 0;
        playingRef.current = true;
        historyRef.current = { past: [], future: [] };
        setHistSize({ past: 0, future: 0 });
        editsRef.current = { colors: link.c, ops: link.o };
        setEdits(editsRef.current);
        setSelected(null);
        setResetCount((c) => c + 1);
        setNote(null);
        setPlaying(true);
        setSrc({ anim: parsed, name: link.n || "shared-sticker.tgs", tgsSize: bytes.length });
        setError(null);
      } catch {
        if (active) setError("The sticker in this link could not be read.");
      }
    })();
    return () => {
      active = false;
    };
  }, [link]);

  // Share: the packed sticker, its name and the colour edits go into the link (the sticker only while it fits).
  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (src) {
        if (packedData !== null && !linkTooLong) {
          h.set("t", packedData);
          h.set("n", src.name);
        }
        if (Object.keys(colorMap).length) h.set("c", JSON.stringify(colorMap));
        if (edits.ops.length) h.set("e", JSON.stringify(edits.ops));
      }
      const hs = h.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${hs ? `#${hs}` : ""}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [src, packedData, linkTooLong, colorMap, edits.ops]);

  useEffect(() => {
    const urls = urlsRef.current;
    const timers = colorTimers.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);

  const save = useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }, []);

  /* ------------------------------------------------------------ loading */

  const applySource = (next: Source) => {
    lastFrameRef.current = 0;
    playingRef.current = true;
    setPinned(null);
    setSpot(null);
    setHot(null);
    setPixel(null);
    historyRef.current = { past: [], future: [] };
    setHistSize({ past: 0, future: 0 });
    editsRef.current = emptyEdits();
    setEdits(editsRef.current);
    setSelected(null);
    setHotPart(null);
    setHoverPart(null);
    setAddMode(null);
    setPathPts([]);
    setPackedSize(null);
    setResetCount((c) => c + 1);
    setNote(null);
    setPlaying(true);
    setSrc(next);
    setError(null);
  };

  const load = useCallback(async (file: File) => {
    setError(null);
    try {
      let bytes: Uint8Array = new Uint8Array(await file.arrayBuffer());
      let tgsSize: number | null = null;
      if (isGzipData(bytes)) {
        tgsSize = bytes.length;
        bytes = await gunzipBytes(bytes);
      } else if (isZipData(bytes)) {
        // dotLottie container: a zip holding animations/*.json
        const { Archive } = await import("libarchive.js");
        Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });
        const reader = await Archive.open(file);
        try {
          const entries = (await reader.getFilesArray()) as {
            file: { name: string };
            path: string;
          }[];
          const target =
            entries.find(
              (e) => e.path.startsWith("animations/") && e.file.name.endsWith(".json"),
            ) ?? entries.find((e) => e.file.name.endsWith(".json"));
          if (!target) throw new Error("No animation JSON found inside this .lottie file.");
          const extracted = await reader.extractSingleFile(target.path + target.file.name);
          bytes = new Uint8Array(await extracted.arrayBuffer());
        } finally {
          await reader.close().catch(() => undefined);
        }
      }
      const parsed = JSON.parse(new TextDecoder().decode(bytes)) as LottieJson;
      parseLottieInfo(parsed); // throws when it isn't a Lottie document
      applySource({ anim: parsed, name: file.name, tgsSize });
    } catch (e) {
      setError(
        e instanceof Error && !/JSON/.test(e.message)
          ? e.message
          : "Could not read this file — expected a .tgs sticker, a Lottie .json or a .lottie file.",
      );
    }
  }, []);

  const openFiles = useCallback(
    (files: FileList) => {
      if (files[0]) void load(files[0]);
    },
    [load],
  );

  const loadSample = () =>
    applySource({ anim: sampleSticker(), name: "bench-bounce.json", tgsSize: null });

  const clear = () => {
    setSrc(null);
    setPinned(null);
    setSpot(null);
    setHot(null);
    setPixel(null);
    historyRef.current = { past: [], future: [] };
    setHistSize({ past: 0, future: 0 });
    editsRef.current = emptyEdits();
    setEdits(editsRef.current);
    setSelected(null);
    setAddMode(null);
    setPathPts([]);
    setError(null);
    setNote(null);
  };

  /* ------------------------------------------------------------ recolor */

  /** A swatch's new colour: the palette map for an original colour, a paint's own colour op for a separated paint (its stops one by one). */
  const queueColor = (sw: Swatch, to: string, stop?: number) => {
    const key = `${sw.key}:${stop ?? ""}`;
    const prev = colorTimers.current.get(key);
    if (prev) clearTimeout(prev);
    colorTimers.current.set(
      key,
      setTimeout(() => {
        if (!sw.separated) commit((e) => ({ ...e, colors: { ...e.colors, [sw.key]: to } }));
        else applyOp({ t: "color", at: sw.key, v: to, ...(sw.stops.length ? { stop: stop ?? 0 } : {}) });
      }, 120),
    );
  };
  /** The ticked parts of a swatch get colours of their own (the same colour at first), so they can be edited apart. */
  const separate = (sw: Swatch) => {
    const want = ticked.size ? [...sw.paints].filter((p) => ticked.has(p.addr) || ticked.has(partOf(p.addr))) : [];
    if (!want.length) return;
    commit((e) => ({
      ...e,
      ops: [
        ...e.ops,
        ...want.flatMap((p): Op[] => (p.stops.length ? p.stops.map((h, i) => ({ t: "color" as const, at: p.addr, v: h, stop: i })) : [{ t: "color" as const, at: p.addr, v: p.hex ?? sw.hex }])),
      ],
    }));
    setTicked(new Set());
    setExpanded(null);
    setNote(`${want.length} part${want.length === 1 ? "" : "s"} now ${want.length === 1 ? "has" : "have"} a colour of ${want.length === 1 ? "its" : "their"} own — under Separated in the Colors panel.`);
  };

  /* ------------------------------------------------------------ pointer */

  /** The colour drawn under the pointer, or null off the sticker. */
  const readPixel = (clientX: number, clientY: number): string | null => {
    const canvas = stageRef.current?.querySelector("canvas");
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((clientY - rect.top) / rect.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const [r, g, b, a] = ctx.getImageData(x, y, 1, 1).data;
    return a < 24 ? null : pixelHex(r, g, b);
  };
  /** The sticker's box inside the stage, in viewport pixels. */
  const stageBox = () => {
    const el = surfaceRef.current;
    if (!el || !info) return null;
    return fitBox(el.getBoundingClientRect(), info.width || 512, info.height || 512);
  };
  /**
   * Offscreen player drawing straight into a 2d context. `container` must be
   * OMITTED: the canvas renderer then sizes itself from the canvas element,
   * while a detached container measures 0×0 and renders nothing. The type
   * declarations wrongly require `container`, hence the cast. `dpr: 1` keeps
   * the output at exact pixel size on high-DPI screens.
   */
  const offscreenPlayer = (data: LottieJson, ctx: CanvasRenderingContext2D): AnimationItem =>
    lottie.loadAnimation({
      renderer: "canvas",
      loop: false,
      autoplay: false,
      animationData: structuredClone(data),
      rendererSettings: {
        context: ctx,
        clearCanvas: true,
        preserveAspectRatio: "xMidYMid meet",
        dpr: 1,
      },
    } as unknown as Parameters<typeof lottie.loadAnimation>[0]);

  /** The frame on screen, kept inside the animation (a one-frame sticker paused at its end would otherwise render nothing). */
  const curFrame = () => Math.max(0, Math.min(Math.round(lastFrameRef.current), Math.max(0, (info?.frames ?? 1) - 1)));
  /** A picking render of the current frame (made once per form, frame and document): which paint drew each pixel. */
  const pickData = (form: "solid" | "alpha" = "solid", hide?: Set<Addr>): { data: ImageData; paints: Addr[] } | null => {
    if (!picking || !info || !anim) return null;
    const frame = curFrame();
    if (!pickRef.current || pickRef.current.doc !== picking.solid.doc || pickRef.current.frame !== frame) pickRef.current = { doc: picking.solid.doc, frame, renders: new Map(), paints: picking.solid.paints };
    const cache = pickRef.current;
    const key = hide?.size ? `${form}-${[...hide].sort().join(",")}` : form;
    let data = cache.renders.get(key);
    if (!data) {
      const W = info.width || 512, H = info.height || 512;
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      const doc = hide?.size ? pickingDoc(anim, { alpha: form === "alpha", hide }).doc : form === "alpha" ? picking.alpha.doc : picking.solid.doc;
      const inst = offscreenPlayer(doc, ctx);
      inst.goToAndStop(frame, true);
      data = ctx.getImageData(0, 0, W, H);
      inst.destroy();
      cache.renders.set(key, data);
    }
    return { data, paints: cache.paints };
  };
  /**
   * The paint under a viewport point: the topmost by the solid render, unless the alpha render shows it does not
   * really cover the pixel (a gloss fading to nothing, a see-through tint) — then it is peeled away and the next one
   * looked at, a few times over.
   */
  const pickAt = (clientX: number, clientY: number): Addr | null => {
    const box = stageBox();
    const first = pickData("solid");
    if (!box || !first) return null;
    const x = Math.floor(((clientX - box.x) / box.w) * first.data.width), y = Math.floor(((clientY - box.y) / box.h) * first.data.height);
    if (x < 0 || y < 0 || x >= first.data.width || y >= first.data.height) return null;
    const peeled = new Set<Addr>();
    let last: Addr | null = null;
    for (let i = 0; i < 4; i++) {
      const solid = i === 0 ? first : pickData("solid", peeled);
      if (!solid) break;
      const id = idAround(solid.data, x, y);
      if (!id) return last;
      const paint = solid.paints[id] ?? null;
      if (!paint) return last;
      last = paint;
      const alpha = pickData("alpha", peeled.size ? peeled : undefined);
      if (!alpha || idAround(alpha.data, x, y) === id) return paint;
      peeled.add(paint);
    }
    return last;
  };
  /** The selected part's box from the picking render, in stage-relative CSS pixels. */
  const measureHandles = useCallback(() => {
    if (!selectedPart || !surfaceRef.current) return setHandles(null);
    const box = stageBox();
    const pick = pickData("solid");
    if (!box || !pick) return setHandles(null);
    const ids = new Set(selectedPart.paints.map((p) => pick.paints.indexOf(p.addr)).filter((i) => i > 0));
    if (!ids.size) return setHandles(null);
    const { width, height, data } = pick.data;
    let x0 = width, y0 = height, x1 = -1, y1 = -1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (!ids.has(idAtPixel(data[i], data[i + 1], data[i + 2], data[i + 3]))) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return setHandles(null);
    const rect = surfaceRef.current.getBoundingClientRect();
    const sx = box.w / width, sy = box.h / height;
    setHandles({ x: box.x - rect.left + x0 * sx, y: box.y - rect.top + y0 * sy, w: (x1 - x0 + 1) * sx, h: (y1 - y0 + 1) * sy });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPart, picking, info]);
  useEffect(() => {
    if (dragRef.current) return;
    measureHandles();
  }, [measureHandles, playing]);
  // While the sticker plays, the handles follow it a few times a second.
  useEffect(() => {
    if (!playing || !selectedPart) return;
    const id = setInterval(() => {
      if (!dragRef.current) measureHandles();
    }, 300);
    return () => clearInterval(id);
  }, [playing, selectedPart, measureHandles]);
  /** A viewport delta in sticker units, then in the selected part's parent space (so a drag moves it where the pointer goes). */
  const toParentDelta = (part: Addr, dx: number, dy: number): [number, number] => {
    const box = stageBox();
    if (!box || !anim || !info) return [0, 0];
    const ux = (dx / box.w) * (info.width || 512), uy = (dy / box.h) * (info.height || 512);
    const m = invert(matrixTo(anim, part, curFrame(), false));
    return [m[0] * ux + m[2] * uy, m[1] * ux + m[3] * uy];
  };
  /** A viewport point in the selected part's parent space. */
  const toParentPoint = (part: Addr, clientX: number, clientY: number): [number, number] => {
    const box = stageBox();
    if (!box || !anim || !info) return [0, 0];
    const ux = ((clientX - box.x) / box.w) * (info.width || 512), uy = ((clientY - box.y) / box.h) * (info.height || 512);
    return applyMat(invert(matrixTo(anim, part, curFrame(), false)), ux, uy);
  };
  /** A viewport point in sticker units. */
  const toSticker = (clientX: number, clientY: number): { x: number; y: number } => {
    const box = stageBox();
    if (!box || !info) return { x: 0, y: 0 };
    return { x: ((clientX - box.x) / box.w) * (info.width || 512), y: ((clientY - box.y) / box.h) * (info.height || 512) };
  };
  const finishPath = () => {
    if (!addMode || addMode.kind !== "path" || pathPts.length < 2) return;
    const xs = pathPts.map((p) => p.x), ys = pathPts.map((p) => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const id = nextAddedId(editsRef.current);
    applyOp({ t: "add", id, shape: { kind: "path", x: (x0 + x1) / 2, y: (y0 + y1) / 2, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), path: pathPts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })), closed: addMode.closed, smooth: addMode.smooth, fill: addMode.closed ? addMode.fill : null, stroke: addMode.stroke ?? (addMode.closed && addMode.fill ? null : "#2b2b2b"), width: addMode.width, motion: addMode.motion } });
    setPathPts([]);
    setAddMode(null);
    setSelected(id);
  };
  const cancelPath = () => setPathPts([]);
  const onSurfaceDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    const handle = target.closest("[data-handle]") as HTMLElement | null;
    if (addMode) {
      if (addMode.kind === "path") {
        const p = toSticker(e.clientX, e.clientY);
        setPathPts((pts) => [...pts, p]);
        return;
      }
      e.currentTarget.setPointerCapture(e.pointerId);
      const rect = e.currentTarget.getBoundingClientRect();
      dragRef.current = { kind: "rubber", startX: e.clientX, startY: e.clientY, base: editsRef.current, box: { x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 }, moved: false };
      setRubber({ x: e.clientX - rect.left, y: e.clientY - rect.top, w: 0, h: 0 });
      return;
    }
    if (handle && selectedPart && handles) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragRef.current = { kind: handle.dataset.handle === "rot" ? "rotate" : "scale", startX: e.clientX, startY: e.clientY, base: editsRef.current, box: handles, moved: false };
      return;
    }
    // The paint under the pointer names the part: it is selected, and a drag from here moves it. A press on empty
    // ground clears the selection. (The pin and the colour picker come on release, when it turns out to be a click.)
    const paint = pickAt(e.clientX, e.clientY);
    const part = paint ? partOf(paint) : null;
    if (part !== selected) setSelected(part);
    if (!part) {
      setPinned(null);
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "move", startX: e.clientX, startY: e.clientY, base: editsRef.current, box: part === selected && handles ? handles : { x: 0, y: 0, w: 0, h: 0 }, moved: false, paint };
  };
  const onSurfaceMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (d && d.kind !== "rubber") {
      const part = d.kind === "move" && d.paint ? partOf(d.paint) : selectedPart?.addr;
      if (!part) return;
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return;
      d.moved = true;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = rect.left + d.box.x + d.box.w / 2, cy = rect.top + d.box.y + d.box.h / 2;
      if (d.kind === "move") {
        const [dx, dy] = toParentDelta(part, e.clientX - d.startX, e.clientY - d.startY);
        commit(() => ({ ...d.base, ops: coalesce([...d.base.ops, { t: "move", at: part, dx: Math.round(dx * 100) / 100, dy: Math.round(dy * 100) / 100 }]) }), true);
        if (d.box.w > 0) setHandles({ ...d.box, x: d.box.x + (e.clientX - d.startX), y: d.box.y + (e.clientY - d.startY) });
      } else if (d.kind === "scale") {
        const r0 = Math.hypot(d.startX - cx, d.startY - cy) || 1, r1 = Math.hypot(e.clientX - cx, e.clientY - cy);
        const f = Math.max(0.05, r1 / r0);
        const [pcx, pcy] = toParentPoint(part, cx, cy);
        commit(() => ({ ...d.base, ops: coalesce([...d.base.ops, { t: "scale", at: part, f: Math.round(f * 1000) / 1000, cx: Math.round(pcx * 100) / 100, cy: Math.round(pcy * 100) / 100 }]) }), true);
        setHandles({ x: d.box.x + (d.box.w * (1 - f)) / 2, y: d.box.y + (d.box.h * (1 - f)) / 2, w: d.box.w * f, h: d.box.h * f });
      } else {
        const a0 = Math.atan2(d.startY - cy, d.startX - cx), a1 = Math.atan2(e.clientY - cy, e.clientX - cx);
        let deg = ((a1 - a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 15) * 15;
        const [pcx, pcy] = toParentPoint(part, cx, cy);
        commit(() => ({ ...d.base, ops: coalesce([...d.base.ops, { t: "rotate", at: part, deg: Math.round(deg * 10) / 10, cx: Math.round(pcx * 100) / 100, cy: Math.round(pcy * 100) / 100 }]) }), true);
      }
      return;
    }
    if (d && d.kind === "rubber") {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      setRubber({ x: Math.min(x, d.box.x), y: Math.min(y, d.box.y), w: Math.abs(x - d.box.x), h: Math.abs(y - d.box.y) });
      return;
    }
    setPixel(readPixel(e.clientX, e.clientY));
    // With the frame's picking render in hand a hover is a lookup; a new frame is rendered a few times a second at most.
    const stale = !pickRef.current || pickRef.current.doc !== picking?.solid.doc || pickRef.current.frame !== curFrame();
    const now = performance.now();
    if (stale && now - lastPickRef.current < 90) return;
    if (stale) lastPickRef.current = now;
    const paint = pickAt(e.clientX, e.clientY);
    setHotPart(paint ? partOf(paint) : null);
    setHot(paint ? (paintSwatch.get(paint) ?? null) : null);
  };
  const onSurfaceUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (d.kind === "rubber") {
      setRubber(null);
      if (!addMode || !info) return;
      const box = stageBox();
      const rect = e.currentTarget.getBoundingClientRect();
      if (!box) return;
      const x0 = Math.min(d.startX, e.clientX), x1 = Math.max(d.startX, e.clientX), y0 = Math.min(d.startY, e.clientY), y1 = Math.max(d.startY, e.clientY);
      const unit = (info.width || 512) / box.w;
      let w = (x1 - x0) * unit, h = (y1 - y0) * unit;
      if (w < 4 && h < 4) {
        // A click without a drag: a shape of a sensible size at that spot.
        w = h = 96;
      }
      if (addMode.kind === "line") {
        const a = toSticker(d.startX, d.startY), b = toSticker(e.clientX, e.clientY);
        const id = nextAddedId(editsRef.current);
        applyOp({ t: "add", id, shape: { kind: "path", x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, w: Math.max(1, Math.abs(b.x - a.x)), h: Math.max(1, Math.abs(b.y - a.y)), path: [a, b].map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })), closed: false, smooth: false, fill: null, stroke: addMode.stroke ?? "#2b2b2b", width: addMode.width, motion: addMode.motion, name: "Line" } });
        setSelected(id);
        setAddMode(null);
        void rect;
        return;
      }
      const c = toSticker((x0 + x1) / 2, (y0 + y1) / 2);
      const id = nextAddedId(editsRef.current);
      applyOp({ t: "add", id, shape: { kind: addMode.kind, x: Math.round(c.x * 10) / 10, y: Math.round(c.y * 10) / 10, w: Math.round(w * 10) / 10, h: Math.round(h * 10) / 10, r: addMode.corner, points: addMode.points, fill: addMode.fill, stroke: addMode.stroke, width: addMode.width, motion: addMode.motion } });
      setSelected(id);
      setAddMode(null);
      return;
    }
    // A finished drag is one step in the history.
    if (d.moved && editsRef.current !== d.base) {
      historyRef.current.past.push(d.base);
      historyRef.current.future = [];
      setHistSize({ past: historyRef.current.past.length, future: historyRef.current.future.length });
    }
    // A press and release on a part without moving: a click, which pins the paint's swatch and opens its picker.
    if (d.kind === "move" && !d.moved && d.paint) {
      const key = paintSwatch.get(d.paint) ?? null;
      setPinned(key);
      if (key) {
        const input = swatchRefs.current.get(key);
        input?.scrollIntoView({ block: "nearest" });
        try {
          input?.showPicker();
        } catch {
          /* needs a user gesture the browser did not count, or an unsupported browser — the swatch is still pinned */
        }
      }
    }
    setTimeout(measureHandles, 0);
  };
  const onSurfaceLeave = () => {
    setPixel(null);
    setHot(null);
    setHotPart(null);
  };
  // Exposed for automated checks, which cannot read the picking render or the edits otherwise.
  useEffect(() => {
    (window as unknown as { __benchTgs?: unknown }).__benchTgs = {
      pickAt: (x: number, y: number) => pickAt(x, y),
      pickSample: (x: number, y: number) => {
        const box = stageBox();
        const pick = pickData("solid");
        const alpha = pickData("alpha");
        if (!box || !pick || !alpha) return null;
        const px = Math.floor(((x - box.x) / box.w) * pick.data.width), py = Math.floor(((y - box.y) / box.h) * pick.data.height);
        const i = (py * pick.data.width + px) * 4;
        return { px, py, rgba: Array.from(pick.data.data.slice(i, i + 4)), alpha: Array.from(alpha.data.data.slice(i, i + 4)), paints: pick.paints.length, frame: pickRef.current?.frame };
      },
      pickTrace: (x: number, y: number) => {
        const box = stageBox();
        const first = pickData("solid");
        if (!box || !first) return null;
        const px = Math.floor(((x - box.x) / box.w) * first.data.width), py = Math.floor(((y - box.y) / box.h) * first.data.height);
        const peeled = new Set<Addr>();
        const trace: unknown[] = [];
        for (let i = 0; i < 4; i++) {
          const solid = i === 0 ? first : pickData("solid", peeled);
          if (!solid) break;
          const id = idAround(solid.data, px, py);
          const alpha = pickData("alpha", peeled.size ? peeled : undefined);
          const aid = alpha ? idAround(alpha.data, px, py) : -1;
          const j = (py * solid.data.width + px) * 4;
          trace.push({ id, paint: solid.paints[id] ?? null, aid, apaint: alpha?.paints[aid] ?? null, rgba: Array.from(solid.data.data.slice(j, j + 4)), argba: alpha ? Array.from(alpha.data.data.slice(j, j + 4)) : null, frame: pickRef.current?.frame });
          if (!id || aid === id) break;
          peeled.add(solid.paints[id]);
        }
        return { px, py, trace };
      },
      edits: () => editsRef.current,
      layers: () => layers,
      selected: () => selected,
      applyOp,
      undo,
      redo,
    };
  });
  /** Keys: ⌘Z / ⇧⌘Z, Delete removes the selected part, arrows nudge it, ⌘D duplicates, Esc deselects or stops adding. */
  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === "Escape") {
        if (addMode) {
          setPathPts([]);
          setAddMode(null);
        } else setSelected(null);
        return;
      }
      if (e.key === "Enter" && addMode?.kind === "path") {
        e.preventDefault();
        finishPath();
        return;
      }
      const part = editsRef.current && selected;
      if (!part) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        applyOp({ t: "hide", at: part });
      } else if (meta && e.key.toLowerCase() === "d") {
        e.preventDefault();
        applyOp({ t: "dup", at: part, id: "" });
      } else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [dx, dy] = e.key === "ArrowLeft" ? [-step, 0] : e.key === "ArrowRight" ? [step, 0] : e.key === "ArrowUp" ? [0, -step] : [0, step];
        const box = stageBox();
        if (!box || !info) return;
        const unit = box.w / (info.width || 512);
        const [px, py] = toParentDelta(part, dx * unit, dy * unit);
        applyOp({ t: "move", at: part, dx: Math.round(px * 100) / 100, dy: Math.round(py * 100) / 100 });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  /* ------------------------------------------------------------ exports */


  /** Render one frame onto a fresh canvas at the given width. */
  const renderFrame = (frame: number, width: number): { canvas: HTMLCanvasElement; done: () => void } => {
    if (!anim || !info) throw new Error("nothing loaded");
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = Math.max(1, Math.round((width * info.height) / info.width));
    const instance = offscreenPlayer(anim, canvas.getContext("2d")!);
    instance.goToAndStop(frame, true);
    return {
      canvas,
      done: () => instance.destroy(),
    };
  };

  const exportTgs = async () => {
    if (!anim || busy) return;
    setBusy("tgs");
    try {
      const bytes = await serializeTgs(exportDoc(anim));
      save(new Blob([bytes as BlobPart], { type: "application/gzip" }), `${baseName}.tgs`);
      setNote(
        bytes.length > TGS_MAX_BYTES
          ? `Heads-up: ${(bytes.length / 1024).toFixed(1)} KB exceeds Telegram's 64 KB sticker limit.`
          : `.tgs exported at ${(bytes.length / 1024).toFixed(1)} KB — within Telegram's 64 KB limit.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const exportJson = () => {
    if (!anim) return;
    save(new Blob([JSON.stringify(exportDoc(anim), null, 2)], { type: "application/json" }), `${baseName}.json`);
  };

  const exportPng = async () => {
    if (!anim || !info || busy) return;
    setBusy("png");
    try {
      const frame = Math.round(lastFrameRef.current);
      const { canvas, done } = renderFrame(frame, info.width || 512);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
      done();
      if (blob) save(blob, `${baseName}-frame${frame}.png`);
    } finally {
      setBusy(null);
    }
  };

  const exportGif = async () => {
    if (!anim || !info || busy) return;
    setBusy("gif");
    setGifProgress(0);
    try {
      const fps = Math.min(30, info.frameRate);
      const step = info.frameRate / fps;
      const total = Math.max(1, Math.floor(info.frames / step));
      const W = 320;
      const H = Math.max(1, Math.round((W * info.height) / info.width));
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      const compose = document.createElement("canvas");
      compose.width = W;
      compose.height = H;
      const ctx = compose.getContext("2d")!;
      const frames: ArrayBuffer[] = [];
      // Drive a hidden instance frame by frame on its own canvas.
      const off = offscreenPlayer(anim, canvas.getContext("2d")!);
      for (let i = 0; i < total; i++) {
        off.goToAndStop(i * step, true);
        ctx.fillStyle = "#ffffff"; // GIF has no real alpha — composite on white
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(canvas, 0, 0);
        frames.push(ctx.getImageData(0, 0, W, H).data.buffer as ArrayBuffer);
        if (i % 10 === 9) {
          setGifProgress((i / total) * 0.5);
          await new Promise((r) => setTimeout(r));
        }
      }
      off.destroy();
      const gifBytes = await new Promise<Uint8Array>((resolve, reject) => {
        const worker = new Worker(new URL("./gif.worker.ts", import.meta.url), {
          type: "module",
        });
        worker.onmessage = (
          e: MessageEvent<{ type: string; value?: number; bytes?: Uint8Array; message?: string }>,
        ) => {
          if (e.data.type === "progress") setGifProgress(0.5 + (e.data.value ?? 0) * 0.5);
          else if (e.data.type === "done") {
            worker.terminate();
            resolve(e.data.bytes!);
          } else {
            worker.terminate();
            reject(new Error(e.data.message ?? "GIF encoding failed"));
          }
        };
        worker.postMessage(
          { frames, width: W, height: H, delay: Math.round(1000 / fps), maxColors: 256, repeat: 0 },
          frames,
        );
      });
      save(new Blob([gifBytes as unknown as BlobPart], { type: "image/gif" }), `${baseName}.gif`);
    } catch (e) {
      setNote(e instanceof Error ? e.message : "GIF export failed.");
    } finally {
      setBusy(null);
      setGifProgress(0);
    }
  };

  /* ------------------------------------------------------------ render */

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept=".tgs,.json,.lottie"
        hidden
        onChange={(e) => {
          if (e.target.files?.length) openFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {!src && (
        <div className="space-y-3">
          <button
            onClick={() => fileInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              openFiles(e.dataTransfer.files);
            }}
            className={cn(
              "panel registered bg-ticks flex min-h-[320px] w-full flex-col items-center justify-center gap-3 border-dashed p-8 text-center",
              dragOver && "border-accent",
            )}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
              <Sticker size={20} />
            </span>
            <span className="font-display text-base font-semibold text-ink">
              Drop a Telegram sticker here
            </span>
            <span className="max-w-sm font-mono text-xs text-faint">
              .tgs, Lottie .json or .lottie — previewed, recolored and converted locally. Nothing
              is uploaded.
            </span>
          </button>
          <div className="flex items-center justify-center">
            <button
              onClick={loadSample}
              className="inline-flex h-8 items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-muted hover:border-accent hover:text-accent"
            >
              <Play size={12} /> Try the sample sticker
            </button>
          </div>
          {error && <p className="text-center font-mono text-xs text-danger">{error}</p>}
        </div>
      )}

      {src && info && (
        <SplitPane id="tgs-studio" defaultRatio={0.5} minFirst={260} minSecond={300} collapsible="both" firstLabel="sticker" secondLabel="controls" stackBelow="lg" gap={12} first={<><div className="panel registered flex flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge p-2">
              <Sticker size={15} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-[13px] text-ink">{src.name}</p>
                <p className="readout text-[10px]">
                  {info.width}×{info.height} · {info.frameRate} fps · {info.duration.toFixed(2)} s
                  {src.tgsSize !== null && ` · ${formatBytes(src.tgsSize)} packed`}
                </p>
              </div>
              <button
                onClick={() => fileInput.current?.click()}
                title="Open another file"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent"
              >
                <Upload size={14} />
              </button>
              <button
                onClick={clear}
                title="Close"
                className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-danger hover:text-danger"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex flex-1 items-center justify-center bg-base p-4" style={CHECKER}>
              <div className="relative aspect-square w-full max-w-[440px]" data-tgs-stage>
                <div ref={stageRef} className={cn("absolute inset-0 transition-opacity", spotKeep && "opacity-15")} />
                {spotKeep && <div ref={overlayRef} className="pointer-events-none absolute inset-0" data-tgs-highlight />}
                <div
                  ref={surfaceRef}
                  onPointerDown={onSurfaceDown}
                  onPointerMove={onSurfaceMove}
                  onPointerUp={onSurfaceUp}
                  onPointerCancel={onSurfaceUp}
                  onPointerLeave={onSurfaceLeave}
                  onDoubleClick={() => addMode?.kind === "path" && finishPath()}
                  title={addMode ? (addMode.kind === "path" ? "Click the corners; double-click finishes" : "Drag to draw the shape") : "Click a part to edit it; drag it, its corners or the handle above to move, scale or turn it"}
                  className={cn("absolute inset-0 touch-none select-none", addMode ? "cursor-crosshair" : hotPart && hotPart === selected ? "cursor-move" : hotPart ? "cursor-pointer" : "cursor-default")}
                  data-tgs-surface
                  data-hot-part={hotPart ?? ""}
                  data-selected-part={selected ?? ""}
                >
                  <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
                    {rubber && <rect x={rubber.x} y={rubber.y} width={rubber.w} height={rubber.h} className="fill-accent/10 stroke-accent" strokeDasharray="4 3" />}
                    {addMode?.kind === "path" && pathPts.length > 0 && (
                      <svg viewBox={`0 0 ${info.width || 512} ${info.height || 512}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full overflow-visible" data-tgs-path-preview>
                        <polyline points={pathPts.map((p) => `${p.x},${p.y}`).join(" ")} className="fill-none stroke-accent" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" />
                        {pathPts.map((p, i) => (
                          <circle key={i} cx={p.x} cy={p.y} r={3.5} className="fill-accent" />
                        ))}
                      </svg>
                    )}
                    {handles && selectedPart && !addMode && (
                      <g data-tgs-handles>
                        <rect x={handles.x} y={handles.y} width={handles.w} height={handles.h} className="fill-transparent stroke-accent" strokeWidth={1.5} strokeDasharray="5 3" data-tgs-frame />
                        <line x1={handles.x + handles.w / 2} y1={handles.y} x2={handles.x + handles.w / 2} y2={handles.y - 22} className="stroke-accent" />
                        {([["nw", handles.x, handles.y], ["ne", handles.x + handles.w, handles.y], ["sw", handles.x, handles.y + handles.h], ["se", handles.x + handles.w, handles.y + handles.h]] as const).map(([k, x, y]) => (
                          <rect key={k} x={x - 5} y={y - 5} width={10} height={10} className="fill-surface stroke-accent" strokeWidth={1.5} style={{ pointerEvents: "all", cursor: k === "nw" || k === "se" ? "nwse-resize" : "nesw-resize" }} data-handle={k} />
                        ))}
                        <circle cx={handles.x + handles.w / 2} cy={handles.y - 22} r={6} className="fill-surface stroke-accent" strokeWidth={1.5} style={{ pointerEvents: "all", cursor: "grab" }} data-handle="rot" />
                      </g>
                    )}
                  </svg>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t border-edge px-3 py-2">
              <button
                onClick={() => {
                  const p = playerRef.current;
                  if (!p) return;
                  if (playing) p.pause();
                  else p.play();
                  playingRef.current = !playing;
                  setPlaying(!playing);
                }}
                title={playing ? "Pause" : "Play"}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-accent text-on-accent"
              >
                {playing ? <Pause size={14} /> : <Play size={14} />}
              </button>
              <button
                onClick={() => setLoop(!loop)}
                title="Toggle loop"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border",
                  loop ? "border-accent text-accent" : "border-edge text-muted",
                )}
              >
                <Repeat size={14} />
              </button>
              <input
                ref={scrubRef}
                type="range"
                min={0}
                max={Math.max(0, info.frames - 1)}
                defaultValue={0}
                onChange={(e) => {
                  const f = Number(e.target.value);
                  playerRef.current?.goToAndStop(f, true);
                  lastFrameRef.current = f;
                  playingRef.current = false;
                  setPlaying(false);
                }}
                aria-label="Scrub frames"
                className="h-1.5 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
              />
              <span className="shrink-0 font-mono text-xs tabular text-muted">
                <span ref={frameLabelRef}>0</span>/{info.frames}
              </span>
              <span
                className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2 font-mono text-xs text-muted"
                title="The colour under the pointer"
                data-tgs-pixel={pixel ?? ""}
              >
                <Pipette size={12} className="text-faint" />
                {pixel ? (
                  <>
                    <span className="inline-block h-3.5 w-3.5 rounded-[3px] border border-edge" style={{ background: pixel }} />
                    <span className="tabular">{pixel}</span>
                  </>
                ) : (
                  <span className="text-faint">hover the sticker</span>
                )}
              </span>
              <select
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                aria-label="Playback speed"
                className="h-8 w-[72px] shrink-0 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-xs text-ink outline-none"
              >
                {SPEEDS.map((s) => (
                  <option key={s} value={s}>
                    {s}×
                  </option>
                ))}
              </select>
            </div>
          </div></>} second={<><div className="flex flex-col gap-3">
            <PartsPanel
              layers={layers}
              edits={edits}
              selected={selected}
              hot={hotPart}
              canUndo={histSize.past > 0}
              canRedo={histSize.future > 0}
              addMode={addMode}
              pathPoints={pathPts.length}
              busy={busy !== null}
              onSelect={(a) => {
                setSelected(a);
                if (a && a !== ADDED_LAYER) {
                  setPinned(null);
                }
              }}
              onHover={setHoverPart}
              onOp={applyOp}
              onDropOps={dropOps}
              onUndo={undo}
              onRedo={redo}
              onAddMode={(m) => {
                setAddMode(m);
                if (!m) setPathPts([]);
                if (m) setSelected(null);
              }}
              onFinishPath={finishPath}
              onCancelPath={cancelPath}
            />

            {swatches.length > 0 && (
              <div className="panel registered p-4" data-tgs-colors>
                <div className="mb-3 flex items-center justify-between">
                  <p className="readout">Colors · {swatches.filter((sw) => !sw.separated).length}{swatches.some((sw) => sw.separated) ? ` + ${swatches.filter((sw) => sw.separated).length} separated` : ""}</p>
                  {hasEdits(edits) && (
                    <button onClick={resetEdits} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-ink" data-tgs-reset>
                      <Undo2 size={12} /> Reset
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {swatches.filter((sw) => !sw.separated).map((sw) => {
                    const many = sw.parts.length > 1;
                    const isOpen = expanded === sw.key;
                    return (
                      <div key={`${sw.key}-${resetCount}`} className={cn("min-w-0", isOpen && "col-span-2")}>
                        <label
                          data-swatch={sw.key}
                          data-hot={hot === sw.key ? "" : undefined}
                          data-pinned={pinned === sw.key ? "" : undefined}
                          onMouseEnter={() => setSpot(sw.key)}
                          onMouseLeave={() => setSpot(null)}
                          title={`${sw.parts.length} part${sw.parts.length === 1 ? "" : "s"}: ${sw.parts.map((p) => p.name).join(", ")} — hover to see where it paints; pick a new colour to replace it everywhere`}
                          className={cn(
                            "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 hover:border-accent",
                            hot === sw.key || pinned === sw.key ? "border-accent bg-raised" : "border-edge",
                            pinned === sw.key && "ring-1 ring-accent",
                          )}
                        >
                          <input
                            ref={(el) => {
                              if (el) swatchRefs.current.set(sw.key, el);
                              else swatchRefs.current.delete(sw.key);
                            }}
                            type="color"
                            defaultValue={sw.hex}
                            onChange={(e) => queueColor(sw, e.target.value)}
                            className="h-5 w-6 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                          />
                          <span className="truncate font-mono text-[11px] text-muted">{sw.hex}</span>
                          <span className="readout ml-auto flex shrink-0 items-center gap-1 text-[10px]" title={sw.gradientUses ? `${sw.gradientUses} of ${sw.paints.length} uses are gradient stops` : undefined}>
                            {sw.gradientUses > 0 && <span className="text-faint">grad</span>}
                            {many ? `${sw.parts.length} parts` : "1 part"}
                          </span>
                          {many && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setExpanded(isOpen ? null : sw.key);
                                setTicked(new Set());
                              }}
                              className="shrink-0 text-faint hover:text-ink"
                              title="The parts this colour paints — tick some to give them a colour of their own"
                              aria-label={isOpen ? "Hide the parts" : "Show the parts"}
                              data-swatch-expand
                            >
                              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            </button>
                          )}
                        </label>
                        {isOpen && (
                          <div className="mt-1 space-y-1 rounded-[var(--radius-sm)] border border-edge bg-base p-2" data-swatch-parts={sw.key}>
                            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                              {sw.parts.map((p) => (
                                <li key={p.addr} onMouseEnter={() => setHoverPart(p.addr)} onMouseLeave={() => setHoverPart(null)} className="flex items-center gap-2 font-mono text-[11px] text-muted" data-swatch-part={p.addr}>
                                  <input
                                    type="checkbox"
                                    checked={ticked.has(p.addr)}
                                    onChange={(e) =>
                                      setTicked((t) => {
                                        const n = new Set(t);
                                        if (e.target.checked) n.add(p.addr);
                                        else n.delete(p.addr);
                                        return n;
                                      })
                                    }
                                    className="accent-[var(--accent)]"
                                  />
                                  <button type="button" onClick={() => setSelected(p.addr)} className="min-w-0 flex-1 truncate text-left hover:text-ink" title="Edit this part">
                                    {p.name} <span className="text-faint">· {layers[p.layer]?.name}</span>
                                  </button>
                                </li>
                              ))}
                            </ul>
                            <div className="flex flex-wrap items-center gap-2">
                              <button type="button" onClick={() => setTicked(new Set(sw.parts.map((p) => p.addr)))} className="font-mono text-[11px] text-faint hover:text-ink">
                                all
                              </button>
                              <button type="button" onClick={() => setTicked(new Set())} className="font-mono text-[11px] text-faint hover:text-ink">
                                none
                              </button>
                              <button type="button" onClick={() => separate(sw)} disabled={!ticked.size} className="ml-auto inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 font-mono text-[11px] text-ink hover:border-accent hover:text-accent disabled:opacity-40" title="The ticked parts keep this colour for now but get a swatch of their own, so each can be recoloured apart" data-swatch-separate>
                                Separate {ticked.size || ""}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                {swatches.some((sw) => sw.separated) && (
                  <>
                    <p className="readout mt-3 mb-1.5 text-[10px]">Separated · colours of their own</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {swatches.filter((sw) => sw.separated).map((sw) => (
                        <label
                          key={`${sw.key}-${resetCount}`}
                          data-swatch={sw.key}
                          data-separated
                          data-hot={hot === sw.key ? "" : undefined}
                          data-pinned={pinned === sw.key ? "" : undefined}
                          onMouseEnter={() => setSpot(sw.key)}
                          onMouseLeave={() => setSpot(null)}
                          title={`${sw.parts[0]?.name ?? "part"} — this paint alone`}
                          className={cn("flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] border px-2 py-1.5 hover:border-accent", hot === sw.key || pinned === sw.key ? "border-accent bg-raised" : "border-edge", pinned === sw.key && "ring-1 ring-accent")}
                        >
                          {sw.stops.length ? (
                            <span className="flex shrink-0 items-center gap-0.5">
                              {sw.stops.map((h, i) => (
                                <input
                                  key={`${i}-${h}`}
                                  ref={(el) => {
                                    if (i === 0) {
                                      if (el) swatchRefs.current.set(sw.key, el);
                                      else swatchRefs.current.delete(sw.key);
                                    }
                                  }}
                                  type="color"
                                  defaultValue={h}
                                  onChange={(e) => queueColor(sw, e.target.value, i)}
                                  className="h-5 w-4 cursor-pointer border-0 bg-transparent p-0"
                                  aria-label={`Stop ${i + 1}`}
                                />
                              ))}
                            </span>
                          ) : (
                            <input
                              ref={(el) => {
                                if (el) swatchRefs.current.set(sw.key, el);
                                else swatchRefs.current.delete(sw.key);
                              }}
                              type="color"
                              defaultValue={sw.hex}
                              onChange={(e) => queueColor(sw, e.target.value)}
                              className="h-5 w-6 shrink-0 cursor-pointer border-0 bg-transparent p-0"
                            />
                          )}
                          <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted" title={sw.parts[0]?.name}>
                            {sw.parts[0]?.name}
                          </span>
                          {!sw.key.startsWith("A") && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                dropOps((o) => !(o.t === "color" && o.at === sw.key));
                              }}
                              className="shrink-0 text-faint hover:text-ink"
                              title="Back to the shared colour"
                              aria-label="Back to the shared colour"
                              data-swatch-merge
                            >
                              <X size={12} />
                            </button>
                          )}
                        </label>
                      ))}
                    </div>
                  </>
                )}
                <p className="readout mt-2 text-[10px]">A swatch recolours every part it paints · expand one to give some of its parts a colour of their own · hover a swatch to see where it paints · click a part on the sticker to edit it</p>
              </div>
            )}

            <div className="panel registered space-y-3 p-4">
              <p className="readout">Export</p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => void exportTgs()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] bg-accent font-mono text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110 disabled:opacity-40"
                  data-tgs-export="tgs"
                >
                  {busy === "tgs" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  .tgs
                </button>
                <button
                  onClick={exportJson}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                  data-tgs-export="json"
                >
                  <Download size={13} /> Lottie .json
                </button>
                <button
                  onClick={() => void exportPng()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                  data-tgs-export="png"
                >
                  {busy === "png" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  PNG frame
                </button>
                <button
                  onClick={() => void exportGif()}
                  disabled={busy !== null}
                  className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius)] border border-edge font-mono text-xs text-ink hover:border-accent hover:text-accent disabled:opacity-40"
                  data-tgs-export="gif"
                >
                  {busy === "gif" ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
                  GIF{busy === "gif" && ` ${Math.round(gifProgress * 100)}%`}
                </button>
              </div>
              {note && <p className="font-mono text-xs text-muted">{note}</p>}
              {error && <p className="font-mono text-xs text-danger">{error}</p>}
              <p className="font-mono text-xs text-faint" data-tgs-link-note>
                {linkTooLong
                  ? `This sticker is too large to travel in a link (${formatBytes(Math.round(packedData.length * 0.75))} packed); Share carries the edits only.`
                  : "Share puts the sticker and every edit in the link, so it reopens here as it is now. Removed parts are left out of the exported file."}
              </p>
            </div>

            <div className="panel registered p-4">
              <p className="readout mb-3">Telegram sticker checks</p>
              <ul className="space-y-1.5">
                {checks.map((c) => (
                  <li key={c.label} className="flex items-center gap-2 font-mono text-xs">
                    {c.ok ? (
                      <Check size={13} className="shrink-0 text-positive" />
                    ) : (
                      <X size={13} className="shrink-0 text-danger" />
                    )}
                    <span className={c.ok ? "text-muted" : "text-ink"}>{c.label}</span>
                    <span className="ml-auto text-faint">{c.detail}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div></>} />
      )}
    </div>
  );
}
