"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, ArrowRight, Check, Plus, RotateCcw, Trash2, Wand2, X } from "lucide-react";
import {
  DRAFTS,
  NODE_TYPES,
  STRING_FORMATS,
  createNode,
  inferNode,
  nodeToSchema,
  parseJsonText,
  schemaToNode,
  updateNode,
  type NodeType,
  type SchemaNode,
} from "@/lib/tools/json/schema";
import { validateJson } from "@/lib/tools/json/validate";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const MODES = ["validate", "design"] as const;
const DRAFT_PREFS = ["auto", "2020-12", "2019-09", "draft-07", "draft-06", "draft-04"] as const;

const DEFAULT_SCHEMA = JSON.stringify(
  {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "User",
    type: "object",
    required: ["name", "email"],
    properties: {
      name: { type: "string", minLength: 1 },
      email: { type: "string", format: "email" },
      age: { type: "integer", minimum: 0 },
      tags: { type: "array", items: { type: "string" }, uniqueItems: true },
    },
    additionalProperties: false,
  },
  null,
  2,
);
const DEFAULT_DATA = JSON.stringify({ name: "Ada", email: "ada@example.com", age: 36, tags: ["math", "code"] }, null, 2);

/**
 * Schema/data/sample are read once from the URL — compressed in the hash
 * (what Share writes) or plain `s`/`d`/`j` query params (examples) — and
 * kept in local state; they can be far too large for the query string.
 */
function readInitial(): { schema: string; data: string; sample: string } {
  if (typeof window === "undefined") return { schema: DEFAULT_SCHEMA, data: DEFAULT_DATA, sample: "" };
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const q = new URLSearchParams(window.location.search);
  const dec = (v: string | null) => {
    if (!v) return null;
    try {
      return decompressFromEncodedURIComponent(v) || null;
    } catch {
      return null;
    }
  };
  return {
    schema: dec(hash.get("s")) ?? q.get("s") ?? DEFAULT_SCHEMA,
    data: dec(hash.get("d")) ?? q.get("d") ?? DEFAULT_DATA,
    sample: dec(hash.get("j")) ?? q.get("j") ?? "",
  };
}

function nodeFromText(text: string): SchemaNode | null {
  const p = parseJsonText(text);
  return p.ok ? schemaToNode(p.value) : null;
}

const F =
  "h-7 rounded-[var(--radius-sm)] border border-edge bg-base px-1.5 font-mono text-[11.5px] text-ink outline-none placeholder:text-faint focus:border-accent";
const TA =
  "min-h-[300px] flex-1 resize-y bg-transparent p-3 font-mono text-[13px] leading-relaxed text-ink outline-none placeholder:text-faint";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";

export function JsonSchemaWidget() {
  const [mode, setMode] = useQueryState(
    "m",
    parseAsStringLiteral(MODES).withDefault("validate").withOptions({ history: "replace" }),
  );
  const [draftPref, setDraftPref] = useQueryState(
    "draft",
    parseAsStringLiteral(DRAFT_PREFS).withDefault("auto").withOptions({ history: "replace" }),
  );
  const [initial] = useState(readInitial);
  const [schemaText, setSchemaText] = useState(initial.schema);
  const [dataText, setDataText] = useState(initial.data);
  const [sampleText, setSampleText] = useState(initial.sample);
  const [sampleOpen, setSampleOpen] = useState(Boolean(initial.sample));
  const [root, setRoot] = useState<SchemaNode>(() => {
    if (initial.sample) {
      const p = parseJsonText(initial.sample);
      if (p.ok) return inferNode(p.value);
    }
    return nodeFromText(initial.schema) ?? createNode("object");
  });
  const [note, setNote] = useState<string | null>(null);

  const deferredSchema = useDeferredValue(schemaText);
  const deferredData = useDeferredValue(dataText);
  const report = useMemo(() => {
    const s = parseJsonText(deferredSchema);
    const d = parseJsonText(deferredData);
    return { schema: s, data: d, result: s.ok && d.ok ? validateJson(s.value, d.value, draftPref) : null };
  }, [deferredSchema, deferredData, draftPref]);

  const outputSchema = useMemo(() => JSON.stringify(nodeToSchema(root), null, 2), [root]);
  const schemaErr = report.schema.ok ? null : report.schema.error;
  const dataErr = report.data.ok ? null : report.data.error;

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      h.set("s", compressToEncodedURIComponent(mode === "design" ? outputSchema : schemaText));
      if (dataText.trim()) h.set("d", compressToEncodedURIComponent(dataText));
      if (mode === "design" && sampleText.trim()) h.set("j", compressToEncodedURIComponent(sampleText));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [mode, outputSchema, schemaText, dataText, sampleText]);

  const patch = (id: string, fn: (n: SchemaNode) => SchemaNode) => setRoot((r) => updateNode(r, id, fn));

  const designCurrent = () => {
    const n = nodeFromText(schemaText);
    if (!n) {
      setNote("The schema isn't valid JSON, so it can't be opened in the designer.");
      return;
    }
    setRoot(n);
    setNote(null);
    setMode("design");
  };
  const useInValidator = () => {
    setSchemaText(outputSchema);
    if (sampleText.trim()) setDataText(sampleText);
    setMode("validate");
  };
  const inferFromSample = () => {
    const p = parseJsonText(sampleText);
    if (!p.ok) {
      setNote(p.error === "empty" ? "Paste some sample JSON first." : `Sample JSON: ${p.error}`);
      return;
    }
    setRoot(inferNode(p.value));
    setNote(null);
  };

  const status = (() => {
    if (!report.schema.ok) return { tone: "warn", text: report.schema.error === "empty" ? "Paste a schema" : "Schema is not valid JSON" };
    if (!report.data.ok) return { tone: "warn", text: report.data.error === "empty" ? "Paste data to validate" : "Data is not valid JSON" };
    const r = report.result!;
    if (r.schemaErrors.length) return { tone: "danger", text: `${r.schemaErrors.length} problem${r.schemaErrors.length > 1 ? "s" : ""} in the schema` };
    if (r.valid) return { tone: "positive", text: `Valid · ${DRAFTS.find((d) => d.id === r.draft)?.label}` };
    return { tone: "danger", text: `${r.issues.length} issue${r.issues.length > 1 ? "s" : ""}` };
  })();

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["validate", "Validate"],
              ["design", "Design"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cn(
                "h-7 rounded-[3px] px-3 text-[13px] transition-colors",
                mode === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "validate" ? (
          <label className="flex items-center gap-1.5 text-[12px] text-muted">
            Draft
            <select
              value={draftPref}
              onChange={(e) => setDraftPref(e.target.value as (typeof DRAFT_PREFS)[number])}
              className={cn(F, "pr-6")}
            >
              <option value="auto">auto ($schema)</option>
              {DRAFTS.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <button onClick={useInValidator} className={cn(GHOST, "border-accent text-accent")}>
            Use in validator <ArrowRight size={13} />
          </button>
        )}

        {mode === "validate" && (
          <span
            className={cn(
              "ml-auto inline-flex items-center gap-1.5 text-[12.5px] font-medium",
              status.tone === "positive" && "text-positive",
              status.tone === "danger" && "text-danger",
              status.tone === "warn" && "text-warn",
            )}
          >
            {status.tone === "positive" ? <Check size={14} /> : <AlertTriangle size={14} />}
            {status.text}
          </span>
        )}
      </div>

      {note && (
        <div className="panel flex items-start gap-2 border-warn/50 p-3 text-[13px] text-muted">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <span className="flex-1">{note}</span>
          <button onClick={() => setNote(null)} aria-label="Dismiss" className="text-faint hover:text-ink">
            <X size={14} />
          </button>
        </div>
      )}

      {mode === "validate" ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Editor
              label="Schema"
              value={schemaText}
              onChange={setSchemaText}
              placeholder='{ "type": "object", "properties": { … } }'
              footer={report.schema.ok ? "valid JSON" : report.schema.error === "empty" ? "" : report.schema.error}
              footerTone={report.schema.ok ? "muted" : "danger"}
              actions={
                <button onClick={designCurrent} className={GHOST}>
                  <Wand2 size={13} /> Open in designer
                </button>
              }
            />
            <Editor
              label="Data"
              value={dataText}
              onChange={setDataText}
              placeholder="JSON to validate…"
              footer={report.data.ok ? "valid JSON" : report.data.error === "empty" ? "" : report.data.error}
              footerTone={report.data.ok ? "muted" : "danger"}
            />
          </div>

          <div className={cn("panel", report.result && !report.result.valid && "border-danger/40")}>
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Result</span>
              {report.result && (
                <span className="text-[12px] text-faint">
                  validated as {DRAFTS.find((d) => d.id === report.result!.draft)?.label}
                </span>
              )}
            </div>
            <div className="p-3">
              {!report.result ? (
                <p className="text-[13px] text-muted">
                  {schemaErr !== null
                    ? schemaErr === "empty"
                      ? "Paste a JSON Schema on the left."
                      : `Schema: ${schemaErr}`
                    : dataErr === "empty"
                      ? "Paste JSON data on the right."
                      : `Data: ${dataErr}`}
                </p>
              ) : (
                <>
                  {report.result.schemaErrors.length > 0 && (
                    <div className="mb-3">
                      <p className="text-[13px] font-medium text-danger">The schema itself has problems</p>
                      <ul className="mt-1 space-y-1">
                        {report.result.schemaErrors.map((e, i) => (
                          <li key={i} className="font-mono text-[12.5px] text-muted">
                            {e}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {report.result.valid ? (
                    <p className="flex items-center gap-2 text-[13.5px] text-positive">
                      <Check size={15} /> The data is valid against the schema.
                    </p>
                  ) : report.result.issues.length > 0 ? (
                    <ol className="divide-y divide-edge">
                      {report.result.issues.map((it, i) => (
                        <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-[13px]">
                          <code className="shrink-0 font-mono text-[12.5px] text-ink">{it.path}</code>
                          <span className="text-ink">{it.message}</span>
                          <span className="rounded border border-edge px-1 font-mono text-[10.5px] text-muted">
                            {it.keyword}
                          </span>
                          {Object.keys(it.params).length > 0 && (
                            <code className="min-w-0 truncate font-mono text-[11.5px] text-faint" title={it.schemaPath}>
                              {JSON.stringify(it.params)}
                            </code>
                          )}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                </>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          {/* designer */}
          <div className="panel flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <span className="readout">Designer</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <button onClick={() => setSampleOpen((o) => !o)} className={cn(GHOST, sampleOpen && "border-accent text-accent")}>
                  <Wand2 size={13} /> Infer from sample
                </button>
                <button
                  onClick={() => {
                    const n = nodeFromText(schemaText);
                    if (n) {
                      setRoot(n);
                      setNote(null);
                    } else setNote("The validator's schema isn't valid JSON.");
                  }}
                  className={GHOST}
                >
                  Import validator schema
                </button>
                <button onClick={() => setRoot(createNode("object"))} className={GHOST} title="Start over">
                  <RotateCcw size={13} /> Reset
                </button>
              </div>
            </div>

            {sampleOpen && (
              <div className="border-b border-edge bg-base-2 p-3">
                <p className="text-[12.5px] text-muted">
                  Paste a representative JSON value. Types, formats and required keys are inferred; arrays merge their
                  elements.
                </p>
                <textarea
                  value={sampleText}
                  onChange={(e) => setSampleText(e.target.value)}
                  spellCheck={false}
                  placeholder='{ "id": 1, "email": "ada@example.com", "tags": ["a", "b"] }'
                  className="mt-2 min-h-[120px] w-full resize-y rounded-[var(--radius-sm)] border border-edge bg-base p-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent"
                />
                <div className="mt-2 flex items-center gap-2">
                  <button
                    onClick={inferFromSample}
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)]"
                  >
                    <Wand2 size={13} /> Infer schema
                  </button>
                  <span className="text-[12px] text-faint">Replaces the current design.</span>
                </div>
              </div>
            )}

            <div className="min-w-0 overflow-x-auto p-2">
              <NodeRow node={root} depth={0} label="root" patch={patch} />
            </div>
          </div>

          {/* output */}
          <div className="panel flex min-w-0 flex-col">
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Generated schema · 2020-12</span>
              <CopyButton value={outputSchema} />
            </div>
            <textarea value={outputSchema} readOnly spellCheck={false} className={cn(TA, "select-all")} />
            <div className="flex items-center gap-3 border-t border-edge px-3 py-1.5 readout tabular">
              <span>{outputSchema.length.toLocaleString()} ch</span>
              <span className="ml-auto">Unknown keywords from imported schemas are kept as-is.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- text editor */

function Editor({
  label,
  value,
  onChange,
  placeholder,
  footer,
  footerTone,
  actions,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  footer: string;
  footerTone: "muted" | "danger";
  actions?: React.ReactNode;
}) {
  return (
    <div className={cn("panel flex min-w-0 flex-col", footerTone === "danger" && "border-danger/50")}>
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <span className="readout">{label}</span>
        <div className="flex items-center gap-1.5">
          {actions}
          {value && (
            <button onClick={() => onChange("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        className={TA}
      />
      <div className={cn("flex items-center border-t border-edge px-3 py-1.5 readout", footerTone === "danger" && "text-danger")}>
        <span className="truncate">{footer || " "}</span>
        <span className="ml-auto tabular">{value.length.toLocaleString()} ch</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- tree editor */

type Patch = (id: string, fn: (n: SchemaNode) => SchemaNode) => void;

function NodeRow({
  node,
  depth,
  label,
  entry,
  patch,
}: {
  node: SchemaNode;
  depth: number;
  label?: string;
  /** Present when this node is an object property. */
  entry?: { parentId: string; index: number; key: string; required: boolean };
  patch: Patch;
}) {
  const set = (fn: (n: SchemaNode) => SchemaNode) => patch(node.id, fn);
  const setEntry = (fn: (p: { key: string; required: boolean }) => { key: string; required: boolean }) => {
    if (!entry) return;
    patch(entry.parentId, (p) => ({
      ...p,
      properties: p.properties.map((x, i) => (i === entry.index ? { ...x, ...fn({ key: x.key, required: x.required }) } : x)),
    }));
  };
  const changeType = (type: NodeType) =>
    set((n) => ({ ...n, type, items: type === "array" ? (n.items ?? createNode("string")) : n.items }));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 py-1" style={{ paddingLeft: depth * 16 }}>
        {entry ? (
          <>
            <input
              value={entry.key}
              onChange={(e) => setEntry((p) => ({ ...p, key: e.target.value }))}
              placeholder="property"
              spellCheck={false}
              className={cn(F, "w-32")}
            />
            <label className="flex items-center gap-1 text-[11px] text-muted" title="Required">
              <input
                type="checkbox"
                checked={entry.required}
                onChange={(e) => setEntry((p) => ({ ...p, required: e.target.checked }))}
                className="accent-[var(--accent)]"
              />
              req
            </label>
          </>
        ) : (
          <span className="w-12 text-[12px] font-medium text-muted">{label}</span>
        )}

        <select value={node.type} onChange={(e) => changeType(e.target.value as NodeType)} className={cn(F, "pr-6")}>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        {node.type !== "any" && node.type !== "null" && (
          <label className="flex items-center gap-1 text-[11px] text-muted" title="Also allow null">
            <input
              type="checkbox"
              checked={node.nullable}
              onChange={(e) => set((n) => ({ ...n, nullable: e.target.checked }))}
              className="accent-[var(--accent)]"
            />
            null
          </label>
        )}

        {node.type === "string" && (
          <>
            <select value={node.format} onChange={(e) => set((n) => ({ ...n, format: e.target.value }))} className={cn(F, "pr-6")}>
              <option value="">format</option>
              {STRING_FORMATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
            <NumField value={node.minLength} onChange={(v) => set((n) => ({ ...n, minLength: v }))} placeholder="min" title="minLength" />
            <NumField value={node.maxLength} onChange={(v) => set((n) => ({ ...n, maxLength: v }))} placeholder="max" title="maxLength" />
            <input
              value={node.pattern}
              onChange={(e) => set((n) => ({ ...n, pattern: e.target.value }))}
              placeholder="pattern (regex)"
              spellCheck={false}
              className={cn(F, "w-32")}
            />
          </>
        )}
        {(node.type === "number" || node.type === "integer") && (
          <>
            <NumField value={node.minimum} onChange={(v) => set((n) => ({ ...n, minimum: v }))} placeholder="min" title="minimum" />
            <NumField value={node.maximum} onChange={(v) => set((n) => ({ ...n, maximum: v }))} placeholder="max" title="maximum" />
            <NumField value={node.multipleOf} onChange={(v) => set((n) => ({ ...n, multipleOf: v }))} placeholder="×" title="multipleOf" />
          </>
        )}
        {node.type === "array" && (
          <>
            <NumField value={node.minItems} onChange={(v) => set((n) => ({ ...n, minItems: v }))} placeholder="min" title="minItems" />
            <NumField value={node.maxItems} onChange={(v) => set((n) => ({ ...n, maxItems: v }))} placeholder="max" title="maxItems" />
            <label className="flex items-center gap-1 text-[11px] text-muted" title="uniqueItems">
              <input
                type="checkbox"
                checked={node.uniqueItems}
                onChange={(e) => set((n) => ({ ...n, uniqueItems: e.target.checked }))}
                className="accent-[var(--accent)]"
              />
              unique
            </label>
          </>
        )}
        {node.type === "object" && (
          <label className="flex items-center gap-1 text-[11px] text-muted" title="additionalProperties">
            <input
              type="checkbox"
              checked={node.additionalProperties}
              onChange={(e) => set((n) => ({ ...n, additionalProperties: e.target.checked }))}
              className="accent-[var(--accent)]"
            />
            extra keys
          </label>
        )}
        {node.type !== "object" && node.type !== "array" && (
          <input
            value={node.enum}
            onChange={(e) => set((n) => ({ ...n, enum: e.target.value }))}
            placeholder="enum: a, b, 3"
            spellCheck={false}
            className={cn(F, "w-32")}
          />
        )}
        <input
          value={node.description}
          onChange={(e) => set((n) => ({ ...n, description: e.target.value }))}
          placeholder="description"
          className={cn(F, "min-w-[140px] flex-1 font-sans")}
        />
        {entry && (
          <button
            onClick={() => patch(entry.parentId, (p) => ({ ...p, properties: p.properties.filter((_, i) => i !== entry.index) }))}
            aria-label="Remove property"
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-sm)] text-faint hover:bg-raised hover:text-danger"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>

      {node.type === "object" && (
        <div>
          {node.properties.map((p, i) => (
            <NodeRow
              key={p.node.id}
              node={p.node}
              depth={depth + 1}
              entry={{ parentId: node.id, index: i, key: p.key, required: p.required }}
              patch={patch}
            />
          ))}
          <div style={{ paddingLeft: (depth + 1) * 16 }} className="py-1">
            <button
              onClick={() =>
                set((n) => ({ ...n, properties: [...n.properties, { key: "", required: false, node: createNode("string") }] }))
              }
              className="inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[12px] text-accent hover:bg-raised"
            >
              <Plus size={13} /> property
            </button>
          </div>
        </div>
      )}
      {node.type === "array" && node.items && <NodeRow node={node.items} depth={depth + 1} label="items" patch={patch} />}
    </div>
  );
}

function NumField({
  value,
  onChange,
  placeholder,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  title: string;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      title={title}
      inputMode="decimal"
      className={cn(F, "w-14")}
    />
  );
}
