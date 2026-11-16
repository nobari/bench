"use client";

/**
 * File Metadata Viewer — drop any file, read every piece of metadata its bytes carry. The heavy parsing lives in
 * lib/tools/files/metadata.ts (pure); this widget reads the File, adds the two things that need the browser (PDF via
 * pdf.js, image pixel dimensions), and lays the result out in grouped panels with a map link for any location.
 */

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Download, FileSearch, Loader2, MapPin, Sparkles, Upload, X } from "lucide-react";
import { readAll, pdfGroups, formatBytes, type MetaReport, type MetaGroup, type PdfMeta } from "@/lib/tools/files/metadata";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";
import { useUnsavedWork } from "@/lib/unsaved-work";

const MAX_BYTES = 200 * 1024 * 1024;

const BTN =
  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

function fmtPdfDate(v: string): string {
  // PDF dates look like D:20261115T… or D:20261115093000+09'00'
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
    const LABELS: Record<string, string> = {
      Title: "Title",
      Author: "Author",
      Subject: "Subject",
      Keywords: "Keywords",
      Creator: "Creator",
      Producer: "Producer",
      CreationDate: "Created",
      ModDate: "Modified",
      PDFFormatVersion: "PDF version",
    };
    for (const [k, label] of Object.entries(LABELS)) {
      const v = rawInfo[k];
      if (v == null || v === "") continue;
      info[label] = k.endsWith("Date") ? fmtPdfDate(String(v)) : String(v);
    }
    if (rawInfo.IsLinearized != null) info["Linearized (fast web view)"] = rawInfo.IsLinearized ? "yes" : "no";
    if (rawInfo.IsAcroFormPresent) info["Has form fields"] = "yes";
    if (rawInfo.IsXFAPresent) info["Has XFA form"] = "yes";
    if (rawInfo.EncryptFilterName) info["Encryption"] = String(rawInfo.EncryptFilterName);
    let pageSize: string | undefined;
    const pages = doc.numPages;
    try {
      const page = await doc.getPage(1);
      const vp = page.getViewport({ scale: 1 });
      const mm = (pt: number) => Math.round((pt * 25.4) / 72);
      pageSize = `${Math.round(vp.width)} × ${Math.round(vp.height)} pt (${mm(vp.width)} × ${mm(vp.height)} mm)`;
    } catch {
      /* ignore */
    }
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

async function imageDims(bytes: Uint8Array, mime: string): Promise<string | null> {
  try {
    const blob = new Blob([bytes.slice().buffer], { type: mime });
    const bmp = await createImageBitmap(blob);
    const dims = `${bmp.width} × ${bmp.height} px`;
    bmp.close();
    return dims;
  } catch {
    return null;
  }
}

const AI_WORD: Record<string, string> = {
  "declared-generated": "Declares AI-generated",
  "declared-edited": "Declares AI editing",
  hinted: "Hints at AI",
  none: "No AI declaration found",
};

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
                <a href={e.href} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                  {e.value}
                </a>
              ) : (
                e.value
              )}
              {e.hint && <span className="mt-0.5 block text-[11px] leading-snug text-faint">{e.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function FileMetadataWidget() {
  const [report, setReport] = useState<MetaReport | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const runRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useUnsavedWork(busy ? "A file is being read." : report ? "The loaded file's report will be lost." : null);

  const analyze = useCallback(async (f: File) => {
    const run = ++runRef.current;
    setFileName(f.name);
    setError(null);
    setReport(null);
    if (f.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(f.size)}; the viewer reads files up to ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const rep = await readAll({ name: f.name, size: f.size, type: f.type, lastModified: f.lastModified || null }, bytes);
      if (run !== runRef.current) return;

      // Browser-only extras.
      if (rep.sniff.kind === "image" && rep.sniff.ext !== "svg") {
        const dims = await imageDims(bytes, rep.sniff.mime);
        if (dims) {
          const fileGroup = rep.groups.find((g) => g.title === "File");
          if (fileGroup && !fileGroup.entries.some((e) => e.label === "Dimensions"))
            fileGroup.entries.splice(1, 0, { label: "Dimensions", value: dims });
          rep.flat["File · Dimensions"] = dims;
        }
      }
      if (rep.sniff.ext === "pdf") {
        const pm = await pdfMeta(bytes);
        if (run !== runRef.current) return;
        if (pm) {
          rep.groups.push(...pdfGroups(pm));
          for (const g of pdfGroups(pm)) for (const e of g.entries) rep.flat[`${g.title} · ${e.label}`] = e.value;
        }
      }
      if (run !== runRef.current) return;
      setReport({ ...rep });
      setBusy(false);
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e instanceof Error ? e.message : "The file could not be read.");
      setBusy(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDrag(false);
      const f = e.dataTransfer.files[0];
      if (f) void analyze(f);
    },
    [analyze],
  );

  const clear = () => {
    runRef.current++;
    setReport(null);
    setFileName(null);
    setError(null);
    setBusy(false);
  };

  const jsonText = report ? JSON.stringify({ file: report.name, sha256: report.sha256, type: report.sniff, location: report.gps, metadata: report.flat }, null, 2) : "";

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          "panel flex flex-col items-center justify-center gap-2 border-dashed px-4 py-8 text-center transition-colors",
          drag ? "border-accent bg-accent/5" : "border-edge",
        )}
        data-meta-drop
      >
        <FileSearch size={22} className="text-faint" />
        <p className="text-sm text-muted">
          Drop any file here, or{" "}
          <button type="button" onClick={() => inputRef.current?.click()} className="text-accent underline underline-offset-2">
            choose a file
          </button>
          .
        </p>
        <p className="max-w-prose text-xs leading-relaxed text-faint">
          Images, video, audio, PDF or anything else — up to {formatBytes(MAX_BYTES)}. Everything is read in this tab; nothing is
          uploaded.
        </p>
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          data-meta-input
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) void analyze(f);
          }}
        />
      </div>

      {(busy || report || fileName) && (
        <div className="flex flex-wrap items-center gap-2">
          <Upload size={14} className="text-faint" />
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{fileName}</span>
          {busy && <Loader2 size={14} className="animate-spin text-accent" />}
          {report && (
            <>
              <CopyButton value={jsonText} label="Copy all as JSON" className="h-8" />
              <button
                type="button"
                onClick={() => {
                  const blob = new Blob([jsonText], { type: "application/json" });
                  const a = document.createElement("a");
                  a.href = URL.createObjectURL(blob);
                  a.download = `${report.name || "file"}.metadata.json`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
                }}
                className={BTN}
              >
                <Download size={13} /> JSON
              </button>
            </>
          )}
          {(report || error) && (
            <button type="button" onClick={clear} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-danger" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1 font-mono text-xs">{error}</span>
        </div>
      )}

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
                  <a href={report.gps.map} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent">
                    <MapPin size={13} /> Open map
                  </a>
                </div>
              </div>
              <p className="border-t border-edge px-3 py-2 text-[11px] leading-relaxed text-faint">
                This file records where it was captured. Strip it before sharing if that is not intended — most social platforms
                remove it, but a raw file keeps it.
              </p>
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
                <p className="px-3 py-2 text-xs leading-relaxed text-muted">
                  No AI-generation or Content Credentials metadata is present. That is not proof the file is human-made — such tags
                  are easily stripped, and invisible watermarks like SynthID cannot be read here.
                </p>
              )}
              <p className="border-t border-edge px-3 py-2 text-[11px] leading-relaxed text-faint">
                For full C2PA signature validation and trust, use the{" "}
                <Link href="/media/content-credentials" className="text-accent underline underline-offset-2">
                  Content Credentials inspector
                </Link>
                .
              </p>
            </div>
          )}

          {report.groups.map((g) => (
            <GroupPanel key={`${g.title}·${g.source}`} group={g} />
          ))}

          <details className="panel px-3 py-2">
            <summary className="cursor-pointer select-none font-mono text-xs text-muted hover:text-accent">Raw JSON</summary>
            <pre className="mt-2 max-h-96 overflow-auto rounded-[var(--radius-sm)] bg-base p-3 font-mono text-[11px] leading-relaxed text-ink">{jsonText}</pre>
          </details>
        </>
      )}
    </div>
  );
}
