"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";
import { AlertTriangle } from "lucide-react";
import {
  parseCron,
  describeCron,
  nextRuns,
  builderFromParsed,
  buildExpression,
  fieldToText,
  effectiveMax,
  relative,
  isValidTimeZone,
  FIELD_SPECS,
  PRESETS,
  MONTH_NAMES,
  DAY_NAMES,
  type BuilderField,
  type BuilderState,
  type FieldMode,
  type FieldSpec,
} from "@/lib/tools/time/cron";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";
const NUM = "h-7 w-16 rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[13px] text-ink outline-none focus:border-accent";
const DEFAULT_EXPR = "*/5 * * * *";

const MODES: { id: FieldMode; label: string }[] = [
  { id: "every", label: "Every" },
  { id: "specific", label: "Specific" },
  { id: "step", label: "Every n" },
  { id: "range", label: "Range" },
];

function browserZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function zoneList(): string[] {
  const zones = new Set<string>(["UTC"]);
  try {
    for (const z of Intl.supportedValuesOf("timeZone")) zones.add(z);
  } catch {
    /* older browsers: UTC + the browser zone only */
  }
  zones.add(browserZone());
  return [...zones].sort();
}

/** Short value label for the chip grids: month and weekday names, otherwise the number. */
function valueLabel(spec: FieldSpec, v: number): string {
  if (spec.name === "month") return MONTH_NAMES[v - 1].slice(0, 3);
  if (spec.name === "day of week") return DAY_NAMES[v].slice(0, 3);
  return String(v);
}

export function CronWidget() {
  const [expr, setExpr] = useQueryState("e", parseAsString.withDefault(DEFAULT_EXPR).withOptions({ history: "replace", throttleMs: 200 }));
  const [tzParam, setTzParam] = useQueryState("tz", parseAsString.withDefault("").withOptions({ history: "replace" }));
  const [count, setCount] = useQueryState("n", parseAsInteger.withDefault(10).withOptions({ history: "replace" }));
  const [zones] = useState(zoneList);
  const [localZone] = useState(browserZone);
  const [activeField, setActiveField] = useState(0);
  const [now, setNow] = useState(0);

  const tz = tzParam && isValidTimeZone(tzParam) ? tzParam : localZone;

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (active) setNow(Date.now());
    };
    queueMicrotask(tick);
    const id = setInterval(tick, 15000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const parsed = useMemo(() => parseCron(expr), [expr]);
  const description = parsed.ok ? describeCron(parsed) : null;
  const builder = useMemo(() => (parsed.ok ? builderFromParsed(parsed) : null), [parsed]);
  const specs = builder?.seconds ? FIELD_SPECS : FIELD_SPECS.slice(1);
  const runs = useMemo(() => (parsed.ok && now ? nextRuns(parsed, new Date(now), count, tz) : []), [parsed, now, count, tz]);

  const runFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        weekday: "short",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: parsed.ok && parsed.hasSeconds ? "2-digit" : undefined,
        hourCycle: "h23",
      }),
    [tz, parsed],
  );

  const tzOffset = useMemo(() => {
    if (!now) return "";
    try {
      const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "shortOffset" }).formatToParts(new Date(now));
      return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
    } catch {
      return "";
    }
  }, [tz, now]);

  const fieldIndex = Math.min(activeField, specs.length - 1);

  function updateField(i: number, patch: Partial<BuilderField>) {
    if (!builder) return;
    const next: BuilderState = { ...builder, fields: builder.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) };
    setExpr(buildExpression(next));
  }

  function toggleValue(i: number, v: number) {
    if (!builder) return;
    const f = builder.fields[i];
    const values = f.values.includes(v) ? f.values.filter((x) => x !== v) : [...f.values, v];
    updateField(i, { mode: "specific", values: values.length ? values : [v] });
  }

  function toggleSeconds(on: boolean) {
    if (!parsed.ok) return;
    if (on && !parsed.hasSeconds) setExpr(`0 ${parsed.expression}`);
    if (!on && parsed.hasSeconds) setExpr(parsed.expression.split(" ").slice(1).join(" "));
  }

  const errorField = !parsed.ok ? parsed.field : undefined;
  const typedFields = expr.trim().split(/\s+/).filter(Boolean);
  const chipSpecs = typedFields.length === 6 ? FIELD_SPECS : FIELD_SPECS.slice(1);

  return (
    <div className="space-y-3">
      {/* expression */}
      <div className={cn("panel p-3", !parsed.ok && parsed.error !== "empty" && "border-danger/50")}>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="cron-expr" className="readout">
            Expression
          </label>
          <div className="ml-auto flex items-center gap-2">
            <select
              aria-label="Preset"
              value=""
              onChange={(e) => {
                if (e.target.value) setExpr(e.target.value);
              }}
              className={cn(SEL, "max-w-[180px]")}
            >
              <option value="">Presets…</option>
              {PRESETS.map((p) => (
                <option key={p.expression} value={p.expression}>
                  {p.label}
                </option>
              ))}
            </select>
            <CopyButton value={parsed.ok ? parsed.expression : expr} label="Copy" className="h-8 px-3 text-[13px]" />
          </div>
        </div>
        <input
          id="cron-expr"
          value={expr}
          onChange={(e) => setExpr(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="minute hour day month weekday"
          className="mt-2 h-12 w-full rounded-[var(--radius-sm)] border border-edge bg-base px-3 font-mono text-[20px] tracking-wide text-ink outline-none focus:border-accent"
        />

        {/* field chips */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chipSpecs.map((spec, i) => {
            const text = parsed.ok ? parsed.fields[i].text : typedFields[i];
            const bad = errorField === i || (!parsed.ok && text === undefined);
            return (
              <button
                key={spec.name}
                type="button"
                onClick={() => parsed.ok && setActiveField(i)}
                className={cn(
                  "flex min-w-[64px] flex-col items-start rounded-[var(--radius-sm)] border px-2 py-1 text-left transition-colors",
                  bad ? "border-danger/60 bg-danger/5" : parsed.ok && fieldIndex === i ? "border-accent bg-accent-soft" : "border-edge hover:border-edge-bright",
                )}
                title={`Edit ${spec.name} in the builder`}
              >
                <span className={cn("font-mono text-[14px]", bad ? "text-danger" : "text-ink")}>{text ?? "?"}</span>
                <span className="text-[11px] text-faint">{spec.name}</span>
              </button>
            );
          })}
          {parsed.ok && parsed.alias && (
            <span className="self-center text-[12px] text-muted">
              <code className="font-mono">{parsed.alias}</code> = <code className="font-mono">{parsed.expression}</code>
            </span>
          )}
        </div>

        {parsed.ok ? (
          <p className="mt-3 text-[17px] leading-snug text-ink">
            {description}
            <span className="text-muted">.</span>
          </p>
        ) : parsed.error === "empty" ? (
          <p className="mt-3 text-[14px] text-muted">Type a cron expression, or pick a preset.</p>
        ) : (
          <p className="mt-3 flex items-start gap-1.5 text-[14px] text-danger">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {parsed.error}
          </p>
        )}
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {/* builder */}
        <div className="panel flex flex-col p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="readout">Builder</span>
            <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
              <input type="checkbox" checked={!!builder?.seconds} disabled={!builder} onChange={(e) => toggleSeconds(e.target.checked)} className="accent-[var(--accent)]" />
              Seconds field
            </label>
          </div>

          {builder ? (
            <>
              <div className="mt-2 flex flex-wrap gap-1 border-b border-edge pb-2">
                {specs.map((spec, i) => (
                  <button
                    key={spec.name}
                    type="button"
                    onClick={() => setActiveField(i)}
                    className={cn(
                      "h-7 rounded-[var(--radius-sm)] px-2.5 text-[13px] capitalize transition-colors",
                      fieldIndex === i ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-ink",
                    )}
                  >
                    {spec.name}
                  </button>
                ))}
              </div>
              <FieldEditor
                key={`${fieldIndex}-${builder.seconds}`}
                spec={specs[fieldIndex]}
                field={builder.fields[fieldIndex]}
                onChange={(patch) => updateField(fieldIndex, patch)}
                onToggle={(v) => toggleValue(fieldIndex, v)}
              />
            </>
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">Fix the expression above (or pick a preset) to edit it field by field.</p>
          )}

          <details className="mt-auto pt-3 text-[12.5px] text-muted">
            <summary className="cursor-pointer select-none text-faint hover:text-ink">Syntax reference</summary>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="font-mono text-ink">*</dt>
              <dd>any value</dd>
              <dt className="font-mono text-ink">1,15</dt>
              <dd>list of values</dd>
              <dt className="font-mono text-ink">1-5</dt>
              <dd>range (inclusive)</dd>
              <dt className="font-mono text-ink">*/10</dt>
              <dd>every 10th value; also 5/10 (from 5) and 0-30/10</dd>
              <dt className="font-mono text-ink">JAN, MON</dt>
              <dd>month and weekday names; Sunday is 0 or 7</dd>
              <dt className="font-mono text-ink">@daily</dt>
              <dd>@hourly @daily @weekly @monthly @yearly</dd>
            </dl>
            <p className="mt-2">When both day-of-month and day-of-week are set, a day matches when either does.</p>
          </details>
        </div>

        {/* next runs */}
        <div className="panel flex flex-col p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="readout">Next runs</span>
            <div className="ml-auto flex items-center gap-2">
              <select aria-label="Count" value={count} onChange={(e) => setCount(Number(e.target.value))} className={cn(SEL, "h-7 text-[12.5px]")}>
                {[5, 10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <select
                aria-label="Timezone"
                value={tz}
                onChange={(e) => setTzParam(e.target.value === localZone ? null : e.target.value)}
                className={cn(SEL, "h-7 max-w-[200px] text-[12.5px]")}
              >
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z === localZone ? `${z} (local)` : z}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="mt-1 text-[12px] text-faint">
            Evaluated in {tz}
            {tzOffset ? ` (${tzOffset})` : ""}. Daylight-saving gaps are skipped.
          </p>
          {parsed.ok && now ? (
            runs.length ? (
              <ol className="mt-2 divide-y divide-edge font-mono text-[13px]">
                {runs.map((d, i) => (
                  <li key={d.getTime()} className="flex items-baseline gap-3 py-1.5" title={d.toISOString()}>
                    <span className="w-6 shrink-0 text-right text-faint tabular">{i + 1}</span>
                    <span className="text-ink">{runFormat.format(d)}</span>
                    <span className="ml-auto shrink-0 text-muted">{relative(d, now)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 text-[13.5px] text-muted">This never runs in the next eight years — check the day-of-month and month combination.</p>
            )
          ) : (
            <p className="mt-3 text-[13.5px] text-muted">Runs will appear once the expression is valid.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function FieldEditor({
  spec,
  field,
  onChange,
  onToggle,
}: {
  spec: FieldSpec;
  field: BuilderField;
  onChange: (patch: Partial<BuilderField>) => void;
  onToggle: (v: number) => void;
}) {
  const max = effectiveMax(spec);
  const values: number[] = [];
  for (let v = spec.min; v <= max; v++) values.push(v);
  const wide = spec.name === "month" || spec.name === "day of week";
  const preview = fieldToText(field, spec);

  return (
    <div className="mt-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onChange({ mode: m.id })}
              className={cn(
                "h-7 rounded-[3px] px-3 text-[13px] transition-colors",
                field.mode === m.id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <code className="ml-auto rounded-[var(--radius-sm)] bg-raised px-2 py-1 font-mono text-[13px] text-ink">{preview}</code>
      </div>

      {field.mode === "every" && <p className="mt-3 text-[13.5px] text-muted">Every {spec.name}.</p>}

      {field.mode === "specific" && (
        <div className={cn("mt-3 grid gap-1", wide ? "grid-cols-4 sm:grid-cols-6" : "grid-cols-6 sm:grid-cols-10 md:grid-cols-12")}>
          {values.map((v) => {
            const on = field.values.includes(v);
            return (
              <button
                key={v}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(v)}
                className={cn(
                  "h-8 rounded-[var(--radius-sm)] border font-mono text-[12.5px] tabular transition-colors",
                  on ? "border-accent bg-accent text-on-accent" : "border-edge text-muted hover:border-edge-bright hover:text-ink",
                )}
              >
                {valueLabel(spec, v)}
              </button>
            );
          })}
        </div>
      )}

      {field.mode === "step" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
          Every
          <input
            type="number"
            min={1}
            max={max}
            value={field.step}
            onChange={(e) => onChange({ step: Math.max(1, Math.min(max, Number(e.target.value) || 1)) })}
            className={NUM}
            aria-label="Step"
          />
          {spec.name}s, starting at
          <input
            type="number"
            min={spec.min}
            max={max}
            value={field.start}
            onChange={(e) => onChange({ start: Math.max(spec.min, Math.min(max, Number(e.target.value) || spec.min)) })}
            className={NUM}
            aria-label="Start"
          />
        </div>
      )}

      {field.mode === "range" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[13.5px] text-muted">
          From
          <RangeSelect spec={spec} value={field.from} max={max} onChange={(v) => onChange({ from: v })} label="From" />
          through
          <RangeSelect spec={spec} value={field.to} max={max} onChange={(v) => onChange({ to: v })} label="Through" />
          {field.from > field.to && <span className="text-warn">(swapped so the range runs forward)</span>}
        </div>
      )}
    </div>
  );
}

function RangeSelect({ spec, value, max, onChange, label }: { spec: FieldSpec; value: number; max: number; onChange: (v: number) => void; label: string }) {
  const opts: number[] = [];
  for (let v = spec.min; v <= max; v++) opts.push(v);
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))} className={cn(SEL, "h-7 text-[12.5px]")}>
      {opts.map((v) => (
        <option key={v} value={v}>
          {spec.names ? `${v} · ${valueLabel(spec, v)}` : v}
        </option>
      ))}
    </select>
  );
}
