"use client";

/**
 * File Metadata Viewer & Editor — drop or open any file, read every piece of metadata its bytes carry, and write
 * metadata back: add or change fields, and above all a GPS location, using each container's own public convention.
 * Reading is bounded (a multi-gigabyte video is never loaded whole — only its moov atom is read), and the SHA-256 is
 * streamed so any size works. Saving writes in place (when the file was opened through the picker) or to a copy. The
 * heavy parsing/building is pure (lib/tools/files/metadata*.ts); this widget adds the browser pieces: pdf.js, image
 * dimensions, the File System Access API and the map.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Crosshair, Download, FileSearch, Loader2, MapPin, Pencil, Save, Sparkles, Trash2, Upload, X } from "lucide-react";
import { readAll, pdfGroups, type MetaReport, type MetaGroup, type PdfMeta } from "@/lib/tools/files/metadata";
import { readForMeta, type MoovInfo } from "@/lib/tools/files/metadata-io";
import { sha256OfBlob } from "@/lib/tools/files/sha256-stream";
import { editCapabilities, writeJpegMeta, writePngMeta, writeWebpMeta, writeMp3Meta, editBmffMoov, type MetaEdits, type EditCaps } from "@/lib/tools/files/metadata-write";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import { useUnsavedWork } from "@/lib/unsaved-work";

type FsFileHandle = { getFile(): Promise<File>; createWritable(opts?: { keepExistingData?: boolean }): Promise<FsWritable>; name: string };
type FsWritable = { write(data: Uint8Array | Blob | { type: "write"; position: number; data: Uint8Array | Blob }): Promise<void>; truncate(size: number): Promise<void>; close(): Promise<void> };
const hasOpenPicker = () => typeof window !== "undefined" && "showOpenFilePicker" in window;
const hasSavePicker = () => typeof window !== "undefined" && "showSaveFilePicker" in window;

const BTN = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";
const PRIMARY = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
const INP = "h-8 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-xs text-ink focus:border-accent focus:outline-none";

function fmtPdfDate(v: string): string {
  const m = /^D:(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/.exec(v);
  if (!m) return v;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

async function pdfMeta(bytes: Uint8Array): Promise<PdfMeta | null> {
  try {
    const { openPdf } = await import("@/lib/tools/files/pdf/pdfjs");
    const doc = await openPdf(bytes);
    const md = await doc.getMetadata();
    const rawInfo = (md.info ?? {}) as Record<string, unknown>;
    const info: Record<string, string> = {};
    const LABELS: Record<string, string> = { Title: "Title", Author: "Author", Subject: "Subject", Keywords: "Keywords", Creator: "Creator", Producer: "Producer", CreationDate: "Created", ModDate: "Modified", PDFFormatVersion: "PDF version" };
    for (const [k, label] of Object.entries(LABELS)) {
      const v = rawInfo[k];
      if (v == null || v === "") continue;
      info[label] = k.endsWith("Date") ? fmtPdfDate(String(v)) : String(v);
    }
    if (rawInfo.IsLinearized != null) info["Linearized (fast web view)"] = rawInfo.IsLinearized ? "yes" : "no";
    if (rawInfo.IsAcroFormPresent) info["Has form fields"] = "yes";
    if (rawInfo.EncryptFilterName) info["Encryption"] = String(rawInfo.EncryptFilterName);
    let pageSize: string | undefined;
    const pages = doc.numPages;
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const mm = (pt: number) => Math.round((pt * 25.4) / 72);
      pageSize = `${Math.round(vp.width)} × ${Math.round(vp.height)} pt (${mm(vp.width)} × ${mm(vp.height)} mm)`;
    } catch { /* ignore */ }
    let xmp: Record<string, string> | undefined;
    const meta = md.metadata as { getAll?: () => Record<string, string> } | null;
    if (meta?.getAll) {
      const all = meta.getAll();
      if (all && Object.keys(all).length) xmp = all;
    }
    return { info, pages, pageSize, xmp };
  } catch {
    return null;
  }
}

async function imageDims(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bmp = await createImageBitmap(blob);
    const d = { width: bmp.width, height: bmp.height };
    bmp.close();
    return d;
  } catch {
    return null;
  }
}

const AI_WORD: Record<string, string> = { "declared-generated": "Declares AI-generated", "declared-edited": "Declares AI editing", hinted: "Hints at AI", none: "No AI declaration found" };

function GroupPanel({ group }: { group: MetaGroup }) {
  return (
    <div className="panel flex flex-col" data-meta-group={group.title}>
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <span className="readout">{group.title}</span>
        <span className="readout text-faint">{group.source}</span>
      </div>
      <dl className="divide-y divide-edge">
        {group.entries.map((e) => (
          <div key={e.label} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:gap-3" data-meta-row={e.label}>
            <dt className="shrink-0 font-mono text-xs text-muted sm:w-48">{e.label}</dt>
            <dd className="min-w-0 flex-1 break-words font-mono text-xs text-ink">
              {e.href ? (
                <a href={e.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">{e.value}</a>
              ) : e.value}
              {e.hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{e.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Field keys the editor can show, and their friendly labels. */
const FIELD_LABEL: Record<string, string> = { title: "Title", artist: "Artist / author", description: "Description / comment", make: "Camera make", model: "Camera model", copyright: "Copyright", dateTime: "Date / time" };
type FieldKey = keyof typeof FIELD_LABEL;

/** Pull the current value of a field out of the report (best effort, by the entry label's suffix). */
function current(report: MetaReport, suffixes: string[]): string {
  for (const [k, v] of Object.entries(report.flat)) for (const s of suffixes) if (k.endsWith(`· ${s}`)) return v;
  return "";
}
function primeFields(report: MetaReport): Record<FieldKey, string> {
  return {
    title: current(report, ["Title"]),
    artist: current(report, ["Artist", "Author"]),
    description: current(report, ["Description", "Comment"]),
    make: current(report, ["Make"]),
    model: current(report, ["Model"]),
    copyright: current(report, ["Copyright"]),
    dateTime: current(report, ["Taken", "Date", "Created"]),
  };
}

interface Source {
  blob: Blob;
  handle: FsFileHandle | null;
  name: string;
  ext: string;
  moov: MoovInfo | null;
  dims: { width: number; height: number } | null;
}

export function FileMetadataWidget() {
  const [report, setReport] = useState<MetaReport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [truncated, setTruncated] = useState(false);

  const [source, setSource] = useState<Source | null>(null);
  const [caps, setCaps] = useState<EditCaps | null>(null);
  const [fields, setFields] = useState<Record<FieldKey, string>>({ title: "", artist: "", description: "", make: "", model: "", copyright: "", dateTime: "" });
  const [initial, setInitial] = useState<Record<FieldKey, string>>({ title: "", artist: "", description: "", make: "", model: "", copyright: "", dateTime: "" });
  const [lat, setLat] = useState(""); const [lon, setLon] = useState(""); const [alt, setAlt] = useState("");
  const [locInit, setLocInit] = useState({ lat: "", lon: "", alt: "" });
  const [removeLoc, setRemoveLoc] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const runRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useUnsavedWork(busy || saving ? "A file is being read or written." : report ? "The loaded file's report will be lost." : null);

  const analyzeSource = useCallback(async (blob: Blob, name: string, handle: FsFileHandle | null) => {
    const run = ++runRef.current;
    setFileName(name); setError(null); setReport(null); setSaveMsg(null); setRemoveLoc(false);
    setBusy(true); setProgress("reading…");
    try {
      const [{ bytes, truncated: trunc, moov }, sha256] = await Promise.all([
        readForMeta(blob, name),
        sha256OfBlob(blob, (done, total) => run === runRef.current && setProgress(total ? `hashing ${Math.round((done / total) * 100)}%` : "hashing")),
      ]);
      if (run !== runRef.current) return;
      setProgress("parsing…");
      const rep = await readAll({ name, size: blob.size, type: blob.type, lastModified: blob instanceof File ? blob.lastModified || null : null }, bytes, { sha256 });
      if (run !== runRef.current) return;

      let dims: { width: number; height: number } | null = null;
      if (rep.sniff.kind === "image" && rep.sniff.ext !== "svg") {
        dims = await imageDims(blob);
        if (dims) {
          const fileGroup = rep.groups.find((g) => g.title === "File");
          const text = `${dims.width} × ${dims.height} px`;
          if (fileGroup && !fileGroup.entries.some((e) => e.label === "Dimensions")) fileGroup.entries.splice(1, 0, { label: "Dimensions", value: text });
          rep.flat["File · Dimensions"] = text;
        }
      }
      if (rep.sniff.ext === "pdf" && !trunc) {
        const pm = await pdfMeta(bytes);
        if (run !== runRef.current) return;
        if (pm) { rep.groups.push(...pdfGroups(pm)); for (const g of pdfGroups(pm)) for (const e of g.entries) rep.flat[`${g.title} · ${e.label}`] = e.value; }
      }
      if (run !== runRef.current) return;
      setReport({ ...rep });
      setTruncated(trunc);
      setSource({ blob, handle, name, ext: rep.sniff.ext, moov: moov ?? null, dims });
      const cap = editCapabilities(rep.sniff.ext);
      setCaps(cap);
      const primed = primeFields(rep);
      setFields(primed); setInitial(primed);
      const g = rep.gps;
      const li = { lat: g ? String(g.lat) : "", lon: g ? String(g.lon) : "", alt: g?.altitude != null ? String(g.altitude) : "" };
      setLat(li.lat); setLon(li.lon); setAlt(li.alt); setLocInit(li);
      setBusy(false); setProgress(null);
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e instanceof Error ? e.message : "The file could not be read.");
      setBusy(false); setProgress(null);
    }
  }, []);

  const analyzeFile = useCallback((f: File) => analyzeSource(f, f.name, null), [analyzeSource]);

  const openFromDisk = useCallback(async () => {
    try {
      const [handle] = await (window as unknown as { showOpenFilePicker: (o?: unknown) => Promise<FsFileHandle[]> }).showOpenFilePicker();
      const f = await handle.getFile();
      await analyzeSource(f, handle.name ?? f.name, handle);
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setError(e instanceof Error ? e.message : "Could not open the file.");
    }
  }, [analyzeSource]);

  const onDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) void analyzeFile(f); }, [analyzeFile]);

  const clear = () => { runRef.current++; setReport(null); setFileName(null); setError(null); setBusy(false); setProgress(null); setSource(null); setCaps(null); setSaveMsg(null); setTruncated(false); };

  const useMyLocation = () => {
    if (!navigator.geolocation) { setSaveMsg("This browser has no geolocation."); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setLat(p.coords.latitude.toFixed(6)); setLon(p.coords.longitude.toFixed(6)); if (p.coords.altitude != null) setAlt(p.coords.altitude.toFixed(1)); setRemoveLoc(false); },
      (err) => setSaveMsg(`Location unavailable: ${err.message}`),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  /** Build the edits from what changed; null when nothing changed. */
  const buildEdits = useCallback((): MetaEdits | null => {
    const e: MetaEdits = {};
    let changed = false;
    if (caps?.location) {
      if (removeLoc) { if (locInit.lat || locInit.lon) { e.location = null; changed = true; } }
      else if (lat !== locInit.lat || lon !== locInit.lon || alt !== locInit.alt) {
        const la = parseFloat(lat), lo = parseFloat(lon);
        if (Number.isFinite(la) && Number.isFinite(lo)) { e.location = { lat: la, lon: lo, altitude: alt.trim() && Number.isFinite(parseFloat(alt)) ? parseFloat(alt) : undefined }; changed = true; }
      }
    }
    for (const k of (caps?.fields ?? [])) {
      if (fields[k] !== initial[k]) { (e as Record<string, string>)[k] = fields[k]; changed = true; }
    }
    return changed ? e : null;
  }, [caps, removeLoc, lat, lon, alt, locInit, fields, initial]);

  async function bytesFor(ext: string, whole: Uint8Array, edits: MetaEdits, dims: { width: number; height: number } | null): Promise<Uint8Array> {
    if (ext === "jpg" || ext === "jpeg") return writeJpegMeta(whole, edits);
    if (ext === "png") return writePngMeta(whole, edits);
    if (ext === "webp") return writeWebpMeta(whole, edits, dims ?? undefined);
    if (ext === "mp3") return writeMp3Meta(whole, edits);
    if (ext === "pdf") {
      const { PDFDocument } = await import("@cantoo/pdf-lib");
      const { writeInfo } = await import("@/lib/tools/files/pdf/meta");
      const doc = await PDFDocument.load(whole);
      writeInfo(doc, { title: edits.title, author: edits.artist, subject: edits.description });
      return doc.save();
    }
    throw new Error(`no writer for .${ext}`);
  }

  /** Compose the edited file as a Blob (streaming slices for ISO-BMFF, so the media is never held in memory). */
  async function composeBlob(src: Source, edits: MetaEdits): Promise<Blob> {
    if (src.ext === "mp4" || src.ext === "mov" || src.ext === "m4a" || src.ext === "m4v") {
      if (!src.moov) throw new Error("the moov atom could not be located");
      const { moovStart, moovSize, atEnd } = src.moov;
      const moov = new Uint8Array(await src.blob.slice(moovStart, moovStart + moovSize).arrayBuffer());
      const newMoov = editBmffMoov(moov, edits, !atEnd);
      return new Blob([src.blob.slice(0, moovStart), newMoov as BlobPart, src.blob.slice(moovStart + moovSize)], { type: src.blob.type });
    }
    const whole = new Uint8Array(await src.blob.arrayBuffer());
    const out = await bytesFor(src.ext, whole, edits, src.dims);
    return new Blob([out as BlobPart], { type: src.blob.type });
  }

  const suggestedName = (src: Source) => { const dot = src.name.lastIndexOf("."); return dot > 0 ? `${src.name.slice(0, dot)} (edited)${src.name.slice(dot)}` : `${src.name} (edited)`; };

  const doSave = async (mode: "inplace" | "copy") => {
    const src = source; if (!src) return;
    const edits = buildEdits();
    if (!edits) { setSaveMsg("Nothing changed yet."); return; }
    setSaving(true); setSaveMsg(null); setError(null);
    try {
      if (mode === "inplace") {
        if (!src.handle) throw new Error("open the file with “Open file” to save in place");
        // ISO-BMFF with moov at the end: rewrite only the small moov atom in place; the media is untouched.
        if ((src.ext === "mp4" || src.ext === "mov" || src.ext === "m4a" || src.ext === "m4v") && src.moov?.atEnd) {
          const { moovStart, moovSize } = src.moov;
          const moov = new Uint8Array(await src.blob.slice(moovStart, moovStart + moovSize).arrayBuffer());
          const newMoov = editBmffMoov(moov, edits, false);
          const w = await src.handle.createWritable({ keepExistingData: true });
          await w.write({ type: "write", position: moovStart, data: newMoov });
          await w.truncate(moovStart + newMoov.length);
          await w.close();
        } else {
          const blob = await composeBlob(src, edits);
          const w = await src.handle.createWritable();
          await w.write(blob);
          await w.close();
        }
        setSaveMsg("Saved to the file.");
        // Re-read from the handle so the view reflects what is now on disk.
        const f = await src.handle.getFile();
        await analyzeSource(f, src.handle.name ?? f.name, src.handle);
        return;
      }
      // copy
      const blob = await composeBlob(src, edits);
      if (hasSavePicker()) {
        const handle = await (window as unknown as { showSaveFilePicker: (o?: unknown) => Promise<FsFileHandle> }).showSaveFilePicker({ suggestedName: suggestedName(src) });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        setSaveMsg("Saved a copy.");
      } else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = suggestedName(src);
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
        setSaveMsg("Downloaded the edited copy.");
      }
    } catch (e) {
      if ((e as DOMException)?.name === "AbortError") { setSaving(false); return; }
      setError(e instanceof Error ? e.message : "The file could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  const jsonText = report ? JSON.stringify({ file: report.name, sha256: report.sha256, type: report.sniff, location: report.gps, metadata: report.flat }, null, 2) : "";
  const dirty = !!buildEdits();

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn("panel flex flex-col items-center justify-center gap-2 border-dashed px-4 py-8 text-center transition-colors", drag ? "border-accent bg-accent/5" : "border-edge")}
        data-meta-drop
      >
        <FileSearch size={22} className="text-faint" />
        <p className="text-sm text-muted">
          Drop any file here,{" "}
          <button type="button" onClick={() => inputRef.current?.click()} className="text-accent underline underline-offset-2">choose a file</button>
          {hasOpenPicker() && <>, or <button type="button" onClick={() => void openFromDisk()} className="text-accent underline underline-offset-2">open a file</button> to edit it in place</>}.
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-faint">
          Images, video, audio, PDF or anything else — any size. Only the part that holds the metadata is read; nothing is uploaded.
          {hasOpenPicker() && " Open a file (rather than drop it) to save your changes back to it."}
        </p>
        <input ref={inputRef} type="file" className="sr-only" data-meta-input onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void analyzeFile(f); }} />
      </div>

      {(busy || report || fileName) && (
        <div className="flex flex-wrap items-center gap-2">
          <Upload size={14} className="text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{fileName}{source?.handle && <span className="ml-1 text-positive">· editable</span>}</span>
          {busy && <span className="flex items-center gap-1 font-mono text-[11px] text-accent"><Loader2 size={14} className="animate-spin" />{progress}</span>}
          {report && (
            <>
              <CopyButton value={jsonText} label="Copy all as JSON" className="h-8" />
              <button type="button" onClick={() => { const blob = new Blob([jsonText], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${report.name || "file"}.metadata.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 30_000); }} className={BTN}>
                <Download size={13} /> JSON
              </button>
            </>
          )}
          {(report || error) && <button type="button" onClick={clear} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"><X size={12} /> Clear</button>}
        </div>
      )}

      {truncated && <p className="rounded-[var(--radius-sm)] border border-edge px-3 py-2 text-[11px] text-faint">This file is large — its metadata was read from the relevant region (the SHA-256 is of the whole file). Editing writes the metadata back without re-reading the media.</p>}

      {error && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-danger" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1 font-mono text-xs">{error}</span>
        </div>
      )}

      {report && caps && (
        <div className="panel flex flex-col border-accent/40" data-meta-edit>
          <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
            <Pencil size={14} className="text-accent" />
            <span className="readout">Edit metadata</span>
            <span className="readout ml-auto text-faint">.{source?.ext}</span>
          </div>
          <div className="space-y-3 p-3">
            {caps.location && (
              <div className="space-y-2 rounded-[var(--radius-sm)] border border-edge p-2.5" data-edit-location>
                <div className="flex items-center gap-2">
                  <MapPin size={13} className="text-accent" />
                  <span className="font-mono text-xs font-semibold text-ink">Location (GPS)</span>
                  <button type="button" onClick={useMyLocation} className={cn(BTN, "ml-auto")}><Crosshair size={12} /> Use my location</button>
                </div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <label className="flex flex-col gap-1 text-[11px] text-muted">Latitude<input data-edit-lat className={INP} inputMode="decimal" placeholder="35.658600" value={lat} onChange={(e) => { setLat(e.target.value); setRemoveLoc(false); }} /></label>
                  <label className="flex flex-col gap-1 text-[11px] text-muted">Longitude<input data-edit-lon className={INP} inputMode="decimal" placeholder="139.745400" value={lon} onChange={(e) => { setLon(e.target.value); setRemoveLoc(false); }} /></label>
                  <label className="flex flex-col gap-1 text-[11px] text-muted">Altitude (m)<input data-edit-alt className={INP} inputMode="decimal" placeholder="optional" value={alt} onChange={(e) => { setAlt(e.target.value); setRemoveLoc(false); }} /></label>
                </div>
                <div className="flex items-center gap-2">
                  {lat && lon && !removeLoc && <a href={`https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=15/${lat}/${lon}`} target="_blank" rel="noopener noreferrer" className="font-mono text-[11px] text-accent underline underline-offset-2">preview on map</a>}
                  {(locInit.lat || locInit.lon) && <button type="button" onClick={() => { setRemoveLoc(true); setLat(""); setLon(""); setAlt(""); }} className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-faint hover:text-danger"><Trash2 size={12} /> Remove location</button>}
                </div>
                <p className="text-[11px] leading-snug text-faint">Written the standard way for this file type — EXIF GPS for images, the QuickTime ©xyz / ISO-6709 tag for video and audio — so Photos, Google Photos and the like read it.</p>
              </div>
            )}
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {caps.fields.map((k) => (
                <label key={k} className="flex flex-col gap-1 text-[11px] text-muted">
                  {FIELD_LABEL[k]}
                  <input data-edit-field={k} className={INP} value={fields[k as FieldKey]} onChange={(e) => setFields((f) => ({ ...f, [k]: e.target.value }))} placeholder={initial[k as FieldKey] || "—"} />
                </label>
              ))}
            </div>
            {caps.note && <p className="text-[11px] leading-snug text-warn">{caps.note}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={!dirty || saving || !source?.handle} onClick={() => void doSave("inplace")} className={PRIMARY} data-save-inplace title={source?.handle ? "Overwrite the original file" : "Open the file (not drop it) to save in place"}>
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save to the file
              </button>
              <button type="button" disabled={!dirty || saving} onClick={() => void doSave("copy")} className={BTN} data-save-copy>
                <Download size={13} /> Save a copy…
              </button>
              {!source?.handle && <span className="font-mono text-[11px] text-faint">Drag-dropped — open the file to enable in-place saving.</span>}
              {saveMsg && <span className="ml-auto inline-flex items-center gap-1 font-mono text-[11px] text-positive"><Check size={12} /> {saveMsg}</span>}
            </div>
          </div>
        </div>
      )}
      {report && !caps && <p className="rounded-[var(--radius-sm)] border border-edge px-3 py-2 text-[11px] text-faint">Editing is not supported for this file type yet — images (JPEG/PNG/WebP), MP4/MOV/M4A, MP3 and PDF can be edited.</p>}

      {report && (
        <>
          {report.gps && (
            <div className="panel registered flex flex-col border-accent/40" data-meta-location>
              <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
                <MapPin size={14} className="text-accent" />
                <span className="readout">Location</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3">
                <div>
                  <p className="font-mono text-sm text-ink">{report.gps.text}</p>
                  {report.gps.altitude != null && <p className="readout tabular mt-0.5">altitude {report.gps.altitude.toFixed(1)} m</p>}
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <CopyButton value={report.gps.text} label="Copy" className="h-8" />
                  <a href={report.gps.map} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent"><MapPin size={13} /> Open map</a>
                </div>
              </div>
              <p className="border-t border-edge px-3 py-2 text-[11px] leading-relaxed text-faint">This file records where it was captured. Strip it before sharing if that is not intended — most social platforms remove it, but a raw file keeps it.</p>
            </div>
          )}

          {report.ai && (
            <div className="panel flex flex-col" data-meta-ai data-ai={report.ai.ai}>
              <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
                <Sparkles size={14} className={report.ai.ai === "none" ? "text-faint" : "text-accent"} />
                <span className="readout">AI / Content Credentials</span>
                <span className={cn("readout ml-auto", report.ai.ai === "none" ? "text-faint" : "text-accent")}>{AI_WORD[report.ai.ai]}</span>
              </div>
              {report.ai.signals.length > 0 ? (
                <ul className="divide-y divide-edge">
                  {report.ai.signals.map((s, i) => (
                    <li key={i} className="flex flex-col gap-0.5 px-3 py-2">
                      <span className="font-mono text-xs text-ink">{s.title}</span>
                      <span className="readout text-faint">{s.source}</span>
                      {s.detail && <span className="text-[11px] leading-snug text-muted">{s.detail}</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-3 py-2 text-xs leading-relaxed text-muted">No AI-generation or Content Credentials metadata is present. That is not proof the file is human-made — such tags are easily stripped, and invisible watermarks like SynthID cannot be read here.</p>
              )}
              <p className="border-t border-edge px-3 py-2 text-[11px] leading-relaxed text-faint">
                For full C2PA signature validation and trust, use the <Link href="/media/content-credentials" className="text-accent underline underline-offset-2">Content Credentials inspector</Link>.
              </p>
            </div>
          )}

          {report.groups.map((g) => <GroupPanel key={`${g.title}·${g.source}`} group={g} />)}

          <details className="panel px-3 py-2">
            <summary className="cursor-pointer select-none font-mono text-xs text-muted hover:text-accent">Raw JSON</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-[var(--radius-sm)] bg-base p-3 font-mono text-[11px] leading-relaxed text-ink">{jsonText}</pre>
          </details>
        </>
      )}
    </div>
  );
}
