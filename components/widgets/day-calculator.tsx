"use client";

import { useEffect, useState } from "react";
import { useQueryState, parseAsString, parseAsStringEnum } from "nuqs";
import { cn } from "@/lib/utils";
import {
  parseDay,
  computeBetween,
  addToDate,
  computeAge,
  toISODate,
  humanDate,
  type DayMode,
  type AddUnit,
} from "@/lib/tools/time/day-math";
import { CopyButton } from "@/components/copy-button";

const MODES: { id: DayMode; label: string }[] = [
  { id: "between", label: "Between" },
  { id: "add", label: "Add / Subtract" },
  { id: "age", label: "Age" },
];

const UNITS: AddUnit[] = ["days", "weeks", "months", "years"];

export function DayCalculatorWidget() {
  const [mode, setMode] = useQueryState(
    "m",
    parseAsStringEnum<DayMode>(["between", "add", "age"])
      .withDefault("between")
      .withOptions({ history: "replace" }),
  );
  const [a, setA] = useQueryState(
    "a",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );
  const [b, setB] = useQueryState(
    "b",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
  );

  const [amount, setAmount] = useState("30");
  const [unit, setUnit] = useState<AddUnit>("days");

  // Live "now" for the Age mode countdown.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateA = parseDay(a);
  const dateB = parseDay(b);

  return (
    <div className="space-y-3">
      {/* mode segmented control */}
      <div className="panel registered flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "rounded-[3px] px-3 py-1.5 font-mono text-xs transition-colors",
                mode === m.id
                  ? "bg-accent text-on-accent font-semibold"
                  : "text-muted hover:text-ink",
              )}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="ml-auto">
        </div>
      </div>

      {mode === "between" && (
        <BetweenPanel a={a} b={b} setA={setA} setB={setB} dateA={dateA} dateB={dateB} />
      )}

      {mode === "add" && (
        <AddPanel
          a={a}
          setA={setA}
          dateA={dateA}
          amount={amount}
          setAmount={setAmount}
          unit={unit}
          setUnit={setUnit}
        />
      )}

      {mode === "age" && <AgePanel a={a} setA={setA} dateA={dateA} now={now} />}
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="readout">{label}</span>
      <input
        type="date"
        value={/^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
        onChange={(e) => onChange(e.target.value)}
        className="input mt-1.5"
      />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "yyyy-mm-dd"}
        spellCheck={false}
        className="input mt-1.5"
      />
    </label>
  );
}

function Row({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <span className="readout w-36 shrink-0">{label}</span>
      <code className="flex-1 truncate font-mono text-[13px] tabular text-ink">{value}</code>
      {copy && <CopyButton value={value} label="" className="shrink-0" />}
    </div>
  );
}

function BetweenPanel({
  a,
  b,
  setA,
  setB,
  dateA,
  dateB,
}: {
  a: string;
  b: string;
  setA: (v: string) => void;
  setB: (v: string) => void;
  dateA: Date | null;
  dateB: Date | null;
}) {
  const result = dateA && dateB ? computeBetween(dateA, dateB) : null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <DateField label="From" value={a} onChange={setA} />
        <DateField label="To" value={b} onChange={setB} />
      </div>
      <div className="panel">
        <div className="border-b border-edge px-3 py-2">
          <span className="readout">Difference</span>
        </div>
        {result ? (
          <div className="divide-y divide-edge">
            <Row label="Total days" value={String(result.totalDays)} copy />
            <Row
              label="Weeks + days"
              value={`${result.weeksDays.weeks}w ${result.weeksDays.days}d`}
            />
            <Row label="Months" value={String(result.months)} />
            <Row
              label="Years / months / days"
              value={`${result.ymd.years}y ${result.ymd.months}m ${result.ymd.days}d`}
            />
            <Row label="Business days" value={String(result.businessDays)} copy />
            <Row label="Direction" value={result.forward ? "From → To (forward)" : "From → To (backward)"} />
          </div>
        ) : (
          <p className="px-3 py-6 text-center font-mono text-xs text-faint">
            Enter two valid dates.
          </p>
        )}
      </div>
    </div>
  );
}

function AddPanel({
  a,
  setA,
  dateA,
  amount,
  setAmount,
  unit,
  setUnit,
}: {
  a: string;
  setA: (v: string) => void;
  dateA: Date | null;
  amount: string;
  setAmount: (v: string) => void;
  unit: AddUnit;
  setUnit: (v: AddUnit) => void;
}) {
  const amt = Number(amount);
  const valid = dateA && Number.isFinite(amt);
  const result = valid ? addToDate(dateA, amt, unit) : null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <DateField label="Start date" value={a} onChange={setA} />
        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="readout">Amount</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. -14"
              className="input mt-1.5"
            />
          </label>
          <label className="block">
            <span className="readout">Unit</span>
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as AddUnit)}
              className="input mt-1.5"
            >
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="panel">
        <div className="border-b border-edge px-3 py-2">
          <span className="readout">Result</span>
        </div>
        {result ? (
          <div className="divide-y divide-edge">
            <Row label="ISO date" value={toISODate(result)} copy />
            <Row label="Human" value={humanDate(result)} copy />
            <Row
              label="Weekday"
              value={result.toLocaleDateString("en-US", { weekday: "long" })}
            />
          </div>
        ) : (
          <p className="px-3 py-6 text-center font-mono text-xs text-faint">
            Enter a start date and a numeric amount.
          </p>
        )}
      </div>
    </div>
  );
}

function AgePanel({
  a,
  setA,
  dateA,
  now,
}: {
  a: string;
  setA: (v: string) => void;
  dateA: Date | null;
  now: number;
}) {
  const result = dateA ? computeAge(dateA, new Date(now)) : null;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="panel space-y-3 p-3">
        <DateField label="Birthdate" value={a} onChange={setA} />
      </div>
      <div className="panel">
        <div className="border-b border-edge px-3 py-2">
          <span className="readout">Age</span>
        </div>
        {result ? (
          <div className="divide-y divide-edge">
            <Row
              label="Age"
              value={`${result.ymd.years}y ${result.ymd.months}m ${result.ymd.days}d`}
              copy
            />
            <Row label="Total days lived" value={String(result.totalDays)} copy />
            <Row
              label="Next birthday in"
              value={
                result.nextBirthdayDays === 0
                  ? "today 🎉"
                  : `${result.nextBirthdayDays} day${result.nextBirthdayDays === 1 ? "" : "s"}`
              }
            />
            <Row label="Next birthday" value={result.nextBirthdayDate} />
          </div>
        ) : (
          <p className="px-3 py-6 text-center font-mono text-xs text-faint">
            Enter a birthdate.
          </p>
        )}
      </div>
    </div>
  );
}
