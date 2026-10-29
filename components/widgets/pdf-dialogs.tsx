"use client";

/** PDF Studio's dialogs: split, crop by margins, protect, password, note, watermark, header & footer, compress, export pages as images, attach, stamp, signature. */
import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/tools/bytes";
import { parsePageRanges } from "@/lib/tools/files/pdf/ranges";
import { COMPRESS_PRESETS, type CompressOptions } from "@/lib/tools/files/pdf/compress";
import type { HeaderFooterInput, SlotPosition, WatermarkInput } from "@/lib/tools/files/pdf/stamps";
import type { FontStyle } from "@/lib/tools/files/pdf/fonts";
import type { Permissions } from "@/lib/tools/files/pdf/ops";
import { BTN, Choice, ColorField, Field, Modal, PRIMARY, PageScope, hexToRgb } from "./pdf-ui";
import { SIGNATURE_FONTS, removeWhiteBackground, signatureFromStrokes, signatureFromText, stampImage, type Point, type StampSpec } from "./pdf-render";
import { cn } from "@/lib/utils";

/** "all" | "current" | a range → 0-based pages, or an error. */
export function scopePages(scope: string, current: number, count: number): { ok: true; pages: number[] } | { ok: false; error: string } {
  if (scope === "all") return { ok: true, pages: Array.from({ length: count }, (_, i) => i) };
  if (scope === "current") return { ok: true, pages: [current - 1] };
  const r = parsePageRanges(scope, count);
  return r.ok ? { ok: true, pages: r.pages.map((p) => p - 1) } : r;
}

const NOTE_COLORS = ["#ffd54a", "#ff8a80", "#8ce99a", "#8ab4f8"];

export function NoteDialog({ color, onColor, author, onSave, onCancel }: { color: string; onColor(c: string): void; author: string; onSave(text: string): void; onCancel(): void }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <div role="dialog" aria-label="New note" className="absolute left-1/2 top-4 z-30 w-[min(320px,calc(100%-16px))] -translate-x-1/2 rounded-[var(--radius)] border border-edge bg-base p-2 shadow-pop" data-note-dialog onPointerDown={(e) => e.stopPropagation()}>
      <div className="mb-1 flex items-center gap-1.5 text-[11.5px] text-faint">
        <MessageSquarePlus size={12} />
        <span>{author || "New note"}</span>
        <span className="ml-auto flex items-center gap-1">
          {NOTE_COLORS.map((c) => (
            <button key={c} type="button" onClick={() => onColor(c)} className={cn("h-4 w-4 rounded-full border border-black/15", color === c && "ring-2 ring-accent")} style={{ background: c }} aria-label={`Colour ${c}`} />
          ))}
        </span>
      </div>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value.slice(0, 4000))}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) {
            e.preventDefault();
            onSave(text);
          }
        }}
        rows={3}
        placeholder="Write the note…"
        className="w-full resize-y rounded-[var(--radius-sm)] border border-edge bg-base px-2 py-1.5 text-[13px] leading-snug text-ink outline-none placeholder:text-faint focus:border-accent"
        data-note-text
      />
      <div className="mt-1.5 flex items-center gap-1">
        <button type="button" disabled={!text.trim()} onClick={() => onSave(text)} className={PRIMARY} data-note-save>
          Add note
        </button>
        <button type="button" onClick={onCancel} className={BTN}>
          Cancel
        </button>
        <span className="ml-auto text-[11px] text-faint">⌘↵</span>
      </div>
    </div>
  );
}

export function SplitDialog({ count, hasOutline, onClose, onSplit }: { count: number; hasOutline: boolean; onClose(): void; onSplit(mode: "every" | "ranges" | "chapters", every: number, ranges: string): void }) {
  const [mode, setMode] = useState<"every" | "ranges" | "chapters">("every");
  const [every, setEvery] = useState(1);
  const [ranges, setRanges] = useState("");
  const n = mode === "every" ? Math.ceil(count / Math.max(1, every)) : null;
  return (
    <Modal title="Split the document" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onSplit(mode, every, ranges);
        }}
      >
        <label className="flex items-center gap-2">
          <input type="radio" name="mode" checked={mode === "every"} onChange={() => setMode("every")} className="accent-[var(--accent)]" />
          <span>Every</span>
          <input type="number" min={1} max={count} value={every} onChange={(e) => setEvery(Math.max(1, Number(e.target.value) || 1))} className="input h-8 w-20 px-2 py-0" disabled={mode !== "every"} />
          <span className="text-muted">
            page{every > 1 ? "s" : ""} → {n} file{n === 1 ? "" : "s"}
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="mode" checked={mode === "ranges"} onChange={() => setMode("ranges")} className="mt-1 accent-[var(--accent)]" />
          <span className="flex-1">
            <span>By ranges, one file per line</span>
            <textarea value={ranges} onChange={(e) => setRanges(e.target.value)} rows={3} placeholder={"1-3\n4-6, 9\n7-"} className="input mt-1 font-mono text-[12.5px]" disabled={mode !== "ranges"} />
          </span>
        </label>
        <label className={cn("flex items-center gap-2", !hasOutline && "opacity-50")}>
          <input type="radio" name="mode" checked={mode === "chapters"} onChange={() => setMode("chapters")} disabled={!hasOutline} className="accent-[var(--accent)]" />
          <span>By the outline&apos;s top-level chapters</span>
        </label>
        <p className="text-[12px] text-faint">Several files download as one zip; the originals keep their comments and form values.</p>
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-split-go>
            Split
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function CropDialog({ pages, onClose, onCrop, onUncrop, onDraw }: { pages: number[]; onClose(): void; onCrop(inset: { top: number; right: number; bottom: number; left: number }): void; onUncrop(): void; onDraw(): void }) {
  const [mm, setMm] = useState({ top: 10, right: 10, bottom: 10, left: 10 });
  const pt = (v: number) => (v / 25.4) * 72;
  return (
    <Modal title={`Crop ${pages.length === 1 ? `page ${pages[0] + 1}` : `${pages.length} pages`}`} onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onCrop({ top: pt(mm.top), right: pt(mm.right), bottom: pt(mm.bottom), left: pt(mm.left) });
        }}
      >
        <p className="text-muted">Trim this much from each edge, in millimetres. Nothing is deleted: the crop box is what viewers show, and it can be removed again. To crop by eye, draw the area on the page with the Crop tool instead.</p>
        <div className="grid grid-cols-2 gap-2">
          {(["top", "right", "bottom", "left"] as const).map((k) => (
            <label key={k} className="flex items-center gap-2">
              <span className="w-14 capitalize text-muted">{k}</span>
              <input type="number" min={0} max={200} step={0.5} value={mm[k]} onChange={(e) => setMm((m) => ({ ...m, [k]: Number(e.target.value) || 0 }))} className="input h-8 px-2 py-0" data-crop={k} />
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-crop-go>
            Crop
          </button>
          <button type="button" onClick={onDraw} className={BTN} data-crop-draw>
            Draw the area…
          </button>
          <button type="button" onClick={onUncrop} className={BTN}>
            Remove crop
          </button>
          <button type="button" onClick={onClose} className={cn(BTN, "ml-auto")}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

const PERMS: { id: keyof Permissions; label: string }[] = [
  { id: "printing", label: "Print" },
  { id: "copying", label: "Copy text and pictures" },
  { id: "modifying", label: "Change the document" },
  { id: "annotating", label: "Comment and mark up" },
  { id: "fillingForms", label: "Fill in forms" },
  { id: "documentAssembly", label: "Insert, rotate or delete pages" },
];

export function ProtectDialog({ onClose, onProtect }: { onClose(): void; onProtect(user: string, owner: string, permissions: Permissions | undefined): void }) {
  const [user, setUser] = useState("");
  const [owner, setOwner] = useState("");
  const [restrict, setRestrict] = useState(false);
  const [perms, setPerms] = useState<Record<string, boolean>>({ printing: true, copying: true, modifying: false, annotating: true, fillingForms: true, documentAssembly: false });
  const needOwner = restrict && !owner;
  return (
    <Modal title="Protect with a password" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!user && !(restrict && owner)) return;
          const permissions: Permissions | undefined = restrict ? { printing: perms.printing ? "highResolution" : false, copying: perms.copying, modifying: perms.modifying, annotating: perms.annotating, fillingForms: perms.fillingForms, documentAssembly: perms.documentAssembly, contentAccessibility: true } : undefined;
          onProtect(user, owner || user, permissions);
        }}
      >
        <p className="text-muted">The document is encrypted with AES-256. PDF Studio keeps the password while you work and the file stays protected when you save.</p>
        <Field label="Password to open (leave empty to only restrict what readers may do)">
          <input type="password" value={user} onChange={(e) => setUser(e.target.value)} className="input h-9" autoFocus data-protect-user />
        </Field>
        <Field label="Owner password (to change permissions later)">
          <input type="password" value={owner} onChange={(e) => setOwner(e.target.value)} className="input h-9" data-protect-owner />
        </Field>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={restrict} onChange={(e) => setRestrict(e.target.checked)} className="accent-[var(--accent)]" /> Restrict what readers may do
        </label>
        {restrict && (
          <div className="grid grid-cols-2 gap-1.5 pl-5">
            {PERMS.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-[12.5px]">
                <input type="checkbox" checked={!!perms[p.id]} onChange={(e) => setPerms((s) => ({ ...s, [p.id]: e.target.checked }))} className="accent-[var(--accent)]" /> {p.label}
              </label>
            ))}
            <p className="col-span-2 text-[11.5px] text-faint">{needOwner ? "An owner password is needed for restrictions to hold." : "Readers that respect permissions (most do) will refuse the unticked actions without the owner password."}</p>
          </div>
        )}
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={(!user && !(restrict && owner)) || needOwner} className={PRIMARY} data-protect-go>
            Protect
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function PasswordDialog({ title, wrong, onClose, onSubmit }: { title: string; wrong: boolean; onClose(): void; onSubmit(pw: string): void }) {
  const [pw, setPw] = useState("");
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onSubmit(pw);
        }}
      >
        {wrong && <p className="text-danger">Wrong password — try again.</p>}
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" className="input h-9" autoFocus />
        <div className="flex gap-2">
          <button type="submit" disabled={!pw} className={PRIMARY}>
            Unlock
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ watermark */

const FAMILIES = [
  { id: "sans" as const, label: "Sans" },
  { id: "serif" as const, label: "Serif" },
  { id: "mono" as const, label: "Mono" },
];

function FontStyleFields({ style, onChange }: { style: FontStyle; onChange(s: FontStyle): void }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
      <span className="text-muted">Font</span>
      <Choice value={style.family} options={FAMILIES} onChange={(family) => onChange({ ...style, family })} />
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" checked={style.bold} onChange={(e) => onChange({ ...style, bold: e.target.checked })} className="accent-[var(--accent)]" /> Bold
      </label>
      <label className="inline-flex items-center gap-1">
        <input type="checkbox" checked={style.italic} onChange={(e) => onChange({ ...style, italic: e.target.checked })} className="accent-[var(--accent)]" /> Italic
      </label>
    </div>
  );
}

export function WatermarkDialog({ current, count, onClose, onApply }: { current: number; count: number; onClose(): void; onApply(input: WatermarkInput): void }) {
  const [text, setText] = useState("CONFIDENTIAL");
  const [size, setSize] = useState(0);
  const [color, setColor] = useState("#c0392b");
  const [opacity, setOpacity] = useState(0.2);
  const [angle, setAngle] = useState<"up" | "down" | "flat">("up");
  const [layout, setLayout] = useState<"center" | "tile">("center");
  const [style, setStyle] = useState<FontStyle>({ family: "sans", bold: true, italic: false });
  const [scope, setScope] = useState("all");
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Watermark" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          const pages = scopePages(scope, current, count);
          if (!pages.ok) return setError(pages.error);
          if (!text.trim()) return setError("Write the watermark's text.");
          onApply({ pages: pages.pages, text: text.trim(), size, color: hexToRgb(color), opacity, angle: angle === "up" ? 45 : angle === "down" ? -45 : 0, style, layout });
        }}
      >
        <Field label="Text">
          <input value={text} onChange={(e) => setText(e.target.value)} className="input h-9" autoFocus data-watermark-text />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">Size</span>
            <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="input h-8 w-28 px-2 py-0 text-[12px]">
              <option value={0}>Fit the page</option>
              {[24, 36, 48, 64, 96, 128].map((s) => (
                <option key={s} value={s}>
                  {s} pt
                </option>
              ))}
            </select>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">Opacity</span>
            <input type="range" min={5} max={100} value={Math.round(opacity * 100)} onChange={(e) => setOpacity(Number(e.target.value) / 100)} className="w-24 accent-[var(--accent)]" />
            <span className="tabular">{Math.round(opacity * 100)}%</span>
          </label>
        </div>
        <ColorField value={color} onChange={setColor} />
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <span className="text-muted">Angle</span>
          <Choice value={angle} options={[{ id: "up", label: "Diagonal ↗" }, { id: "down", label: "Diagonal ↘" }, { id: "flat", label: "Horizontal" }]} onChange={setAngle} />
          <Choice value={layout} options={[{ id: "center", label: "Once, centred" }, { id: "tile", label: "Tiled" }]} onChange={setLayout} />
        </div>
        <FontStyleFields style={style} onChange={setStyle} />
        <PageScope value={scope} onChange={setScope} current={current} count={count} />
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-watermark-go>
            Add the watermark
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* -------------------------------------------------------- header/footer */

const SLOTS: { pos: SlotPosition; label: string }[] = [
  { pos: "tl", label: "Top left" },
  { pos: "tc", label: "Top centre" },
  { pos: "tr", label: "Top right" },
  { pos: "bl", label: "Bottom left" },
  { pos: "bc", label: "Bottom centre" },
  { pos: "br", label: "Bottom right" },
];

const HF_PRESETS: { label: string; slots: Partial<Record<SlotPosition, string>> }[] = [
  { label: "Page n of N", slots: { bc: "Page {n} of {N}" } },
  { label: "Number, bottom right", slots: { br: "{n}" } },
  { label: "Title and date", slots: { tl: "{title}", tr: "{date}", bc: "{n} / {N}" } },
  { label: "Bates stamp", slots: { br: "DOC-{n:6}" } },
  { label: "File name", slots: { bl: "{file}", br: "{n}" } },
];

export function HeaderFooterDialog({ current, count, fileName, onClose, onApply }: { current: number; count: number; fileName: string; onClose(): void; onApply(input: HeaderFooterInput): void }) {
  const [slots, setSlots] = useState<Record<SlotPosition, string>>({ tl: "", tc: "", tr: "", bl: "", bc: "Page {n} of {N}", br: "" });
  const [size, setSize] = useState(10);
  const [color, setColor] = useState("#555555");
  const [style, setStyle] = useState<FontStyle>({ family: "sans", bold: false, italic: false });
  const [marginX, setMarginX] = useState(15);
  const [marginY, setMarginY] = useState(10);
  const [start, setStart] = useState(1);
  const [scope, setScope] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const pt = (mmv: number) => (mmv / 25.4) * 72;
  return (
    <Modal title="Header, footer and page numbers" onClose={onClose} wide>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          const pages = scopePages(scope, current, count);
          if (!pages.ok) return setError(pages.error);
          const list = SLOTS.filter((s) => slots[s.pos].trim()).map((s) => ({ pos: s.pos, text: slots[s.pos] }));
          if (!list.length) return setError("Write something in at least one position.");
          onApply({ pages: pages.pages, slots: list, size, color: hexToRgb(color), style, marginX: pt(marginX), marginY: pt(marginY), start, fields: { file: fileName.replace(/\.pdf$/i, "") } });
        }}
      >
        <div className="flex flex-wrap items-center gap-1 text-[12px]">
          <span className="text-muted">Presets</span>
          {HF_PRESETS.map((p) => (
            <button key={p.label} type="button" onClick={() => setSlots({ tl: "", tc: "", tr: "", bl: "", bc: "", br: "", ...p.slots })} className={BTN}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-3 gap-2">
          {SLOTS.map((s) => (
            <Field key={s.pos} label={s.label}>
              <input value={slots[s.pos]} onChange={(e) => setSlots((v) => ({ ...v, [s.pos]: e.target.value }))} className="input h-8 px-2 py-0 text-[12.5px]" data-hf-slot={s.pos} />
            </Field>
          ))}
        </div>
        <p className="text-[11.5px] text-faint">
          Placeholders: <code>{"{n}"}</code> page number, <code>{"{N}"}</code> page count, <code>{"{n:4}"}</code> zero-padded, <code>{"{title}"}</code>, <code>{"{author}"}</code>, <code>{"{date}"}</code>, <code>{"{file}"}</code>.
        </p>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">Size</span>
            <input type="number" min={5} max={36} value={size} onChange={(e) => setSize(Number(e.target.value) || 10)} className="input h-8 w-16 px-2 py-0" />
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">Margins</span>
            <input type="number" min={0} max={60} value={marginX} onChange={(e) => setMarginX(Number(e.target.value) || 0)} className="input h-8 w-16 px-2 py-0" aria-label="Side margin, mm" />
            <span className="text-faint">×</span>
            <input type="number" min={0} max={60} value={marginY} onChange={(e) => setMarginY(Number(e.target.value) || 0)} className="input h-8 w-16 px-2 py-0" aria-label="Top and bottom margin, mm" />
            <span className="text-faint">mm</span>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">First page is</span>
            <input type="number" min={-999} max={99999} value={start} onChange={(e) => setStart(Number(e.target.value) || 1)} className="input h-8 w-20 px-2 py-0" />
          </label>
        </div>
        <ColorField value={color} onChange={setColor} />
        <FontStyleFields style={style} onChange={setStyle} />
        <PageScope value={scope} onChange={setScope} current={current} count={count} />
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-hf-go>
            Add to the pages
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------- compress */

export function CompressDialog({ size, onClose, onApply }: { size: number; onClose(): void; onApply(options: CompressOptions): void }) {
  const [preset, setPreset] = useState<"light" | "balanced" | "strong" | "custom">("balanced");
  const [opts, setOpts] = useState<CompressOptions>(COMPRESS_PRESETS.balanced);
  const pick = (p: "light" | "balanced" | "strong") => {
    setPreset(p);
    setOpts(COMPRESS_PRESETS[p]);
  };
  const custom = (patch: Partial<Omit<CompressOptions, "images">> & { images?: Partial<CompressOptions["images"]> }) => {
    setPreset("custom");
    setOpts((o) => ({ ...o, ...patch, images: { ...o.images, ...(patch.images ?? {}) } }));
  };
  return (
    <Modal title="Compress the PDF" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          onApply(opts);
        }}
      >
        <p className="text-muted">
          Now {formatBytes(size)}. Pictures are re-encoded as JPEG at the resolution they are shown at, streams stored uncompressed are deflated, and objects nothing points at are dropped. Text, forms and comments stay as they are.
        </p>
        <Choice value={preset} options={[{ id: "light", label: "Light", title: "No change to pictures" }, { id: "balanced", label: "Balanced", title: "Pictures to 150 ppi, quality 80 %" }, { id: "strong", label: "Strong", title: "Pictures to 96 ppi, quality 60 %, metadata removed" }, ...(preset === "custom" ? [{ id: "custom" as const, label: "Custom" }] : [])]} onChange={(p) => p !== "custom" && pick(p)} />
        <div className="space-y-1.5 rounded-[var(--radius-sm)] border border-edge p-2.5">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={opts.images.enabled} onChange={(e) => custom({ images: { enabled: e.target.checked } })} className="accent-[var(--accent)]" /> Re-encode pictures
          </label>
          <div className={cn("flex flex-wrap items-center gap-3 pl-5 text-[12.5px]", !opts.images.enabled && "opacity-50")}>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-muted">At most</span>
              <select value={opts.images.maxDpi} onChange={(e) => custom({ images: { maxDpi: Number(e.target.value) } })} className="input h-8 w-24 px-2 py-0 text-[12px]" disabled={!opts.images.enabled}>
                {[300, 200, 150, 120, 96, 72].map((d) => (
                  <option key={d} value={d}>
                    {d} ppi
                  </option>
                ))}
              </select>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <span className="text-muted">Quality</span>
              <input type="range" min={30} max={95} value={Math.round(opts.images.quality * 100)} onChange={(e) => custom({ images: { quality: Number(e.target.value) / 100 } })} className="w-24 accent-[var(--accent)]" disabled={!opts.images.enabled} />
              <span className="tabular">{Math.round(opts.images.quality * 100)}%</span>
            </label>
            <label className="inline-flex items-center gap-1.5">
              <input type="checkbox" checked={opts.images.grayscale} onChange={(e) => custom({ images: { grayscale: e.target.checked } })} className="accent-[var(--accent)]" disabled={!opts.images.enabled} /> Greyscale
            </label>
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={opts.deflate} onChange={(e) => custom({ deflate: e.target.checked })} className="accent-[var(--accent)]" /> Deflate uncompressed streams
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={opts.dropUnused} onChange={(e) => custom({ dropUnused: e.target.checked })} className="accent-[var(--accent)]" /> Drop unused objects
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={opts.dropThumbnails} onChange={(e) => custom({ dropThumbnails: e.target.checked })} className="accent-[var(--accent)]" /> Drop page thumbnails
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={opts.dropMetadata} onChange={(e) => custom({ dropMetadata: e.target.checked })} className="accent-[var(--accent)]" /> Remove metadata (author, dates, XMP; the title stays)
          </label>
        </div>
        <p className="text-[11.5px] text-faint">Pictures in JPEG 2000, JBIG2 or fax encodings, and tiny ones, are left as they are. Undo brings the original back.</p>
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-compress-go>
            Compress
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------- export images */

export function ExportImagesDialog({ current, count, onClose, onExport }: { current: number; count: number; onClose(): void; onExport(input: { pages: number[]; dpi: number; format: "png" | "jpeg"; quality: number }): void }) {
  const [scope, setScope] = useState(count > 1 ? "all" : "current");
  const [dpi, setDpi] = useState(150);
  const [format, setFormat] = useState<"png" | "jpeg">("png");
  const [quality, setQuality] = useState(0.9);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Save pages as images" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          const pages = scopePages(scope, current, count);
          if (!pages.ok) return setError(pages.error);
          onExport({ pages: pages.pages, dpi, format, quality });
        }}
      >
        <PageScope value={scope} onChange={setScope} current={current} count={count} />
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <Choice value={format} options={[{ id: "png", label: "PNG" }, { id: "jpeg", label: "JPEG" }]} onChange={setFormat} />
          <label className="inline-flex items-center gap-1.5">
            <span className="text-muted">Resolution</span>
            <select value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="input h-8 w-24 px-2 py-0 text-[12px]">
              {[72, 96, 150, 200, 300].map((d) => (
                <option key={d} value={d}>
                  {d} ppi
                </option>
              ))}
            </select>
          </label>
          {format === "jpeg" && (
            <label className="inline-flex items-center gap-1.5">
              <span className="text-muted">Quality</span>
              <input type="range" min={50} max={100} value={Math.round(quality * 100)} onChange={(e) => setQuality(Number(e.target.value) / 100)} className="w-24 accent-[var(--accent)]" />
              <span className="tabular">{Math.round(quality * 100)}%</span>
            </label>
          )}
        </div>
        <p className="text-[11.5px] text-faint">One page downloads as a file; several download as a zip.</p>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-export-images-go>
            Save
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* --------------------------------------------------------------- attach */

export function AttachDialog({ file, onClose, onAttach }: { file: File; onClose(): void; onAttach(name: string, description: string): void }) {
  const [name, setName] = useState(file.name);
  const [description, setDescription] = useState("");
  return (
    <Modal title="Attach a file" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) onAttach(name.trim(), description.trim());
        }}
      >
        <p className="text-muted">
          {file.name} · {formatBytes(file.size)}
        </p>
        <Field label="Name inside the PDF">
          <input value={name} onChange={(e) => setName(e.target.value)} className="input h-9" data-attach-name />
        </Field>
        <Field label="Description (optional)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} className="input h-9" />
        </Field>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={!name.trim()} className={PRIMARY} data-attach-go>
            Attach
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------------------------------------------------------------- stamp */

const STAMP_PRESETS = ["APPROVED", "DRAFT", "CONFIDENTIAL", "FINAL", "REVIEWED", "RECEIVED", "PAID", "VOID", "COPY", "URGENT"];

export function StampDialog({ author, onClose, onUse }: { author: string; onClose(): void; onUse(blob: Blob): void }) {
  const [text, setText] = useState("APPROVED");
  const [withDate, setWithDate] = useState(true);
  const [withAuthor, setWithAuthor] = useState(!!author);
  const [color, setColor] = useState("#c0392b");
  const [shape, setShape] = useState<StampSpec["shape"]>("box");
  const [preview, setPreview] = useState<string | null>(null);
  const subtitle = [withAuthor && author ? author : "", withDate ? new Date().toISOString().slice(0, 10) : ""].filter(Boolean).join(" · ");
  const spec: StampSpec = { text: text || "STAMP", subtitle: subtitle || undefined, color, shape };
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    void stampImage(spec).then((b) => {
      if (!active) return;
      url = URL.createObjectURL(b);
      setPreview(url);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, subtitle, color, shape]);
  return (
    <Modal title="Stamp" onClose={onClose}>
      <form
        className="space-y-3 text-[13px]"
        onSubmit={(e) => {
          e.preventDefault();
          void stampImage(spec).then(onUse);
        }}
      >
        <div className="flex flex-wrap gap-1">
          {STAMP_PRESETS.map((p) => (
            <button key={p} type="button" onClick={() => setText(p)} className={cn(BTN, text === p && "border-accent text-accent")}>
              {p}
            </button>
          ))}
        </div>
        <Field label="Text">
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, 40))} className="input h-9" data-stamp-text />
        </Field>
        <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
          <label className="inline-flex items-center gap-1.5">
            <input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} className="accent-[var(--accent)]" /> Today&apos;s date
          </label>
          <label className={cn("inline-flex items-center gap-1.5", !author && "opacity-50")}>
            <input type="checkbox" checked={withAuthor} disabled={!author} onChange={(e) => setWithAuthor(e.target.checked)} className="accent-[var(--accent)]" /> Your name
          </label>
          <Choice value={shape} options={[{ id: "box", label: "Box" }, { id: "round", label: "Seal" }, { id: "plain", label: "Text only" }]} onChange={setShape} />
        </div>
        <ColorField value={color} onChange={setColor} />
        <div className="flex min-h-20 items-center justify-center rounded-[var(--radius-sm)] border border-dashed border-edge bg-raised/40 p-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {preview && <img src={preview} alt="Stamp preview" className="max-h-28 max-w-full" />}
        </div>
        <p className="text-[11.5px] text-faint">The stamp lands in the middle of the current page; drag it into place and resize it by its corners. It is saved as a stamp annotation.</p>
        <div className="flex gap-2 pt-1">
          <button type="submit" className={PRIMARY} data-stamp-go>
            Place the stamp
          </button>
          <button type="button" onClick={onClose} className={BTN}>
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

/* ------------------------------------------------------------ signature */

export function SignatureDialog({ saved, onClose, onUse, onForget }: { saved: string[]; onClose(): void; onUse(blob: Blob, remember: boolean): void; onForget(dataUrl: string): void }) {
  const [tab, setTab] = useState<"draw" | "type" | "upload" | "saved">(saved.length ? "saved" : "draw");
  const [color, setColor] = useState("#1b1b1f");
  const [width, setWidth] = useState(2.5);
  const [typed, setTyped] = useState("");
  const [font, setFont] = useState(SIGNATURE_FONTS[0].id);
  const [upload, setUpload] = useState<File | null>(null);
  const [clean, setClean] = useState(true);
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const [strokeCount, setStrokeCount] = useState(0);
  const BOX = { width: 480, height: 180 };

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, BOX.width, BOX.height);
    ctx.strokeStyle = "rgba(127,127,127,0.5)";
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(24, BOX.height - 40);
    ctx.lineTo(BOX.width - 24, BOX.height - 40);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = color;
    for (const s of strokes.current) {
      for (let i = 1; i < s.length; i++) {
        ctx.lineWidth = width * (0.6 + 0.8 * ((s[i - 1].p + s[i].p) / 2));
        ctx.beginPath();
        ctx.moveTo(s[i - 1].x, s[i - 1].y);
        ctx.lineTo(s[i].x, s[i].y);
        ctx.stroke();
      }
    }
  };
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = BOX.width * dpr;
    c.height = BOX.height * dpr;
    redraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, color, width]);

  const drawing = useRef(false);
  const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * BOX.width, y: ((e.clientY - r.top) / r.height) * BOX.height, p: e.pressure || 0.5 };
  };

  const use = async () => {
    setError(null);
    try {
      let blob: Blob;
      if (tab === "draw") {
        if (!strokes.current.length) return setError("Draw your signature first.");
        blob = await signatureFromStrokes(strokes.current, color, width, BOX);
      } else if (tab === "type") {
        if (!typed.trim()) return setError("Type your name first.");
        blob = await signatureFromText(typed.trim(), font, color);
      } else if (tab === "upload") {
        if (!upload) return setError("Choose a picture of your signature.");
        blob = clean ? await removeWhiteBackground(upload) : upload;
      } else return;
      onUse(blob, remember);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Modal title="Sign" onClose={onClose} wide>
      <div className="space-y-3 text-[13px]">
        <Choice value={tab} options={[...(saved.length ? [{ id: "saved" as const, label: `Saved (${saved.length})` }] : []), { id: "draw", label: "Draw" }, { id: "type", label: "Type" }, { id: "upload", label: "Picture" }]} onChange={setTab} />
        {tab === "saved" && (
          <div className="grid grid-cols-2 gap-2">
            {saved.map((s) => (
              <div key={s} className="group relative rounded-[var(--radius-sm)] border border-edge bg-white p-2">
                <button type="button" onClick={() => void fetch(s).then((r) => r.blob()).then((b) => onUse(b, false))} className="block w-full" data-signature-saved>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s} alt="Saved signature" className="mx-auto max-h-20" />
                </button>
                <button type="button" onClick={() => onForget(s)} className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded border border-edge bg-base text-faint hover:text-danger group-hover:flex" aria-label="Forget this signature">
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {tab === "draw" && (
          <>
            <canvas
              ref={canvasRef}
              className="block w-full touch-none rounded-[var(--radius-sm)] border border-edge bg-white"
              style={{ aspectRatio: `${BOX.width} / ${BOX.height}` }}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = true;
                strokes.current.push([point(e)]);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                strokes.current[strokes.current.length - 1].push(point(e));
                redraw();
              }}
              onPointerUp={() => {
                drawing.current = false;
                setStrokeCount(strokes.current.length);
              }}
              data-signature-canvas
            />
            <div className="flex flex-wrap items-center gap-3 text-[12.5px]">
              <ColorField value={color} onChange={setColor} label="Ink" />
              <label className="inline-flex items-center gap-1.5">
                <span className="text-muted">Pen</span>
                <input type="range" min={1} max={6} step={0.5} value={width} onChange={(e) => setWidth(Number(e.target.value))} className="w-20 accent-[var(--accent)]" />
              </label>
              <button
                type="button"
                className={BTN}
                disabled={!strokeCount}
                onClick={() => {
                  strokes.current = [];
                  setStrokeCount(0);
                  redraw();
                }}
              >
                Clear
              </button>
            </div>
          </>
        )}
        {tab === "type" && (
          <>
            <input value={typed} onChange={(e) => setTyped(e.target.value.slice(0, 60))} placeholder="Your name" className="input h-10 text-[16px]" autoFocus data-signature-text />
            <div className="grid grid-cols-2 gap-2">
              {SIGNATURE_FONTS.map((f) => (
                <button key={f.id} type="button" onClick={() => setFont(f.id)} className={cn("rounded-[var(--radius-sm)] border px-3 py-2 text-left text-[22px] leading-tight", font === f.id ? "border-accent" : "border-edge")} style={{ fontFamily: f.family, fontStyle: f.id === "serif" ? "italic" : undefined, color }}>
                  {typed || "Your name"}
                  <span className="block font-sans text-[10.5px] not-italic text-faint">{f.label}</span>
                </button>
              ))}
            </div>
            <ColorField value={color} onChange={setColor} label="Ink" />
          </>
        )}
        {tab === "upload" && (
          <>
            <input type="file" accept="image/*" onChange={(e) => setUpload(e.target.files?.[0] ?? null)} className="text-[12.5px]" data-signature-file />
            <label className="flex items-center gap-2 text-[12.5px]">
              <input type="checkbox" checked={clean} onChange={(e) => setClean(e.target.checked)} className="accent-[var(--accent)]" /> Make the white background transparent
            </label>
          </>
        )}
        {tab !== "saved" && (
          <label className="flex items-center gap-2 text-[12.5px]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-[var(--accent)]" /> Remember this signature in this browser
          </label>
        )}
        <p className="text-[11.5px] text-faint">The signature lands in the middle of the current page as a stamp you can move and resize. This is a visual signature, not a cryptographic one.</p>
        {error && <p className="text-[12px] text-danger">{error}</p>}
        {tab !== "saved" && (
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={() => void use()} className={PRIMARY} data-signature-go>
              Place the signature
            </button>
            <button type="button" onClick={onClose} className={BTN}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
