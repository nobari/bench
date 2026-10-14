"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, Check, Download, Expand, Maximize2, Minimize2, Sparkles, Upload, Wand2, WrapText, X } from "lucide-react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, placeholder as cmPlaceholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, LRLanguage, LanguageDescription, indentUnit, syntaxHighlighting, syntaxTree } from "@codemirror/language";
import { linter, lintGutter, type Diagnostic } from "@codemirror/lint";
import { languages as cmLanguages } from "@codemirror/language-data";
import { tags as t } from "@lezer/highlight";
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  SAMPLE,
  checkSyntax,
  codeStats,
  formatCode,
  getLanguage,
  guessLanguage,
  isLanguageId,
  languageForFilename,
  type Problem,
} from "@/lib/tools/web/code";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { readShareState, useShareState } from "@/lib/share-state";
import { cn } from "@/lib/utils";

const DRAFT_KEY = "bench:code:draft";
const LANG_KEY = "bench:code:lang";
const PREFS_KEY = "bench:code:prefs";
const MAX_DRAFT = 1_000_000;
const MAX_FILE = 8_000_000;
/** Above this the parser-based check is skipped (the editor's own tree still underlines). */
const MAX_CHECK = 400_000;

const INDENTS = [
  { id: "2", label: "2 spaces", tabWidth: 2, useTabs: false },
  { id: "4", label: "4 spaces", tabWidth: 4, useTabs: false },
  { id: "tab", label: "Tabs", tabWidth: 4, useTabs: true },
] as const;
type IndentId = (typeof INDENTS)[number]["id"];
const WIDTHS = [80, 100, 120] as const;

interface Prefs {
  indent: IndentId;
  width: (typeof WIDTHS)[number];
  wrap: boolean;
}
const DEFAULT_PREFS: Prefs = { indent: "2", width: 80, wrap: false };

const PICKER = [...LANGUAGES].sort((a, b) => (a.id === "text" ? -1 : b.id === "text" ? 1 : a.name.localeCompare(b.name)));

/** Colours come from the theme's --code-* tokens, so the three themes need no separate styles. */
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: "var(--code-keyword)" },
  { tag: [t.string, t.special(t.string), t.inserted, t.processingInstruction], color: "var(--code-string)" },
  { tag: [t.number, t.integer, t.float], color: "var(--code-number)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment, t.meta], color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [t.typeName, t.className, t.namespace, t.annotation, t.changed, t.self], color: "var(--code-type)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName, t.macroName], color: "var(--code-function)" },
  { tag: [t.variableName, t.definition(t.variableName), t.name, t.character, t.separator], color: "var(--code-variable)" },
  { tag: [t.atom, t.bool, t.null, t.constant(t.name), t.standard(t.name), t.special(t.variableName), t.color], color: "var(--code-constant)" },
  { tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator, t.url, t.escape, t.regexp], color: "var(--code-operator)" },
  { tag: [t.tagName, t.angleBracket], color: "var(--code-tag)" },
  { tag: [t.attributeName], color: "var(--code-attribute)" },
  { tag: [t.propertyName, t.definition(t.propertyName), t.attributeValue], color: "var(--code-property)" },
  { tag: t.heading, fontWeight: "600", color: "var(--code-heading)" },
  { tag: t.strong, fontWeight: "600" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.link, color: "var(--code-string)", textDecoration: "underline" },
  { tag: [t.invalid, t.deleted], color: "var(--code-invalid)" },
]);

function readInitial(): { text: string; language: string | null; source: "link" | "draft" | "sample" } {
  if (typeof window === "undefined") return { text: SAMPLE, language: null, source: "sample" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const c = hash.get("c");
  if (c) {
    try {
      const v = decompressFromEncodedURIComponent(c);
      if (v) return { text: v, language: null, source: "link" };
    } catch {
      /* ignore */
    }
  }
  const i = new URLSearchParams(window.location.search).get("i");
  if (i !== null) return { text: i, language: null, source: "link" };
  try {
    const draft = localStorage.getItem(DRAFT_KEY);
    if (draft) return { text: draft, language: localStorage.getItem(LANG_KEY), source: "draft" };
  } catch {
    /* storage unavailable */
  }
  return { text: SAMPLE, language: null, source: "sample" };
}

function readPrefs(): Prefs {
  const shared = readShareState<Prefs>("code");
  let stored: Partial<Prefs> = {};
  try {
    stored = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
  } catch {
    /* ignore */
  }
  const pick = { ...DEFAULT_PREFS, ...stored, ...shared };
  return {
    indent: INDENTS.some((i) => i.id === pick.indent) ? pick.indent : DEFAULT_PREFS.indent,
    width: (WIDTHS as readonly number[]).includes(pick.width) ? pick.width : DEFAULT_PREFS.width,
    wrap: pick.wrap === true,
  };
}

const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const FIELD = "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-1.5 text-[12px] text-ink outline-none focus:border-accent";

export function CodeEditorWidget() {
  const [initial] = useState(readInitial);
  const [langParam, setLangParam] = useQueryState("l", parseAsString.withDefault("").withOptions({ history: "replace" }));
  const [langId, setLangIdState] = useState<string>(() => {
    if (langParam && isLanguageId(langParam)) return langParam;
    if (initial.language && isLanguageId(initial.language)) return initial.language;
    if (initial.source === "link") return guessLanguage(initial.text)?.id ?? DEFAULT_LANGUAGE;
    return DEFAULT_LANGUAGE;
  });
  const language = useMemo(() => getLanguage(langId), [langId]);
  const setLanguage = useCallback(
    (id: string) => {
      setLangIdState(id);
      void setLangParam(id);
    },
    [setLangParam],
  );
  const [prefs, setPrefs] = useState<Prefs>(readPrefs);
  useShareState("code", prefs);
  const indent = INDENTS.find((i) => i.id === prefs.indent) ?? INDENTS[0];

  const [text, setText] = useState(initial.text);
  const [fileName, setFileName] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1, selected: 0 });
  const [problems, setProblems] = useState<Problem[]>([]);
  const [checkMode, setCheckMode] = useState<"parser" | "tree" | "none">("none");
  const [note, setNote] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [problemsOpen, setProblemsOpen] = useState(true);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const langCompartment = useRef(new Compartment());
  const indentCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const lintCompartment = useRef(new Compartment());
  const languageRef = useRef(language);
  useEffect(() => {
    languageRef.current = language;
  }, [language]);
  const treeCheckRef = useRef(false);
  const formatRef = useRef<() => void>(() => {});
  const downloadRef = useRef<() => void>(() => {});
  const stats = useMemo(() => codeStats(text), [text]);

  // The editor itself, created once; everything that changes later goes through compartments.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const lint = linter(
      async (view) => {
        const doc = view.state.doc.toString();
        const lang = languageRef.current;
        const diags: Diagnostic[] = [];
        const toOffset = (line: number, col: number) => {
          const l = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines));
          return Math.min(l.from + Math.max(0, col - 1), l.to);
        };
        let mode: "parser" | "tree" | "none" = "none";
        let list: Problem[] = [];
        if (doc.length <= MAX_CHECK) {
          const res = await checkSyntax(doc, lang);
          if (res.checked) {
            mode = "parser";
            list = res.problems;
          }
        }
        if (mode !== "parser" && treeCheckRef.current && doc.trim()) {
          mode = "tree";
          const tree = syntaxTree(view.state);
          let n = 0;
          tree.iterate({
            enter: (node) => {
              if (!node.type.isError || n >= 60) return;
              n++;
              const from = node.from, to = Math.max(node.to, Math.min(node.from + 1, view.state.doc.length));
              const line = view.state.doc.lineAt(from);
              const near = view.state.doc.sliceString(from, Math.min(to, from + 12)).trim();
              list.push({ line: line.number, column: from - line.from + 1, message: near ? `Unexpected “${near}”` : "Unexpected end of input", source: "parser" });
              diags.push({ from, to, severity: "error", message: near ? `Unexpected “${near}”` : "Unexpected end of input", source: lang.name });
            },
          });
        }
        if (mode === "parser") {
          for (const p of list) {
            const from = toOffset(p.line, p.column);
            const to = p.endLine ? Math.max(from + 1, toOffset(p.endLine, p.endColumn ?? p.column + 1)) : Math.min(view.state.doc.length, Math.max(from + 1, view.state.doc.lineAt(from).to));
            diags.push({ from, to: Math.min(to, view.state.doc.length), severity: "error", message: p.message, source: p.source === "parser" ? "syntax" : p.source });
          }
        }
        setProblems(list);
        setCheckMode(mode);
        return diags;
      },
      { delay: 650 },
    );
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: initial.text,
        extensions: [
          basicSetup,
          keymap.of([
            indentWithTab,
            { key: "Shift-Alt-f", run: () => (formatRef.current(), true) },
            { key: "Mod-Shift-f", run: () => (formatRef.current(), true) },
            { key: "Mod-s", run: () => (downloadRef.current(), true) },
          ]),
          syntaxHighlighting(highlight),
          cmPlaceholder("Paste or type code, or drop a file here…"),
          langCompartment.current.of([]),
          indentCompartment.current.of([indentUnit.of("  "), EditorState.tabSize.of(2)]),
          wrapCompartment.current.of([]),
          lintCompartment.current.of([lint, lintGutter()]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) setText(u.state.doc.toString());
            if (u.selectionSet || u.docChanged) {
              const sel = u.state.selection.main;
              const line = u.state.doc.lineAt(sel.head);
              setCursor({ line: line.number, col: sel.head - line.from + 1, selected: Math.abs(sel.to - sel.from) });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    // Exposed for automated tests, which cannot type into CodeMirror reliably.
    (window as unknown as { __benchCode?: EditorView | null }).__benchCode = view;
    return () => {
      view.destroy();
      viewRef.current = null;
      (window as unknown as { __benchCode?: EditorView | null }).__benchCode = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- created once; later changes go through compartments
  }, []);

  // The language package, loaded on demand (most are small; the list covers 80+ names).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    let active = true;
    treeCheckRef.current = false;
    const desc = language.cm ? LanguageDescription.matchLanguageName(cmLanguages, language.cm, true) : null;
    if (!desc) {
      view.dispatch({ effects: langCompartment.current.reconfigure([]) });
      return;
    }
    void desc.load().then((support) => {
      if (!active || !viewRef.current) return;
      treeCheckRef.current = support.language instanceof LRLanguage;
      viewRef.current.dispatch({ effects: langCompartment.current.reconfigure(support) });
    });
    return () => {
      active = false;
    };
  }, [language]);

  // Indentation and wrapping follow the preferences; they are remembered on this device.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        indentCompartment.current.reconfigure([indentUnit.of(indent.useTabs ? "\t" : " ".repeat(indent.tabWidth)), EditorState.tabSize.of(indent.tabWidth)]),
        wrapCompartment.current.reconfigure(prefs.wrap ? EditorView.lineWrapping : []),
      ],
    });
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable */
    }
  }, [prefs, indent]);

  // Draft autosave (debounced) and the language that goes with it.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        if (text.trim() && text.length <= MAX_DRAFT) localStorage.setItem(DRAFT_KEY, text);
        else localStorage.removeItem(DRAFT_KEY);
        localStorage.setItem(LANG_KEY, langId);
        setSavedAt(Date.now());
      } catch {
        /* storage unavailable */
      }
    }, 500);
    return () => clearTimeout(id);
  }, [text, langId]);

  // Share: the document rides compressed in the hash.
  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (text.trim()) h.set("c", compressToEncodedURIComponent(text));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [text]);

  const replaceDoc = useCallback((next: string, keepCursor = true) => {
    const view = viewRef.current;
    if (!view) return;
    const head = view.state.selection.main.head;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
      selection: { anchor: keepCursor ? Math.min(head, next.length) : 0 },
      scrollIntoView: keepCursor,
    });
  }, []);

  const jumpTo = (p: Problem) => {
    const view = viewRef.current;
    if (!view) return;
    const line = view.state.doc.line(Math.min(Math.max(1, p.line), view.state.doc.lines));
    const pos = Math.min(line.from + Math.max(0, p.column - 1), line.to);
    view.dispatch({ selection: { anchor: pos }, effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    view.focus();
  };

  const prettify = useCallback(async () => {
    const view = viewRef.current;
    const lang = languageRef.current;
    if (!view || busy) return;
    const doc = view.state.doc.toString();
    if (!doc.trim()) return;
    setBusy(true);
    try {
      const r = await formatCode(doc, lang, { printWidth: prefs.width, tabWidth: indent.tabWidth, useTabs: indent.useTabs });
      if (r.ok) {
        if (r.changed) replaceDoc(r.text);
        setNote({ tone: "ok", text: r.changed ? `Formatted as ${lang.name}.` : "Already formatted." });
      } else if (r.unsupported) {
        setNote({ tone: "warn", text: `${r.error} Formatting covers JavaScript, TypeScript, JSON, HTML, Vue, CSS, SCSS, Less, Markdown, YAML, GraphQL, Handlebars and the SQL dialects.` });
      } else {
        setNote({ tone: "error", text: `Can't format: ${r.error}` });
        if (r.problem) jumpTo(r.problem);
      }
    } finally {
      setBusy(false);
      setTimeout(() => setNote((n) => (n?.tone === "ok" ? null : n)), 2500);
    }
  }, [busy, prefs.width, indent, replaceDoc]);
  useEffect(() => {
    formatRef.current = () => void prettify();
  }, [prettify]);

  const detect = () => {
    const guess = guessLanguage(text);
    if (guess) {
      setLanguage(guess.id);
      setNote({ tone: "ok", text: `Looks like ${guess.name}.` });
      setTimeout(() => setNote((n) => (n?.tone === "ok" ? null : n)), 2500);
    } else setNote({ tone: "warn", text: "Couldn't tell the language from the text; pick one from the list." });
  };

  const openFile = async (file: File) => {
    if (file.size > MAX_FILE) {
      setNote({ tone: "error", text: `${file.name} is ${(file.size / 1e6).toFixed(1)} MB; the editor takes files up to ${MAX_FILE / 1e6} MB.` });
      return;
    }
    const content = await file.text();
    replaceDoc(content, false);
    setFileName(file.name);
    const byName = languageForFilename(file.name) ?? guessLanguage(content);
    if (byName) setLanguage(byName.id);
    setNote(null);
  };

  const base = (fileName ?? "untitled").replace(/\.[^.]+$/, "") || "untitled";
  const ext = language.extensions[0] ?? "txt";
  const download = useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const blob = new Blob([view.state.doc.toString()], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${base}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [base, ext]);
  useEffect(() => {
    downloadRef.current = download;
  }, [download]);

  // Fill the window and real full screen on the panel; Esc leaves the fill mode.
  useEffect(() => {
    if (!fill) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.fullscreenElement) setFill(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [fill]);
  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === panelRef.current && !!panelRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void panelRef.current?.requestFullscreen?.().catch(() => setFill(true));
  };

  const canFormat = !!(language.prettier || language.sql);
  const status =
    !text.trim()
      ? { tone: "muted" as const, text: "Empty" }
      : problems.length
        ? { tone: "danger" as const, text: `${problems.length} problem${problems.length > 1 ? "s" : ""}` }
        : checkMode === "parser"
          ? { tone: "positive" as const, text: `No problems · ${language.name}` }
          : checkMode === "tree"
            ? { tone: "positive" as const, text: "No problems in the editor's parse" }
            : { tone: "muted" as const, text: language.cm ? "Checking…" : "Not checked (plain text)" };

  return (
    <div className="space-y-3">
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <label className="flex items-center gap-1.5 text-[12px] text-muted">
          Language
          <select value={langId} onChange={(e) => setLanguage(e.target.value)} className={cn(FIELD, "max-w-[11rem] pr-6")} data-language>
            {PICKER.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.prettier || l.sql ? " ✦" : ""}
              </option>
            ))}
          </select>
        </label>
        <button onClick={detect} className={GHOST} title="Guess the language from the text" data-detect>
          <Sparkles size={13} /> Detect
        </button>
        <span className="mx-0.5 h-5 w-px bg-edge" />
        <button
          onClick={() => void prettify()}
          disabled={busy || !text.trim()}
          className={cn(
            "inline-flex h-7 items-center gap-1.5 rounded-[var(--radius-sm)] px-3 text-[12.5px] font-medium transition-colors",
            canFormat ? "bg-accent text-on-accent hover:bg-[var(--color-accent-hover)]" : "border border-edge text-muted hover:border-accent hover:text-accent",
          )}
          title={canFormat ? "Prettify (Shift+Alt+F or ⌘⇧F)" : `No formatter for ${language.name}; languages marked ✦ can be formatted`}
          data-prettify
        >
          <Wand2 size={13} /> {busy ? "Formatting…" : "Prettify"}
        </button>
        <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Indentation for typing and formatting">
          <select value={prefs.indent} onChange={(e) => setPrefs((p) => ({ ...p, indent: e.target.value as IndentId }))} className={cn(FIELD, "pr-6")} aria-label="Indentation" data-indent>
            {INDENTS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Line width the formatter aims for">
          <select value={prefs.width} onChange={(e) => setPrefs((p) => ({ ...p, width: Number(e.target.value) as Prefs["width"] }))} className={cn(FIELD, "pr-6")} aria-label="Print width" data-width>
            {WIDTHS.map((w) => (
              <option key={w} value={w}>
                {w} cols
              </option>
            ))}
          </select>
        </label>
        <button onClick={() => setPrefs((p) => ({ ...p, wrap: !p.wrap }))} className={cn(GHOST, prefs.wrap && "border-accent text-accent")} title="Wrap long lines" aria-pressed={prefs.wrap} data-wrap>
          <WrapText size={13} /> Wrap
        </button>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void openFile(f);
              e.target.value = "";
            }}
            data-file-input
          />
          <button onClick={() => fileRef.current?.click()} className={GHOST} title="Open a file from this device (or drop one on the editor)">
            <Upload size={13} /> Open
          </button>
          <CopyButton value={text} label="Copy" />
          <button onClick={download} disabled={!text} className={GHOST} title={`Download as ${base}.${ext} (⌘S)`} data-download>
            <Download size={13} /> {base.length > 18 ? base.slice(0, 17) + "…" : base}.{ext}
          </button>
          <button onClick={() => { replaceDoc(SAMPLE, false); setLanguage("javascript"); setFileName(null); }} className="text-[12px] text-faint hover:text-ink">
            Load sample
          </button>
          {text && (
            <button onClick={() => { replaceDoc("", false); setFileName(null); setNote(null); }} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>

      {note && (
        <div className={cn("panel flex items-start gap-2 p-3 text-[13px] text-muted", note.tone === "error" && "border-danger/50", note.tone === "warn" && "border-warn/50")} data-note>
          {note.tone === "ok" ? <Check size={15} className="mt-0.5 shrink-0 text-positive" /> : <AlertTriangle size={15} className={cn("mt-0.5 shrink-0", note.tone === "error" ? "text-danger" : "text-warn")} />}
          <span className="flex-1">{note.text}</span>
          <button onClick={() => setNote(null)} aria-label="Dismiss" className="text-faint hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      <div
        ref={panelRef}
        className={cn("panel code-panel flex min-w-0 flex-col", fill && "fixed inset-0 z-[60] rounded-none border-0", fullscreen && "rounded-none border-0")}
        data-code-panel
        data-fill={fill ? "true" : undefined}
        data-dragging={dragging ? "true" : undefined}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            if (!dragging) setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          const f = e.dataTransfer.files?.[0];
          if (!f) return;
          e.preventDefault();
          setDragging(false);
          void openFile(f);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <span className="readout">
            {fileName ?? "Editor"}
            {fileName ? "" : ` · ${language.name}`}
          </span>
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[12px]",
                status.tone === "positive" && "text-positive",
                status.tone === "danger" && "text-danger",
                status.tone === "muted" && "text-faint",
              )}
              data-status={status.tone}
            >
              {status.tone === "positive" ? <Check size={13} /> : status.tone === "danger" ? <AlertTriangle size={13} /> : null}
              {status.text}
            </span>
            {!fullscreen && (
              <button onClick={() => setFill((f) => !f)} className={cn(GHOST, fill && "border-accent text-accent")} title={fill ? "Back to the page (Esc)" : "Fill the browser window"} data-fill-toggle>
                {fill ? <Minimize2 size={13} /> : <Expand size={13} />} {fill ? "Exit" : "Fill window"}
              </button>
            )}
            <button onClick={toggleFullscreen} className={cn(GHOST, fullscreen && "border-accent text-accent")} title={fullscreen ? "Leave full screen (Esc)" : "Full screen"} data-fullscreen-toggle>
              <Maximize2 size={13} /> {fullscreen ? "Exit full screen" : "Full screen"}
            </button>
          </div>
        </div>
        <div ref={hostRef} className={cn("min-w-0", fill || fullscreen ? "min-h-0 flex-1" : "h-[560px] resize-y overflow-hidden")} data-editor-host />
        {problems.length > 0 && (
          <div className="border-t border-edge bg-base-2" data-problems>
            <button onClick={() => setProblemsOpen((o) => !o)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-danger" aria-expanded={problemsOpen}>
              <AlertTriangle size={13} /> {problems.length} problem{problems.length > 1 ? "s" : ""}
              <span className="ml-auto text-faint">{problemsOpen ? "hide" : "show"}</span>
            </button>
            {problemsOpen && (
              <ol className="max-h-40 divide-y divide-edge overflow-auto border-t border-edge">
                {problems.map((p, i) => (
                  <li key={i}>
                    <button onClick={() => jumpTo(p)} className="flex w-full items-baseline gap-3 px-3 py-1.5 text-left text-[12.5px] hover:bg-raised" data-problem>
                      <code className="shrink-0 font-mono text-[11.5px] text-muted tabular">
                        Ln {p.line}, Col {p.column}
                      </code>
                      <span className="min-w-0 flex-1 text-ink">{p.message}</span>
                      <span className="shrink-0 rounded border border-edge px-1 font-mono text-[10px] text-faint">{p.source === "parser" ? "syntax" : p.source}</span>
                    </button>
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge px-3 py-1.5 readout tabular" data-footer>
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          {cursor.selected > 0 && <span>{cursor.selected.toLocaleString()} selected</span>}
          <span>{stats.lines.toLocaleString()} lines</span>
          <span>{stats.chars.toLocaleString()} ch</span>
          <span>{stats.bytes.toLocaleString()} B</span>
          <span>{indent.label}</span>
          <span>UTF-8</span>
          <span className="ml-auto">{savedAt ? "Draft saved in this browser" : initial.source === "draft" ? "Draft restored" : ""}</span>
        </div>
      </div>
    </div>
  );
}
