"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString, parseAsStringLiteral } from "nuqs";
import { AlertTriangle, ArrowLeftRight, Download, X } from "lucide-react";
import {
  COMPRESS_FORMATS,
  compressBytes,
  bytesToBase64,
  parseBinaryInput,
  smartDecompress,
  utf8Encode,
  utf8DecodeStrict,
  type CompressFormat,
} from "@/lib/tools/text/compress";
import { formatBytes } from "@/lib/tools/bytes";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const MODES = ["c", "d"] as const;
const FORMAT_IDS = ["gzip", "deflate", "deflate-raw"] as const;

interface Result {
  output: string;
  inBytes: number;
  outBytes: number;
  /** Detected container when decompressing. */
  detected?: CompressFormat;
  /** Decompressed bytes are not UTF-8 text. */
  binary?: boolean;
  error?: string;
}

export function TextCompressWidget() {
  const [mode, setMode] = useQueryState(
    "m",
    parseAsStringLiteral(MODES).withDefault("c").withOptions({ history: "replace" }),
  );
  const [format, setFormat] = useQueryState(
    "f",
    parseAsStringLiteral(FORMAT_IDS).withDefault("gzip").withOptions({ history: "replace" }),
  );
  const [input, setInput] = useQueryState(
    "i",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );

  const [result, setResult] = useState<Result | null>(null);
  const bytesRef = useRef<Uint8Array | null>(null);
  const urlsRef = useRef<string[]>([]);

  const compressing = mode === "c";

  useEffect(() => {
    let active = true;
    void (async () => {
      // Defer past the synchronous effect body before any setState.
      await Promise.resolve();
      if (!active) return;
      if (!input) {
        bytesRef.current = null;
        setResult(null);
        return;
      }
      try {
        if (mode === "c") {
          const data = utf8Encode(input);
          const compressed = await compressBytes(data, format);
          if (!active) return;
          bytesRef.current = compressed;
          setResult({
            output: bytesToBase64(compressed),
            inBytes: data.length,
            outBytes: compressed.length,
          });
        } else {
          const bytes = parseBinaryInput(input);
          const { format: detected, data } = await smartDecompress(bytes);
          if (!active) return;
          bytesRef.current = data;
          try {
            setResult({
              output: utf8DecodeStrict(data),
              inBytes: bytes.length,
              outBytes: data.length,
              detected,
            });
          } catch {
            setResult({
              output: "",
              inBytes: bytes.length,
              outBytes: data.length,
              detected,
              binary: true,
            });
          }
        }
      } catch (e) {
        if (!active) return;
        bytesRef.current = null;
        setResult({
          output: "",
          inBytes: 0,
          outBytes: 0,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    })();
    return () => {
      active = false;
    };
  }, [input, mode, format]);

  useEffect(() => {
    const urls = urlsRef.current;
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const download = (name: string) => {
    if (!bytesRef.current) return;
    const url = URL.createObjectURL(
      new Blob([bytesRef.current as BlobPart], { type: "application/octet-stream" }),
    );
    urlsRef.current.push(url);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
  };

  const swapToDecompress = () => {
    if (result && !result.error && compressing) {
      setMode("d");
      setInput(result.output);
    }
  };

  const error = result?.error ?? null;
  const ratio =
    result && !error && result.inBytes > 0
      ? compressing
        ? (result.outBytes / result.inBytes) * 100
        : (result.outBytes / result.inBytes) * 100
      : null;

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["c", "Compress"],
              ["d", "Decompress"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cn(
                "h-8 rounded-[3px] px-3 font-mono text-xs transition-colors",
                mode === id ? "bg-accent text-on-accent font-semibold" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {compressing ? (
          <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
            {COMPRESS_FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => setFormat(f.id)}
                title={f.note}
                className={cn(
                  "shrink-0 rounded-[var(--radius-sm)] px-2.5 py-1.5 font-mono text-xs transition-colors",
                  format === f.id
                    ? "bg-accent text-on-accent"
                    : "text-muted hover:bg-raised hover:text-ink",
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        ) : (
          <span className="readout px-1">
            format auto-detected
            {result?.detected && !error ? ` · ${result.detected}` : ""}
          </span>
        )}

        <div className="ml-auto flex items-center gap-2">
          {compressing && result && !error && (
            <button
              onClick={swapToDecompress}
              title="Decompress this output"
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent"
            >
              <ArrowLeftRight size={13} /> Round-trip
            </button>
          )}
        </div>
      </div>

      {/* io grid */}
      <div className="grid gap-3 lg:grid-cols-2">
        {/* input */}
        <div className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">{compressing ? "Text input" : "Compressed input"}</span>
            {input && (
              <button
                onClick={() => setInput("")}
                className="inline-flex items-center gap-1 font-mono text-xs text-faint hover:text-danger"
              >
                <X size={12} /> Clear
              </button>
            )}
          </div>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            spellCheck={false}
            placeholder={
              compressing
                ? "Paste or type the text to compress…"
                : "Paste Base64 (or hex) of gzip / zlib / deflate data…"
            }
            className="min-h-[260px] flex-1 resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            <span>{input.length} ch</span>
            {result && !error && (
              <span className="ml-auto">{formatBytes(result.inBytes)}</span>
            )}
          </div>
        </div>

        {/* output */}
        <div className={cn("panel registered flex flex-col", error && "border-danger/50")}>
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">{compressing ? "Base64 output" : "Decompressed text"}</span>
            <div className="flex items-center gap-2">
              {result && !error && (compressing || result.binary) && (
                <button
                  onClick={() =>
                    download(compressing ? (format === "gzip" ? "data.gz" : `data.${format}.bin`) : "decompressed.bin")
                  }
                  title={compressing ? "Download compressed bytes" : "Download decompressed bytes"}
                  className="inline-flex items-center gap-1 font-mono text-xs text-muted hover:text-accent"
                >
                  <Download size={12} /> Save
                </button>
              )}
              <CopyButton value={result && !error ? result.output : ""} />
            </div>
          </div>
          {error ? (
            <div className="flex min-h-[260px] flex-1 items-center justify-center p-6">
              <div className="flex max-w-sm items-start gap-2 text-sm text-danger">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                <span className="font-mono">{error}</span>
              </div>
            </div>
          ) : result?.binary ? (
            <div className="flex min-h-[260px] flex-1 items-center justify-center p-6">
              <p className="max-w-sm text-center font-mono text-xs text-muted">
                Decompressed to {formatBytes(result.outBytes)} of binary data (not UTF-8 text) —
                use Save to download it.
              </p>
            </div>
          ) : (
            <textarea
              value={result?.output ?? ""}
              readOnly
              spellCheck={false}
              placeholder="Result appears here…"
              className="min-h-[260px] flex-1 resize-y select-all bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
            />
          )}
          <div className="flex items-center gap-4 border-t border-edge px-3 py-1.5 readout tabular">
            {result && !error ? (
              <>
                <span>
                  {formatBytes(result.inBytes)} → {formatBytes(result.outBytes)}
                </span>
                {ratio !== null && (
                  <span className={cn(compressing && ratio < 100 ? "text-positive" : undefined)}>
                    {compressing
                      ? `${ratio.toFixed(1)}% of original`
                      : `×${(result.outBytes / Math.max(result.inBytes, 1)).toFixed(2)} expansion`}
                  </span>
                )}
                {compressing && <span className="ml-auto">{result.output.length} ch as Base64</span>}
                {!compressing && result.detected && (
                  <span className="ml-auto">detected: {result.detected}</span>
                )}
              </>
            ) : (
              <span>&nbsp;</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
