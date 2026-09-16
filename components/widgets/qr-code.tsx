"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import QRCodeStyling, {
  type DotType,
  type CornerSquareType,
  type CornerDotType,
  type Options,
} from "qr-code-styling";
import { Download, ImageUp, Type, X } from "lucide-react";
import { cn } from "@/lib/utils";

const LEVELS = ["L", "M", "Q", "H"] as const;
const DOT_TYPES: [DotType, string][] = [
  ["square", "Square"],
  ["rounded", "Rounded"],
  ["dots", "Dots"],
  ["classy", "Classy"],
  ["classy-rounded", "Classy+"],
  ["extra-rounded", "Extra"],
];
const CORNER_SQUARE: [CornerSquareType, string][] = [
  ["square", "Square"],
  ["dot", "Dot"],
  ["extra-rounded", "Rounded"],
];
const CORNER_DOT: [CornerDotType, string][] = [
  ["square", "Square"],
  ["dot", "Dot"],
];

/** Render center label text to a transparent-background data URL. */
function textToDataUrl(text: string, color: string): string {
  const size = 240;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.font = `700 ${text.length > 4 ? 48 : 72}px ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text.slice(0, 8), size / 2, size / 2, size * 0.9);
  return c.toDataURL();
}

export function QrCodeWidget() {
  const [content, setContent] = useQueryState(
    "i",
    parseAsString.withDefault("https://bench.tools").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [ec, setEc] = useQueryState(
    "ec",
    parseAsString.withDefault("M").withOptions({ history: "replace" }),
  );
  const [dotType, setDotType] = useState<DotType>("rounded");
  const [cornerSq, setCornerSq] = useState<CornerSquareType>("extra-rounded");
  const [cornerDot, setCornerDot] = useState<CornerDotType>("dot");
  const [fg, setFg] = useState("#0b0d0e");
  const [bg, setBg] = useState("#ffffff");
  const [gradient, setGradient] = useState(false);
  const [fg2, setFg2] = useState("#7c5cff");
  const [margin, setMargin] = useState(8);
  const [logo, setLogo] = useState<string | null>(null);
  const [centerText, setCenterText] = useState("");
  const [imageSize, setImageSize] = useState(0.4);

  const container = useRef<HTMLDivElement>(null);
  const qr = useRef<QRCodeStyling | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const hasCenter = Boolean(logo || centerText);

  useEffect(() => {
    if (!container.current || !content) return;
    const image = logo ?? (centerText ? textToDataUrl(centerText, fg) : undefined);
    const opts: Partial<Options> = {
      width: 460,
      height: 460,
      type: "canvas",
      data: content,
      margin,
      qrOptions: { errorCorrectionLevel: (hasCenter ? "H" : ec) as "L" | "M" | "Q" | "H" },
      image,
      imageOptions: { imageSize, margin: 6, hideBackgroundDots: true, crossOrigin: "anonymous" },
      dotsOptions: {
        type: dotType,
        color: fg,
        gradient: gradient
          ? { type: "linear", rotation: 0.79, colorStops: [{ offset: 0, color: fg }, { offset: 1, color: fg2 }] }
          : undefined,
      },
      cornersSquareOptions: { type: cornerSq, color: gradient ? fg2 : fg },
      cornersDotOptions: { type: cornerDot, color: fg },
      backgroundOptions: { color: bg },
    };

    if (!qr.current) {
      qr.current = new QRCodeStyling(opts);
      container.current.innerHTML = "";
      qr.current.append(container.current);
    } else {
      qr.current.update(opts);
    }
  }, [content, ec, dotType, cornerSq, cornerDot, fg, bg, gradient, fg2, margin, logo, centerText, imageSize, hasCenter]);

  const onLogo = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLogo(typeof reader.result === "string" ? reader.result : null);
      setCenterText("");
    };
    reader.readAsDataURL(file);
  };

  const download = (extension: "png" | "svg") =>
    qr.current?.download({ name: "qr", extension });

  return (
    <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
      {/* controls */}
      <div className="panel registered flex flex-col">
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">Content</span>
          <div className="flex items-center gap-2">
            {content && (
              <button onClick={() => setContent("")} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
                <X size={12} /> Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          spellCheck={false}
          placeholder="URL, text, Wi-Fi, vCard…"
          className="min-h-[88px] resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
        />

        <div className="grid gap-4 border-t border-edge p-4 sm:grid-cols-2">
          <Select label="Dot style" value={dotType} options={DOT_TYPES} onChange={(v) => setDotType(v as DotType)} />
          <Select label="Corner frame" value={cornerSq} options={CORNER_SQUARE} onChange={(v) => setCornerSq(v as CornerSquareType)} />
          <Select label="Corner dot" value={cornerDot} options={CORNER_DOT} onChange={(v) => setCornerDot(v as CornerDotType)} />
          <div>
            <p className="readout mb-1.5">Error correction {hasCenter && "· forced H"}</p>
            <div className={cn("flex rounded-[var(--radius-sm)] border border-edge p-0.5", hasCenter && "opacity-50")}>
              {LEVELS.map((l) => (
                <button key={l} disabled={hasCenter} onClick={() => setEc(l)} className={cn("h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors", (hasCenter ? "H" : ec) === l ? "bg-accent text-on-accent" : "text-muted hover:text-ink")}>
                  {l}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="grid gap-4 border-t border-edge p-4 sm:grid-cols-2">
          <ColorField label="Foreground" value={fg} onChange={setFg} />
          <ColorField label="Background" value={bg} onChange={setBg} />
          <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
            <Toggle label="Gradient" active={gradient} onClick={() => setGradient((v) => !v)} />
            {gradient && <ColorChip value={fg2} onChange={setFg2} />}
            <div className="ml-auto flex items-center gap-2">
              <span className="readout">Quiet zone</span>
              <input type="range" min={0} max={20} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
            </div>
          </div>
        </div>

        {/* center logo / text */}
        <div className="space-y-3 border-t border-edge p-4">
          <p className="readout">Center</p>
          <input ref={fileInput} type="file" accept="image/*" hidden onChange={(e) => onLogo(e.target.files?.[0])} />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => fileInput.current?.click()} className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent">
              <ImageUp size={14} /> Upload logo
            </button>
            <div className="relative flex items-center">
              <Type size={13} className="absolute left-2.5 text-faint" />
              <input
                value={centerText}
                onChange={(e) => { setCenterText(e.target.value); if (e.target.value) setLogo(null); }}
                placeholder="or center text"
                maxLength={8}
                className="input h-9 w-36 pl-8"
              />
            </div>
            {logo && (
              <button onClick={() => setLogo(null)} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
                <X size={12} /> Remove logo
              </button>
            )}
          </div>
          {hasCenter && (
            <div className="flex items-center gap-2">
              <span className="readout">Logo size</span>
              <input type="range" min={0.2} max={0.5} step={0.02} value={imageSize} onChange={(e) => setImageSize(Number(e.target.value))} className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]" />
            </div>
          )}
        </div>
      </div>

      {/* preview */}
      <div className="panel registered flex flex-col p-4">
        <div className="registered flex flex-1 items-center justify-center overflow-hidden rounded-[var(--radius)] border border-edge bg-base bg-ticks p-4">
          {content ? (
            <div ref={container} className="w-full max-w-[300px] [&_canvas]:h-auto [&_canvas]:w-full [&_canvas]:rounded [&_svg]:h-auto [&_svg]:w-full" />
          ) : (
            <p className="font-mono text-xs text-faint">Enter content to generate a QR code.</p>
          )}
        </div>
        {content && (
          <div className="mt-3 flex gap-2">
            <button onClick={() => download("png")} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent font-mono text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110">
              <Download size={13} /> PNG
            </button>
            <button onClick={() => download("svg")} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] border border-edge font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent">
              <Download size={13} /> SVG
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- controls */

function Select({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="readout mb-1.5">{label}</p>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input h-9 text-xs">
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <p className="readout mb-1.5">{label}</p>
      <label className="flex h-9 items-center gap-2 rounded-[var(--radius-sm)] border border-edge px-2">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="font-mono text-xs uppercase text-muted">{value}</span>
      </label>
    </div>
  );
}

function ColorChip({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="h-4 w-4 cursor-pointer rounded border-0 bg-transparent p-0" />
      <span className="font-mono text-[10px] uppercase text-muted">{value}</span>
    </label>
  );
}

function Toggle({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={cn("inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 py-1.5 font-mono text-xs transition-colors", active ? "border-accent text-accent" : "border-edge text-muted hover:text-ink")}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-accent" : "bg-faint")} />
      {label}
    </button>
  );
}
