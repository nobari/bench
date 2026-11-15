"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { AlertTriangle, Bookmark, ClipboardPaste, Download, ExternalLink, Loader2, Music, Video, VideoOff, X } from "lucide-react";
import {
  HANDOFF_KEY,
  bookmarkletSource,
  codecName,
  decodeHandoff,
  fileNameFor,
  findMediaInHtml,
  parseInstagramLink,
  qualityLabel,
  readMedia,
  type IgFile,
  type IgMedia,
  type Result,
} from "@/lib/tools/media/instagram";
import { formatBytes } from "@/lib/tools/bytes";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const TOOL_PATH = "/media/instagram-video";
const BTN =
  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-40";

type Found = Result<IgMedia> | null;

function readHash(): Found {
  if (typeof window === "undefined") return null;
  return decodeHandoff(window.location.hash);
}

function fmtDuration(seconds: number): string {
  const s = Math.round(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const KIND_LABEL: Record<IgFile["kind"], string> = {
  video: "Video with sound",
  "video-only": "Video without sound",
  "audio-only": "Sound only",
};

type Job = { state: "busy"; got: number; total?: number } | { state: "failed" };

function FileRow({ media, itemIndex, file, now }: { media: IgMedia; itemIndex: number; file: IgFile; now: number }) {
  const [job, setJob] = useState<Job | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const name = fileNameFor(media, itemIndex, file);
  const expired = file.expires !== undefined && now > 0 && file.expires < now;

  const download = async () => {
    const ctl = new AbortController();
    abort.current = ctl;
    setJob({ state: "busy", got: 0, total: file.size });
    try {
      const res = await fetch(file.url, { signal: ctl.signal, referrerPolicy: "no-referrer", credentials: "omit" });
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      const total = Number(res.headers.get("content-length")) || file.size;
      const reader = res.body.getReader();
      const chunks: BlobPart[] = [];
      let got = 0;
      let shown = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        got += value.byteLength;
        if (got - shown > 262_144) {
          shown = got;
          setJob({ state: "busy", got, total });
        }
      }
      const blob = new Blob(chunks, { type: file.kind === "audio-only" ? "audio/mp4" : "video/mp4" });
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      setJob(null);
    } catch {
      setJob(ctl.signal.aborted ? null : { state: "failed" });
    }
  };

  const Icon = file.kind === "audio-only" ? Music : file.kind === "video-only" ? VideoOff : Video;
  const details = [
    file.width && file.height && file.kind !== "audio-only" ? `${file.width} × ${file.height}` : null,
    codecName(file.codecs),
    file.size ? formatBytes(file.size) : null,
  ].filter(Boolean);

  return (
    <li className="flex flex-col gap-2 border-t border-edge px-3 py-2.5 first:border-t-0" data-ig-file={file.kind}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Icon size={15} className="shrink-0 text-faint" />
        <span className="tabular font-mono text-sm text-ink">{qualityLabel(file)}</span>
        <span className="text-xs text-muted">{KIND_LABEL[file.kind]}</span>
        {details.length > 0 && <span className="readout tabular">{details.join(" · ")}</span>}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <a href={file.url} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className={BTN}>
            <ExternalLink size={13} /> Open
          </a>
          <CopyButton value={file.url} label="Copy link" />
          {job?.state === "busy" ? (
            <button type="button" onClick={() => abort.current?.abort()} className={BTN}>
              <Loader2 size={13} className="animate-spin" />
              <span className="tabular">
                {job.total ? `${Math.min(99, Math.floor((job.got / job.total) * 100))}%` : formatBytes(job.got)}
              </span>
              <X size={12} />
            </button>
          ) : (
            <button
              type="button"
              onClick={download}
              disabled={expired}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Download size={13} /> Download
            </button>
          )}
        </div>
      </div>
      {job?.state === "failed" && (
        <p className="font-mono text-xs text-warn">
          The browser could not fetch this file from here. Use Open, then save it from the tab that opens (right-click → Save
          video as…).
        </p>
      )}
      {expired && <p className="font-mono text-xs text-warn">This address has run out. Use the bookmark on the reel again.</p>}
    </li>
  );
}

export function InstagramVideoWidget() {
  const [input, setInput] = useQueryState("i", parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }));
  const [found, setFound] = useState<Found>(readHash);
  const [now, setNow] = useState(0);
  const [bookmarkHint, setBookmarkHint] = useState(false);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [toolUrl] = useState(() => (typeof window === "undefined" ? TOOL_PATH : `${window.location.origin}${TOOL_PATH}`));
  const bookmarklet = bookmarkletSource(toolUrl);

  const link = parseInstagramLink(input);
  const showLinkError = input.trim() !== "" && !link.ok;

  // A hand-off arriving in this tab (the bookmark's link, or a pasted address with #ig=…).
  useEffect(() => {
    const onHash = () => {
      const next = readHash();
      if (next) setFound(next);
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // The clock the "expires" line is read against; ticking keeps it honest while the page stays open.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => active && setNow(Date.now()));
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const readSource = (html: string) => {
    const slim = findMediaInHtml(html, link.ok ? link.value.code : undefined);
    setFound(slim.ok ? readMedia(slim.value) : slim);
  };

  const pasteFromClipboard = async () => {
    setPasteBusy(true);
    try {
      readSource(await navigator.clipboard.readText());
    } catch {
      setFound({ ok: false, error: "The browser did not allow reading the clipboard. Click in the box and press ⌘V / Ctrl+V instead." });
    } finally {
      setPasteBusy(false);
    }
  };

  const clear = () => {
    setFound(null);
    if (window.location.hash.includes(`${HANDOFF_KEY}=`))
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
  };

  const media = found?.ok ? found.value : null;
  const expires = media ? Math.min(...media.items.flatMap((it) => it.files.map((f) => f.expires ?? Infinity))) : Infinity;

  return (
    <div className="space-y-3">
      {/* 1 — the link */}
      <div className={cn("panel registered flex flex-col", showLinkError && "border-danger/50")}>
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="readout">1 · Reel or post link</span>
          {input && (
            <button onClick={() => setInput("")} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
              <X size={12} /> Clear
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            inputMode="url"
            aria-label="Instagram link"
            placeholder="https://www.instagram.com/reel/…"
            className="input min-w-0 flex-1 font-mono text-sm"
          />
          <a
            href={link.ok ? link.value.url : undefined}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!link.ok}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent",
              !link.ok && "pointer-events-none opacity-40",
            )}
          >
            <ExternalLink size={13} /> Open on Instagram
          </a>
        </div>
        {(showLinkError || link.ok) && (
          <div className="border-t border-edge px-3 py-2 font-mono text-xs">
            {link.ok ? (
              <span className="text-muted">
                {link.value.kind === "p" ? "Post" : link.value.kind === "tv" ? "Video" : "Reel"}{" "}
                <span className="text-ink">{link.value.code}</span>
              </span>
            ) : (
              <span className="text-danger">{link.error}</span>
            )}
          </div>
        )}
      </div>

      {/* 2 — getting the page's data */}
      <div className="panel flex flex-col">
        <div className="border-b border-edge px-3 py-2">
          <span className="readout">2 · Read the video from the page</span>
        </div>
        <div className="grid gap-px bg-edge sm:grid-cols-2">
          <div className="space-y-2.5 bg-surface p-3">
            <p className="text-sm text-ink">With a bookmark</p>
            <p className="text-xs leading-relaxed text-muted">
              Drag this button to your bookmarks bar once. Then, on any reel or post on instagram.com, click the bookmark: the video
              opens here.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                ref={(el) => {
                  // React refuses javascript: addresses in href, so it is set on the element.
                  el?.setAttribute("href", bookmarklet);
                }}
                onClick={(e) => {
                  e.preventDefault();
                  setBookmarkHint(true);
                }}
                draggable
                data-ig-bookmarklet
                title="Drag me to the bookmarks bar"
                className="inline-flex h-8 cursor-grab items-center gap-1.5 rounded-[var(--radius-sm)] border border-accent px-3 font-mono text-xs font-semibold text-accent"
              >
                <Bookmark size={13} /> Get Instagram video
              </a>
              <CopyButton value={bookmarklet} label="Copy as address" />
            </div>
            {bookmarkHint && (
              <p className="font-mono text-xs text-warn">
                Drag it to the bookmarks bar (⌘⇧B / Ctrl+Shift+B shows the bar) — clicking it here does nothing. Or add a bookmark by
                hand and paste the copied address as its URL.
              </p>
            )}
          </div>
          <div className="space-y-2.5 bg-surface p-3">
            <p className="text-sm text-ink">Or with the page source</p>
            <p className="text-xs leading-relaxed text-muted">
              On the reel&apos;s page press ⌘⌥U / Ctrl+U, select all, copy, and paste it here. It is read in this tab and not kept.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <textarea
                value=""
                onChange={() => {}}
                onPaste={(e) => {
                  e.preventDefault();
                  readSource(e.clipboardData.getData("text/plain"));
                }}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) void file.text().then(readSource);
                }}
                rows={1}
                spellCheck={false}
                aria-label="Paste the page source"
                placeholder="Paste the source here, or drop a saved .html"
                className="input h-8 min-w-0 flex-1 resize-none py-1.5 font-mono text-xs"
              />
              <button type="button" onClick={pasteFromClipboard} disabled={pasteBusy} className={BTN}>
                {pasteBusy ? <Loader2 size={13} className="animate-spin" /> : <ClipboardPaste size={13} />} Paste
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* error */}
      {found && !found.ok && (
        <div className="panel flex items-start gap-2 border-danger/50 p-3 text-danger" role="alert">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <span className="flex-1 font-mono text-xs">{found.error}</span>
          <button onClick={clear} aria-label="Dismiss" className="text-faint hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {/* 3 — the files */}
      {media && (
        <div className="panel registered flex flex-col" data-ig-result>
          <div className="flex items-center justify-between gap-3 border-b border-edge px-3 py-2">
            <span className="readout">
              3 · {media.items.length > 1 ? `${media.items.length} videos` : "Video"}
              {media.photos > 0 && ` · ${media.photos} photo${media.photos > 1 ? "s" : ""} left out`}
            </span>
            <div className="flex items-center gap-2">
              {media.code && (
                <a href={`https://www.instagram.com/reel/${media.code}/`} target="_blank" rel="noopener noreferrer" className={BTN}>
                  <ExternalLink size={13} /> Post
                </a>
              )}
              <button onClick={clear} className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger">
                <X size={12} /> Clear
              </button>
            </div>
          </div>
          {(media.user || media.caption) && (
            <div className="border-b border-edge px-3 py-2.5">
              {media.user && <p className="font-mono text-sm text-ink">@{media.user}</p>}
              {media.caption && <p className="mt-1 line-clamp-3 max-w-prose whitespace-pre-line text-xs leading-relaxed text-muted">{media.caption}</p>}
            </div>
          )}
          {media.items.map((item, index) => (
            <div key={index} className={cn("flex flex-col sm:flex-row", index > 0 && "border-t border-edge")}>
              {item.poster && (
                <div className="shrink-0 border-b border-edge bg-base p-3 sm:w-40 sm:border-b-0 sm:border-r">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={item.poster}
                    alt=""
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    className="mx-auto max-h-56 rounded-[var(--radius-sm)] object-contain"
                  />
                  <p className="readout tabular mt-2 text-center">
                    {[media.items.length > 1 ? `#${index + 1}` : null, item.duration ? fmtDuration(item.duration) : null, item.width && item.height ? `${item.width} × ${item.height}` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              )}
              <ul className="min-w-0 flex-1">
                {item.files.map((file) => (
                  <FileRow key={file.url} media={media} itemIndex={index} file={file} now={now} />
                ))}
              </ul>
            </div>
          ))}
          <div className="border-t border-edge px-3 py-2 text-xs leading-relaxed text-faint">
            {Number.isFinite(expires) && now > 0 && (
              <span className="tabular">
                {expires < now ? "These addresses have run out. " : `These addresses work until ${new Date(expires).toLocaleString()}. `}
              </span>
            )}
            The sharpest picture comes as video without sound plus the sound on its own; the file with sound plays anywhere. Download
            only what you have the right to keep.
          </div>
        </div>
      )}
    </div>
  );
}
