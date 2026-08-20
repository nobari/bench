"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { Archive } from "libarchive.js";
import {
  Download,
  File as FileIcon,
  FilePlus,
  FolderArchive,
  Loader,
  Lock,
  PackageOpen,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/tools/bytes";
import {
  EXTRACT_ACCEPT,
  OUTPUT_FORMATS,
  archiveLabel,
  compareEntryPaths,
  isRarFile,
  isSingleGzip,
  sanitizeBaseName,
} from "@/lib/tools/files/archive";
import { buildZip } from "@/lib/tools/files/zip-write";
import { buildTarGz } from "@/lib/tools/files/tar-write";

// Same self-hosted worker + wasm as the comic reader (scripts/copy-vendor.mjs).
Archive.init({ workerUrl: "/vendor/libarchive/worker-bundle.js" });

type Reader = Awaited<ReturnType<typeof Archive.open>>;

interface RawEntry {
  file: { name: string; size: number } | File;
  path: string;
}

interface Entry {
  /** Full path inside the archive. */
  path: string;
  name: string;
  size: number;
}

interface Meta {
  name: string;
  size: number;
  kind: string;
}

const RAR_ENCRYPTED_MSG =
  "This RAR archive is encrypted, which this tool can't open — RAR decryption isn't supported. Encrypted ZIP archives do work.";

function looksEncrypted(message: string): boolean {
  return /passphrase|password|encrypt/i.test(message);
}

function friendlyError(message: string): string {
  if (/checksum|corrupt|damaged|truncated|unrecognized/i.test(message))
    return "The archive could not be decoded — it may be corrupt, or an encrypted RAR, which this tool can't open (encrypted ZIP works).";
  return message || "Could not read this archive.";
}

function isRealFile(e: RawEntry): boolean {
  return typeof e.file === "object" && e.file !== null && typeof e.file.name === "string";
}

/* ------------------------------------------------------------- shared bits */

function useSaver() {
  const urlsRef = useRef<string[]>([]);
  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  return useCallback((blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  }, []);
}

function Dropzone({
  onFiles,
  accept,
  multiple,
  icon,
  title,
  sub,
  className,
}: {
  onFiles: (files: FileList) => void;
  accept: string;
  multiple?: boolean;
  icon: React.ReactNode;
  title: string;
  sub: string;
  className: string;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) onFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onFiles(e.dataTransfer.files);
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 p-8 text-center",
          className,
          dragOver && "border-accent",
        )}
      >
        <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
          {icon}
        </span>
        <span className="font-display text-base font-semibold text-ink">{title}</span>
        <span className="max-w-sm font-mono text-xs text-faint">{sub}</span>
      </button>
    </>
  );
}

/* ========================================================== ARCHIVE EXTRACTOR */

type ExtractPhase = "empty" | "loading" | "password" | "ready" | "error";

export function ArchiveExtractWidget() {
  const [phase, setPhase] = useState<ExtractPhase>("empty");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [password, setPassword] = useState("");
  const [passwordBad, setPasswordBad] = useState(false);
  const [busyPath, setBusyPath] = useState<string | null>(null);
  const [zipBusy, setZipBusy] = useState(false);

  const readerRef = useRef<Reader | null>(null);
  const extractedRef = useRef<Map<string, File> | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const save = useSaver();

  const closeReader = useCallback(() => {
    void readerRef.current?.close().catch(() => undefined);
    readerRef.current = null;
    extractedRef.current = null;
  }, []);

  useEffect(() => closeReader, [closeReader]);

  const load = useCallback(
    async (file: File, pw?: string) => {
      closeReader();
      setPhase("loading");
      setError(null);
      try {
        // Bare .gz file: not an archive — inflate it with the native stream.
        if (isSingleGzip(file.name)) {
          const stream = file.stream().pipeThrough(new DecompressionStream("gzip"));
          const data = await new Response(stream).blob();
          const name = file.name.replace(/\.gz$/i, "") || "file";
          extractedRef.current = new Map([[name, new File([data], name)]]);
          setEntries([{ path: name, name, size: data.size }]);
          setMeta({ name: file.name, size: file.size, kind: "GZIP" });
          setPhase("ready");
          return;
        }
        const reader = await Archive.open(file);
        try {
          if (pw) await reader.usePassword(pw);
          else if ((await reader.hasEncryptedData()) === true) {
            await reader.close().catch(() => undefined);
            if (isRarFile(file.name)) {
              setError(RAR_ENCRYPTED_MSG);
              setPhase("error");
            } else {
              setPendingFile(file);
              setPasswordBad(false);
              setPhase("password");
            }
            return;
          }
          const listing = (await reader.getFilesArray()) as RawEntry[];
          const found = listing
            .filter(isRealFile)
            .map((e) => ({ path: e.path + e.file.name, name: e.file.name, size: e.file.size }))
            .sort((a, b) => compareEntryPaths(a.path, b.path));
          if (found.length === 0)
            throw new Error(
              "No file entries could be read — the archive may be empty, or use encrypted file names (RAR header encryption), which this tool can't open.",
            );
          if (pw) {
            // Listing works even with a wrong ZipCrypto password — data
            // extraction is what fails. Probe the smallest entry now so a bad
            // password bounces straight back to the prompt.
            const probe = [...found].sort((a, b) => a.size - b.size).find((e) => e.size > 0);
            if (probe) await reader.extractSingleFile(probe.path);
          }
          readerRef.current = reader;
          setEntries(found);
          setMeta({ name: file.name, size: file.size, kind: archiveLabel(file.name) });
          setPendingFile(null);
          setPassword("");
          setPhase("ready");
        } catch (e) {
          await reader.close().catch(() => undefined);
          throw e;
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (looksEncrypted(msg) && !isRarFile(file.name)) {
          setPendingFile(file);
          setPasswordBad(Boolean(pw));
          setPhase("password");
        } else {
          setError(looksEncrypted(msg) ? RAR_ENCRYPTED_MSG : friendlyError(msg));
          setPhase("error");
        }
      }
    },
    [closeReader],
  );

  const openFiles = useCallback(
    (files: FileList) => {
      if (files[0]) void load(files[0]);
    },
    [load],
  );

  const clear = useCallback(() => {
    closeReader();
    setEntries([]);
    setMeta(null);
    setError(null);
    setPendingFile(null);
    setPassword("");
    setPhase("empty");
  }, [closeReader]);

  const downloadEntry = async (entry: Entry) => {
    const cached = extractedRef.current?.get(entry.path);
    if (cached) {
      save(cached, entry.name);
      return;
    }
    if (!readerRef.current || busyPath) return;
    setBusyPath(entry.path);
    try {
      const file = await readerRef.current.extractSingleFile(entry.path);
      save(file, entry.name);
    } catch {
      setError("Could not extract this file — the archive may be corrupt.");
      setPhase("error");
    } finally {
      setBusyPath(null);
    }
  };

  const downloadAllAsZip = async () => {
    if (zipBusy || !meta) return;
    setZipBusy(true);
    try {
      if (!extractedRef.current) {
        if (!readerRef.current) return;
        await readerRef.current.extractFiles();
        const all = ((await readerRef.current.getFilesArray()) as RawEntry[]).filter(
          (e): e is { file: File; path: string } => e.file instanceof File,
        );
        // extractFiles terminates the worker — serve later downloads from memory.
        extractedRef.current = new Map(all.map((e) => [e.path + e.file.name, e.file]));
        readerRef.current = null;
      }
      const inputs = await Promise.all(
        [...extractedRef.current.entries()].map(async ([name, file]) => ({
          name,
          data: new Uint8Array(await file.arrayBuffer()),
          mtime: file.lastModified,
        })),
      );
      const zip = await buildZip(inputs);
      const base = sanitizeBaseName(meta.name.replace(/\.[^.]*$/, ""));
      save(new Blob([zip as BlobPart], { type: "application/zip" }), `${base}.zip`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not repack this archive as ZIP.");
      setPhase("error");
    } finally {
      setZipBusy(false);
    }
  };

  const totalSize = entries.reduce((s, e) => s + e.size, 0);

  return (
    <div>
      <input
        ref={fileInput}
        type="file"
        accept={EXTRACT_ACCEPT}
        hidden
        onChange={(e) => {
          if (e.target.files?.length) openFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {phase === "empty" && (
        <Dropzone
          onFiles={openFiles}
          accept={EXTRACT_ACCEPT}
          icon={<PackageOpen size={20} />}
          title="Drop an archive here"
          sub="or click to browse — ZIP, RAR, 7z, TAR (.gz/.bz2/.xz), GZ, ISO, CBZ/CBR. Extracted locally, nothing is uploaded."
          className="panel registered bg-ticks min-h-[320px] border-dashed"
        />
      )}

      {phase === "loading" && (
        <div className="panel registered flex min-h-[320px] flex-col items-center justify-center gap-4 p-8">
          <Loader size={22} className="animate-spin text-accent" />
          <p className="readout">Reading archive…</p>
        </div>
      )}

      {phase === "password" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (pendingFile && password) void load(pendingFile, password);
          }}
          className="panel registered flex min-h-[320px] flex-col items-center justify-center gap-4 p-8"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full border border-edge text-accent">
            <Lock size={18} />
          </span>
          <p className="font-display text-base font-semibold text-ink">
            This archive is password-protected
          </p>
          {passwordBad && (
            <p className="font-mono text-xs text-danger">Wrong password — try again.</p>
          )}
          <div className="flex w-full max-w-sm gap-2">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Archive password"
              className="input h-10 flex-1"
              autoFocus
            />
            <button
              type="submit"
              disabled={!password}
              className="inline-flex h-10 items-center rounded-[var(--radius)] bg-accent px-4 font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              Unlock
            </button>
          </div>
          <button type="button" onClick={clear} className="font-mono text-xs text-faint hover:text-ink">
            Choose a different file
          </button>
        </form>
      )}

      {phase === "error" && (
        <div className="panel registered flex min-h-[320px] flex-col items-center justify-center gap-3 p-8 text-center">
          <p className="font-display text-base font-semibold text-danger">
            Could not open this archive
          </p>
          <p className="max-w-md font-mono text-xs text-muted">{error}</p>
          <button
            onClick={() => fileInput.current?.click()}
            className="mt-2 inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-edge px-3 font-mono text-xs text-ink hover:border-accent hover:text-accent"
          >
            <Upload size={13} /> Try another file
          </button>
        </div>
      )}

      {phase === "ready" && meta && (
        <div className="panel registered flex flex-col overflow-hidden">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge p-2">
            <PackageOpen size={15} className="shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-ink">{meta.name}</p>
              <p className="readout text-[10px]">
                {meta.kind} · {entries.length} {entries.length === 1 ? "file" : "files"} ·{" "}
                {formatBytes(meta.size)} packed · {formatBytes(totalSize)} unpacked
              </p>
            </div>
            <button
              onClick={downloadAllAsZip}
              disabled={zipBusy}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:opacity-40"
            >
              {zipBusy ? <Loader size={13} className="animate-spin" /> : <Download size={13} />}
              All as ZIP
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              title="Open another archive"
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

          <div className="max-h-[440px] divide-y divide-edge overflow-auto">
            {entries.map((entry) => (
              <div key={entry.path} className="flex items-center gap-3 px-3 py-2">
                <FileIcon size={14} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-ink">{entry.name}</p>
                  {entry.path !== entry.name && (
                    <p className="truncate readout text-[10px]">{entry.path}</p>
                  )}
                </div>
                <span className="shrink-0 font-mono text-xs tabular text-muted">
                  {formatBytes(entry.size)}
                </span>
                <button
                  onClick={() => void downloadEntry(entry)}
                  disabled={busyPath !== null}
                  title={`Download ${entry.name}`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-accent hover:text-accent disabled:opacity-40"
                >
                  {busyPath === entry.path ? (
                    <Loader size={12} className="animate-spin" />
                  ) : (
                    <Download size={12} />
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================ ARCHIVE CREATOR */

const FORMAT_IDS = OUTPUT_FORMATS.map((f) => f.id) as [string, ...string[]];

interface SourceFile {
  id: string;
  file: File;
}

export function ArchiveCreateWidget() {
  const [fmtId, setFmtId] = useQueryState(
    "fmt",
    parseAsStringLiteral(FORMAT_IDS).withDefault("zip").withOptions({ history: "replace" }),
  );
  const [files, setFiles] = useState<SourceFile[]>([]);
  const [name, setName] = useState("archive");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ name: string; size: number; url: string } | null>(null);
  const idRef = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const fmt = OUTPUT_FORMATS.find((f) => f.id === fmtId) ?? OUTPUT_FORMATS[0];
  const totalIn = files.reduce((s, f) => s + f.file.size, 0);

  const addFiles = useCallback((list: FileList) => {
    const added = Array.from(list).map((file) => ({ id: `f${idRef.current++}`, file }));
    if (added.length) {
      setFiles((p) => [...p, ...added]);
      setResult(null);
      setError(null);
    }
  }, []);

  const create = async () => {
    if (!files.length || busy) return;
    setBusy(true);
    setError(null);
    try {
      const inputs = await Promise.all(
        files.map(async (f) => ({
          name: f.file.name,
          data: new Uint8Array(await f.file.arrayBuffer()),
          mtime: f.file.lastModified,
        })),
      );
      const bytes = fmt.id === "zip" ? await buildZip(inputs) : await buildTarGz(inputs);
      const outName = sanitizeBaseName(name) + fmt.ext;
      const url = URL.createObjectURL(
        new Blob([bytes as BlobPart], {
          type: fmt.id === "zip" ? "application/zip" : "application/gzip",
        }),
      );
      urlsRef.current.push(url);
      setResult({ name: outName, size: bytes.length, url });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create the archive.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-[1.3fr_1fr]">
      {/* sources */}
      <div className="panel registered flex min-h-[380px] flex-col">
        <div className="flex items-center justify-between border-b border-edge p-2">
          <span className="readout px-1">
            Files {files.length > 0 && `· ${files.length} · ${formatBytes(totalIn)}`}
          </span>
          {files.length > 0 && (
            <button
              onClick={() => {
                setFiles([]);
                setResult(null);
              }}
              className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files?.length) addFiles(e.target.files);
            e.target.value = "";
          }}
        />
        {files.length === 0 ? (
          <div className="flex flex-1 flex-col p-3">
            <Dropzone
              onFiles={addFiles}
              accept="*/*"
              multiple
              icon={<FolderArchive size={20} />}
              title="Drop files to pack"
              sub="or click to browse — any file type, as many as you like. Compressed locally, nothing is uploaded."
              className="bg-ticks flex-1 rounded-[var(--radius)] border border-dashed border-edge bg-base"
            />
          </div>
        ) : (
          <div className="flex-1 overflow-auto">
            <div className="divide-y divide-edge">
              {files.map((f) => (
                <div key={f.id} className="flex items-center gap-3 px-3 py-2">
                  <FileIcon size={14} className="shrink-0 text-faint" />
                  <p className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                    {f.file.name}
                  </p>
                  <span className="shrink-0 font-mono text-xs tabular text-muted">
                    {formatBytes(f.file.size)}
                  </span>
                  <button
                    onClick={() => {
                      setFiles((p) => p.filter((x) => x.id !== f.id));
                      setResult(null);
                    }}
                    title="Remove"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-edge text-muted hover:border-danger hover:text-danger"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => fileInput.current?.click()}
              className="m-3 inline-flex h-9 items-center gap-2 rounded-[var(--radius)] border border-dashed border-edge px-3 font-mono text-xs text-faint hover:border-accent hover:text-accent"
            >
              <FilePlus size={13} /> Add more files
            </button>
          </div>
        )}
      </div>

      {/* settings + result */}
      <div className="flex flex-col gap-3">
        <div className="panel registered space-y-4 p-4">
          <p className="readout">Output format</p>
          <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
            {OUTPUT_FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFmtId(f.id)}
                className={cn(
                  "h-8 flex-1 rounded-[3px] font-mono text-xs transition-colors",
                  fmtId === f.id ? "bg-accent text-[#070806]" : "text-muted hover:text-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div>
            <p className="readout mb-1.5">Archive name</p>
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                spellCheck={false}
                className="input h-10 min-w-0 flex-1"
              />
              <span className="shrink-0 font-mono text-xs text-faint">{fmt.ext}</span>
            </div>
          </div>

          <button
            onClick={() => void create()}
            disabled={!files.length || busy}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-[var(--radius)] bg-accent font-mono text-sm font-semibold text-[#070806] transition-[filter] hover:brightness-110 disabled:opacity-40"
          >
            {busy ? (
              <>
                <Loader size={15} className="animate-spin" /> Packing…
              </>
            ) : (
              <>
                <FolderArchive size={15} /> Create archive
              </>
            )}
          </button>
          {error && <p className="font-mono text-xs text-danger">{error}</p>}
        </div>

        {result && (
          <div className="panel flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate font-mono text-[13px] text-ink">{result.name}</p>
              <p className="readout text-[10px]">
                {formatBytes(totalIn)} → {formatBytes(result.size)}
                {totalIn > 0 && ` · ${((result.size / totalIn) * 100).toFixed(1)}%`}
              </p>
            </div>
            <a
              href={result.url}
              download={result.name}
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-ink transition-colors hover:border-accent hover:text-accent"
            >
              <Download size={13} /> Save
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
