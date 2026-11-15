"use client";

/**
 * The Colour tab's conversion picker: a look chosen from groups (Standard, Day, Dusk, Night, Other), the frame at the
 * playhead through every look of the chosen group to pick from by eye, and one line on what the look is for with its
 * measurements folded away. Every D-Log M look is built on DJI's own LUT file, served by this site. The saved value
 * stays the clip's LutKind.
 */

import { useEffect, useRef, useState } from "react";
import { LUT_GROUPS, LUT_LOOKS, LUT_OPTIONS, buildDlogLut, gradePixel, lookOfKind, type Lut3D } from "@/lib/tools/video/lut";
import { isFileLutKind, type FileLutKind, type Grade, type LutKind, type MathLutKind } from "@/lib/tools/video/project";
import { cn } from "@/lib/utils";
import { SEL } from "./video-styles";

const THUMB_W = 132;
const modelLuts = new Map<MathLutKind, Lut3D>();
function modelLut(kind: MathLutKind): Lut3D {
  let lut = modelLuts.get(kind);
  if (!lut) modelLuts.set(kind, (lut = buildDlogLut(kind)));
  return lut;
}

export function LookPicker({
  grade,
  onKind,
  customName,
  onLoadCube,
  fileLuts,
  video,
  playhead,
  playing,
}: {
  grade: Grade;
  onKind: (kind: LutKind) => void;
  /** The project's own .cube, when one is loaded. */
  customName: string | null;
  onLoadCube: () => void;
  /** The conversions derived from DJI's file, once it has loaded. */
  fileLuts: Partial<Record<FileLutKind, Lut3D>> | null;
  /** The element holding the ungraded frame at the playhead. */
  video: () => HTMLVideoElement | null;
  playhead: number;
  playing: boolean;
}) {
  const look = lookOfKind(grade.lut);
  const option = LUT_OPTIONS.find((o) => o.kind === grade.lut) ?? null;
  const group = look && look.group !== "Other" ? LUT_LOOKS.filter((l) => l.group === look.group) : [];
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const scratch = useRef<HTMLCanvasElement | null>(null);
  const [shape, setShape] = useState(9 / 16);

  const groupKey = group.map((l) => l.id).join(",");
  const still = playing ? -1 : playhead;
  useEffect(() => {
    if (!groupKey) return;
    let stopped = false;
    const render = () => {
      const v = video();
      if (stopped || !v || v.readyState < 2 || !v.videoWidth) return;
      const w = THUMB_W, h = Math.max(1, Math.round((w * v.videoHeight) / v.videoWidth));
      const s = (scratch.current ??= document.createElement("canvas"));
      if (s.width !== w || s.height !== h) {
        s.width = w;
        s.height = h;
      }
      const sctx = s.getContext("2d", { willReadFrequently: true });
      if (!sctx) return;
      let src: ImageData;
      try {
        sctx.drawImage(v, 0, 0, w, h);
        src = sctx.getImageData(0, 0, w, h);
      } catch {
        return;
      }
      setShape(h / w);
      for (const l of LUT_LOOKS) {
        const c = canvases.current.get(l.id);
        if (!c) continue;
        const kind = l.kind;
        const lut = isFileLutKind(kind) ? (fileLuts?.[kind] ?? null) : modelLut(kind);
        if (!lut) {
          c.dataset.ready = "";
          continue;
        }
        if (c.width !== w || c.height !== h) {
          c.width = w;
          c.height = h;
        }
        const out = new ImageData(w, h), g = { ...grade, lut: kind as LutKind };
        for (let i = 0; i < src.data.length; i += 4) {
          const o = gradePixel([src.data[i] / 255, src.data[i + 1] / 255, src.data[i + 2] / 255], g, lut);
          out.data[i] = Math.round(o[0] * 255);
          out.data[i + 1] = Math.round(o[1] * 255);
          out.data[i + 2] = Math.round(o[2] * 255);
          out.data[i + 3] = 255;
        }
        c.getContext("2d")?.putImageData(out, 0, 0);
        c.dataset.ready = "1";
      }
    };
    // A seek lands a little after the playhead moves; while playing the strip follows a few times a second.
    const first = setTimeout(render, 160);
    const again = setTimeout(render, 600);
    const tick = playing ? setInterval(render, 700) : null;
    const v = video();
    v?.addEventListener("seeked", render);
    return () => {
      stopped = true;
      clearTimeout(first);
      clearTimeout(again);
      if (tick) clearInterval(tick);
      v?.removeEventListener("seeked", render);
    };
  }, [groupKey, still, playing, grade, fileLuts, video]);

  const value = grade.lut === "none" || grade.lut === "custom" ? grade.lut : (look?.id ?? "none");
  return (
    <div className="flex flex-col gap-2" data-look-picker data-look={look?.id ?? grade.lut}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-w-0 flex-1 items-center justify-between gap-2 text-muted">
          Look
          <select
            value={value}
            onChange={(e) => {
              const id = e.target.value;
              if (id === "none") return onKind("none");
              if (id === "custom") return customName ? onKind("custom") : onLoadCube();
              const picked = LUT_LOOKS.find((l) => l.id === id);
              if (picked) onKind(picked.kind);
            }}
            className={cn(SEL, "min-w-0")}
            aria-label="Look"
          >
            <option value="none">None (Rec.709 footage)</option>
            {LUT_GROUPS.map((g) => (
              <optgroup key={g} label={g}>
                {LUT_LOOKS.filter((l) => l.group === g).map((l) => (
                  <option key={l.id} value={l.id}>
                    {g === "Dusk" || g === "Night" ? `${g}: ${l.short}` : l.short}
                  </option>
                ))}
                {g === "Other" && <option value="custom">{customName ? `Your .cube — ${customName}` : "Your own .cube file…"}</option>}
              </optgroup>
            ))}
          </select>
        </label>
      </div>
      {group.length > 0 && (
        <div className="grid grid-cols-3 gap-1.5" role="group" aria-label={`${look?.group} looks on the frame at the playhead`} data-look-strip={look?.group}>
          {group.map((l) => {
            const on = l.id === look?.id;
            return (
              <button
                key={l.id}
                type="button"
                aria-pressed={on}
                data-look-thumb={l.id}
                title={l.use}
                onClick={() => onKind(l.kind)}
                className={cn("flex min-w-0 flex-col gap-1 rounded-[var(--radius-sm)] border p-1 text-left text-[11.5px] transition-colors", on ? "border-accent text-ink" : "border-edge text-muted hover:border-accent hover:text-ink")}
              >
                <canvas
                  ref={(el) => {
                    if (el) canvases.current.set(l.id, el);
                    else canvases.current.delete(l.id);
                  }}
                  width={THUMB_W}
                  height={Math.round(THUMB_W * shape)}
                  className="w-full rounded-[2px] bg-raised"
                  style={{ aspectRatio: `${1 / shape}` }}
                  aria-hidden
                />
                <span className="truncate px-0.5">{l.short}</span>
              </button>
            );
          })}
        </div>
      )}
      {option ? (
        <div className="text-[12px]" data-look-hint>
          <p className="text-muted">{option.use}</p>
          <details className="mt-1 text-faint">
            <summary className="cursor-pointer select-none hover:text-accent">Details</summary>
            <p className="mt-1">
              <span className="text-muted">{option.name}.</span> {option.hint}
            </p>
          </details>
        </div>
      ) : (
        <p className="text-[12px] text-faint" data-look-hint>
          {grade.lut === "custom" ? `${customName ?? "No file yet"} is applied as-is: it should expect the camera's log in and give Rec.709 out.` : "Pick the look for the camera's log profile; the sliders below fine-tune on top of it."}
        </p>
      )}
    </div>
  );
}
