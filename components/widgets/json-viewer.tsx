"use client";

import { useCallback, useMemo, useState } from "react";
import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";
import {
  AlignLeft,
  Check,
  ChevronRight,
  Copy,
  FileJson,
  Link2,
  ListTree,
  Minimize2,
  Search,
  SortAsc,
  X,
} from "lucide-react";
import {
  collectContainers,
  formatJson,
  highlightJson,
  highlightText,
  parseJson,
  preview,
  searchJson,
  sortDeep,
  typeOf,
  type JsonValue,
} from "@/lib/tools/json/utils";
import { cn } from "@/lib/utils";
import { copyShareLink } from "@/components/share-button";

const SAMPLE = `{
  "name": "Bench",
  "version": "1.0.0",
  "private": true,
  "tools": [
    { "id": "base64", "category": "text", "stable": true },
    { "id": "gif-maker", "category": "image", "stable": true }
  ],
  "meta": { "local": true, "uploads": 0, "tags": ["fast", "private"] }
}`;

function readInitial(): string {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const doc = hash.get("doc");
  if (doc) {
    try {
      return decompressFromEncodedURIComponent(doc) || "";
    } catch {
      /* ignore */
    }
  }
  const i = new URLSearchParams(window.location.search).get("i");
  return i || "";
}

type IndentOpt = 2 | 4 | "\t";

export function JsonViewerWidget() {
  const [text, setText] = useState<string>(readInitial);
  const [view, setView] = useState<"tree" | "raw">("tree");
  const [indent, setIndent] = useState<IndentOpt>(2);
  const [query, setQuery] = useState("");
  const [forceOpen, setForceOpen] = useState<Set<string>>(new Set());
  const [forceClosed, setForceClosed] = useState<Set<string>>(new Set());
  const [shared, setShared] = useState(false);
  const [copied, setCopied] = useState(false);

  const trimmed = text.trim();
  const isEmpty = trimmed === "";
  const parsed = useMemo(
    () => (isEmpty ? null : parseJson(trimmed)),
    [trimmed, isEmpty],
  );
  const value = parsed?.ok ? parsed.value : undefined;

  const search = useMemo(
    () =>
      query && value !== undefined
        ? searchJson(value, query)
        : { open: new Set<string>(), hit: new Set<string>() },
    [query, value],
  );
  const searching = query.length > 0;

  const isOpen = useCallback(
    (id: string, depth: number) => {
      if (searching) return search.open.has(id) || id === "root";
      if (forceOpen.has(id)) return true;
      if (forceClosed.has(id)) return false;
      return depth < 2;
    },
    [searching, search.open, forceOpen, forceClosed],
  );

  const toggle = useCallback(
    (id: string, currentlyOpen: boolean) => {
      setForceOpen((prev) => {
        const n = new Set(prev);
        if (currentlyOpen) n.delete(id);
        else n.add(id);
        return n;
      });
      setForceClosed((prev) => {
        const n = new Set(prev);
        if (currentlyOpen) n.add(id);
        else n.delete(id);
        return n;
      });
    },
    [],
  );

  const expandAll = () => {
    if (value === undefined) return;
    setForceOpen(new Set(collectContainers(value).map((c) => c.id)));
    setForceClosed(new Set());
  };
  const collapseAll = () => {
    if (value === undefined) return;
    setForceClosed(
      new Set(collectContainers(value).map((c) => c.id).filter((id) => id !== "root")),
    );
    setForceOpen(new Set());
  };

  const apply = (next: string) => setText(next);
  const onFormat = () => value !== undefined && apply(formatJson(value, indent));
  const onMinify = () => value !== undefined && apply(JSON.stringify(value));
  const onSort = () =>
    value !== undefined && apply(formatJson(sortDeep(value), indent));

  const copyOutput = async () => {
    const out = value !== undefined ? formatJson(value, indent) : text;
    await navigator.clipboard.writeText(out);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const share = async () => {
    const c = compressToEncodedURIComponent(text);
    const url = `${window.location.origin}${window.location.pathname}#doc=${c}`;
    window.history.replaceState(null, "", url);
    await copyShareLink(url);
    setShared(true);
    setTimeout(() => setShared(false), 1600);
  };

  const bytes = new TextEncoder().encode(text).length;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      {/* ---------------------------------------------------------- editor */}
      <div className="panel registered flex min-h-[480px] flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge p-2">
          <span className="readout mr-1 px-1">Source</span>
          <ToolbarBtn onClick={onFormat} disabled={!parsed?.ok} icon={AlignLeft} label="Format" />
          <ToolbarBtn onClick={onMinify} disabled={!parsed?.ok} icon={Minimize2} label="Minify" />
          <ToolbarBtn onClick={onSort} disabled={!parsed?.ok} icon={SortAsc} label="Sort keys" />
          <div className="ml-auto flex items-center gap-1.5">
            <select
              value={String(indent)}
              onChange={(e) =>
                setIndent(e.target.value === "\t" ? "\t" : (Number(e.target.value) as IndentOpt))
              }
              className="input h-9 w-auto text-xs text-muted"
              aria-label="Indentation"
            >
              <option value="2">2 spaces</option>
              <option value="4">4 spaces</option>
              <option value="\t">Tab</option>
            </select>
            {text ? (
              <button
                onClick={() => setText("")}
                className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 font-mono text-xs text-faint hover:text-danger"
              >
                <X size={12} /> Clear
              </button>
            ) : (
              <button
                onClick={() => setText(SAMPLE)}
                className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-sm)] px-2 font-mono text-xs text-faint hover:text-accent"
              >
                Load sample
              </button>
            )}
          </div>
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          placeholder='Paste JSON here — e.g. {"hello": "world"}'
          className="flex-1 resize-none bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint"
        />

        <div className="flex items-center gap-3 border-t border-edge px-3 py-2 readout tabular">
          {isEmpty ? (
            <span className="text-faint">Awaiting input</span>
          ) : parsed?.ok ? (
            <span className="flex items-center gap-1.5 text-positive">
              <Check size={12} /> Valid JSON
            </span>
          ) : (
            <span className="truncate text-danger">
              ✕ {parsed?.error.message}
              {parsed?.error.line
                ? ` (line ${parsed.error.line}, col ${parsed.error.column})`
                : ""}
            </span>
          )}
          <span className="ml-auto text-faint">{bytes} B</span>
        </div>
      </div>

      {/* ------------------------------------------------------------ view */}
      <div className="panel registered flex min-h-[480px] flex-col">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge p-2">
          <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
            <TabBtn active={view === "tree"} onClick={() => setView("tree")} icon={ListTree} label="Tree" />
            <TabBtn active={view === "raw"} onClick={() => setView("raw")} icon={FileJson} label="Raw" />
          </div>

          {view === "tree" && (
            <div className="flex items-center gap-1">
              <button onClick={expandAll} className="rounded-[var(--radius-sm)] px-2 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink" disabled={!parsed?.ok}>
                Expand
              </button>
              <button onClick={collapseAll} className="rounded-[var(--radius-sm)] px-2 py-1.5 font-mono text-xs text-muted hover:bg-raised hover:text-ink" disabled={!parsed?.ok}>
                Collapse
              </button>
            </div>
          )}

          <div className="ml-auto flex items-center gap-1.5">
            <button onClick={share} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent", shared && "border-positive text-positive")}>
              {shared ? <Check size={13} /> : <Link2 size={13} />}
              {shared ? "Copied" : "Share"}
            </button>
            <button onClick={copyOutput} disabled={isEmpty} className={cn("inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-2.5 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40", copied && "border-positive text-positive")}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        {view === "tree" && (
          <div className="flex items-center gap-2 border-b border-edge px-3">
            <Search size={13} className="text-faint" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search keys & values…"
              className="h-9 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-faint"
            />
            {query && (
              <button onClick={() => setQuery("")} className="text-faint hover:text-ink">
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <div className="flex-1 overflow-auto p-2">
          {isEmpty ? (
            <Placeholder />
          ) : !parsed?.ok ? (
            <div className="flex h-full items-center justify-center p-6 text-center font-mono text-xs text-danger">
              Fix the JSON on the left to inspect it here.
            </div>
          ) : view === "raw" ? (
            <pre
              className="whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-ink"
              dangerouslySetInnerHTML={{ __html: highlightJson(formatJson(value!, indent)) }}
            />
          ) : (
            <div className="font-mono text-[13px]">
              <TreeNode
                k={null}
                value={value!}
                id="root"
                accessor=""
                depth={0}
                isOpen={isOpen}
                toggle={toggle}
                hit={search.hit}
                query={query}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- subviews */

function Placeholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <ListTree size={22} className="text-faint" />
      <p className="font-mono text-xs text-faint">
        Paste JSON to explore it as an interactive tree.
      </p>
    </div>
  );
}

function ToolbarBtn({
  onClick,
  disabled,
  icon: Icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] px-2 font-mono text-xs text-muted transition-colors hover:bg-raised hover:text-ink disabled:opacity-40"
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  icon: Icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ComponentType<{ size?: number }>;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-[3px] px-2.5 font-mono text-xs transition-colors",
        active ? "bg-accent text-[#070806]" : "text-muted hover:text-ink",
      )}
    >
      <Icon size={13} />
      {label}
    </button>
  );
}

const CHILD_CAP = 1000;

function TreeNode({
  k,
  value,
  id,
  accessor,
  depth,
  isParentArray,
  isOpen,
  toggle,
  hit,
  query,
}: {
  k: string | null;
  value: JsonValue;
  id: string;
  accessor: string;
  depth: number;
  isParentArray?: boolean;
  isOpen: (id: string, depth: number) => boolean;
  toggle: (id: string, open: boolean) => void;
  hit: Set<string>;
  query: string;
}) {
  const t = typeOf(value);
  const isContainer = t === "object" || t === "array";
  const open = isContainer ? isOpen(id, depth) : false;
  const isHit = hit.has(id);

  const entries: [string, JsonValue][] = isContainer
    ? Array.isArray(value)
      ? value.map((c, i) => [String(i), c])
      : Object.entries(value as Record<string, JsonValue>)
    : [];

  const copyPath = () => navigator.clipboard.writeText(accessor || "$");
  const copyValue = () =>
    navigator.clipboard.writeText(
      typeof value === "object" && value !== null ? JSON.stringify(value) : String(value),
    );

  return (
    <div>
      <div
        className={cn(
          "group flex items-center gap-1.5 rounded-[3px] py-[3px] pr-2 hover:bg-raised",
          isHit && "bg-signal-glow",
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {isContainer ? (
          <button
            onClick={() => toggle(id, open)}
            className="flex h-4 w-4 shrink-0 items-center justify-center text-faint hover:text-accent"
            aria-label={open ? "Collapse" : "Expand"}
          >
            <ChevronRight size={13} className={cn("transition-transform", open && "rotate-90")} />
          </button>
        ) : (
          <span className="h-4 w-4 shrink-0" />
        )}

        {k !== null && (
          <span
            className={cn(isParentArray ? "text-faint" : "tok-key")}
            dangerouslySetInnerHTML={{ __html: highlightText(k, query) }}
          />
        )}
        {k !== null && <span className="text-faint">:</span>}

        {isContainer ? (
          <span className="text-faint">
            {Array.isArray(value) ? "[" : "{"}
            {!open && (
              <span className="px-1 text-muted">{preview(value).split(" ")[1]}</span>
            )}
            {!open && (Array.isArray(value) ? "]" : "}")}
          </span>
        ) : (
          <ScalarValue value={value} type={t} query={query} />
        )}

        <span className="ml-auto hidden items-center gap-1 pl-3 group-hover:flex">
          <button onClick={copyPath} title="Copy path" className="text-faint hover:text-accent">
            <Link2 size={12} />
          </button>
          <button onClick={copyValue} title="Copy value" className="text-faint hover:text-accent">
            <Copy size={12} />
          </button>
        </span>
      </div>

      {isContainer && open && (
        <div>
          {entries.slice(0, CHILD_CAP).map(([childKey, childVal]) => (
            <TreeNode
              key={childKey}
              k={childKey}
              value={childVal}
              id={`${id}/${childKey}`}
              accessor={
                Array.isArray(value)
                  ? `${accessor}[${childKey}]`
                  : accessor
                    ? `${accessor}.${childKey}`
                    : childKey
              }
              depth={depth + 1}
              isParentArray={Array.isArray(value)}
              isOpen={isOpen}
              toggle={toggle}
              hit={hit}
              query={query}
            />
          ))}
          {entries.length > CHILD_CAP && (
            <div
              className="py-1 font-mono text-xs text-faint"
              style={{ paddingLeft: (depth + 1) * 14 + 22 }}
            >
              … {entries.length - CHILD_CAP} more items hidden
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScalarValue({
  value,
  type,
  query,
}: {
  value: JsonValue;
  type: string;
  query: string;
}) {
  if (type === "string") {
    return (
      <span className="tok-str">
        &quot;
        <span dangerouslySetInnerHTML={{ __html: highlightText(String(value), query) }} />
        &quot;
      </span>
    );
  }
  const cls =
    type === "number" ? "tok-num" : type === "boolean" ? "tok-bool" : "tok-null";
  return <span className={cls}>{String(value)}</span>;
}
