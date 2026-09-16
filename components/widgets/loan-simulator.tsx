"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsString, parseAsStringEnum } from "nuqs";
import { ChevronRight, TrendingDown } from "lucide-react";
import { computeLoan, type AmortizationRow, type RepaymentType } from "@/lib/tools/math/loan";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ currency */

const CURRENCIES = [
  "USD", "EUR", "GBP", "JPY", "CNY", "INR", "CAD", "AUD", "CHF", "HKD",
  "SGD", "SEK", "NOK", "DKK", "NZD", "MXN", "BRL", "ZAR", "RUB", "KRW",
  "TRY", "AED", "SAR", "PLN",
] as const;

type Currency = (typeof CURRENCIES)[number];

type TermUnit = "y" | "m";

/* Currencies that conventionally have no minor unit. */
const ZERO_DECIMAL = new Set<Currency>(["JPY", "KRW"]);

/* Repayment structures. Default "annuity" keeps the standard amortizing loan. */
const REPAYMENTS: { value: RepaymentType; label: string; hint: string }[] = [
  { value: "annuity", label: "Equal payment (annuity)", hint: "Fixed monthly payment — principal + interest." },
  { value: "equal-principal", label: "Equal principal", hint: "Fixed principal each month; payment declines over time." },
  { value: "interest-only", label: "Interest-only (balloon)", hint: "Pay only interest; full principal due at the end." },
];

/* --------------------------------------------------------------- date helper */

/** Add `months` to a "YYYY-MM" string → "Mon YYYY". Pure. */
function labelForMonth(start: string | null, monthIndex: number): string | null {
  if (!start) return null;
  const m = /^(\d{4})-(\d{2})/.exec(start);
  if (!m) return null;
  const baseYear = Number(m[1]);
  const baseMonth0 = Number(m[2]) - 1; // 0-based
  if (!Number.isFinite(baseYear) || baseMonth0 < 0 || baseMonth0 > 11) return null;
  const total = baseYear * 12 + baseMonth0 + (monthIndex - 1);
  const year = Math.floor(total / 12);
  const month0 = ((total % 12) + 12) % 12;
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${MON[month0]} ${year}`;
}

/* =========================================================================== */

export function LoanSimulatorWidget() {
  const [priceStr, setPrice] = useQueryState(
    "p",
    parseAsString.withDefault("300000").withOptions({ history: "replace", throttleMs: 250 }),
  );
  const [rateStr, setRate] = useQueryState(
    "r",
    parseAsString.withDefault("6.5").withOptions({ history: "replace", throttleMs: 250 }),
  );
  const [termStr, setTerm] = useQueryState(
    "y",
    parseAsString.withDefault("30").withOptions({ history: "replace", throttleMs: 250 }),
  );
  const [unit, setUnit] = useQueryState(
    "u",
    parseAsStringEnum<TermUnit>(["y", "m"]).withDefault("y").withOptions({ history: "replace" }),
  );
  const [currency, setCurrency] = useQueryState(
    "cur",
    parseAsStringEnum<Currency>([...CURRENCIES]).withDefault("USD").withOptions({ history: "replace" }),
  );
  const [downStr, setDown] = useQueryState(
    "dp",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 250 }),
  );
  const [extraStr, setExtra] = useQueryState(
    "extra",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 250 }),
  );
  const [startDate, setStartDate] = useQueryState(
    "start",
    parseAsString.withDefault("").withOptions({ history: "replace" }),
  );
  const [repayment, setRepayment] = useQueryState(
    "rt",
    parseAsStringEnum<RepaymentType>(["annuity", "equal-principal", "interest-only"])
      .withDefault("annuity")
      .withOptions({ history: "replace" }),
  );
  const [ioStr, setIo] = useQueryState(
    "io",
    parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 250 }),
  );

  /* ------------------------------------------------------------- derived nums */

  const price = Number(priceStr) || 0;
  const rate = Number(rateStr) || 0;
  const down = Math.max(0, Math.min(price, Number(downStr) || 0));
  const extra = Math.max(0, Number(extraStr) || 0);
  const principal = Math.max(0, price - down);
  const termValue = Math.max(1, Math.floor(Number(termStr) || 0));
  const termMonths = unit === "y" ? termValue * 12 : termValue;
  const downPct = price > 0 ? (down / price) * 100 : 0;
  const interestOnlyMonths =
    repayment === "annuity" ? Math.max(0, Math.floor(Number(ioStr) || 0)) : 0;

  /* PURE: both schedules derive only from inputs — safe in useMemo. */
  const baseline = useMemo(
    () => computeLoan({ principal, annualRatePercent: rate, termMonths, repayment, interestOnlyMonths }),
    [principal, rate, termMonths, repayment, interestOnlyMonths],
  );
  const accelerated = useMemo(
    () => computeLoan({ principal, annualRatePercent: rate, termMonths, extraMonthly: extra, repayment, interestOnlyMonths }),
    [principal, rate, termMonths, extra, repayment, interestOnlyMonths],
  );

  const hasExtra = extra > 0 && accelerated.payoffMonths < baseline.payoffMonths;
  const active = hasExtra ? accelerated : baseline;

  const monthsSaved = baseline.payoffMonths - accelerated.payoffMonths;
  const interestSaved = baseline.totalInterest - accelerated.totalInterest;

  const { monthlyPayment, finalPayment, paymentVaries, totalPaid, totalInterest, schedule } = active;
  const interestPct = totalPaid > 0 ? (totalInterest / totalPaid) * 100 : 0;
  const principalPct = 100 - interestPct;
  const totalCost = totalPaid + down;
  const payoffLabel = labelForMonth(startDate || null, active.payoffMonths);

  /* --------------------------------------------------------------- formatting */

  const fmt = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: ZERO_DECIMAL.has(currency) ? 0 : 2,
      }),
    [currency],
  );
  const fmt0 = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }),
    [currency],
  );
  const money = (n: number) => fmt.format(Number.isFinite(n) ? n : 0);
  const money0 = (n: number) => fmt0.format(Number.isFinite(n) ? n : 0);
  const plain = (n: number) => (Number.isFinite(n) ? n : 0).toFixed(2);

  const paymentNote =
    repayment === "interest-only"
      ? `Interest-only — balloon of ${money(finalPayment)} due at payoff.`
      : repayment === "equal-principal"
        ? `Declining payments — final payment ${money(finalPayment)}.`
        : interestOnlyMonths > 0
          ? `First ${interestOnlyMonths} months interest-only, then ${money(schedule[interestOnlyMonths]?.payment ?? monthlyPayment)}/mo.`
          : "";

  /* Group the schedule by year for the collapsible table. PURE. */
  const yearGroups = useMemo(() => groupByYear(schedule), [schedule]);

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]">
      {/* ----------------------------------------------------------- inputs */}
      <div className="panel registered space-y-5 p-4">
        <div className="flex items-center justify-between">
          <span className="readout">Loan terms</span>
        </div>

        {/* price */}
        <Field
          label="Price / amount"
          readout={money0(price)}
        >
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1000}
            value={priceStr}
            onChange={(e) => setPrice(e.target.value)}
            spellCheck={false}
            className="input tabular"
            placeholder="300000"
          />
          <input
            type="range"
            min={1000}
            max={2000000}
            step={1000}
            value={Math.min(2000000, Math.max(1000, price))}
            onChange={(e) => setPrice(e.target.value)}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
        </Field>

        {/* down payment */}
        <Field
          label="Down payment"
          readout={down > 0 ? `${money0(down)} · ${downPct.toFixed(1)}%` : "optional"}
        >
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={1000}
            value={downStr}
            onChange={(e) => setDown(e.target.value)}
            spellCheck={false}
            className="input tabular"
            placeholder="0"
          />
          <input
            type="range"
            min={0}
            max={Math.max(1000, price)}
            step={1000}
            value={Math.min(price, Math.max(0, down))}
            onChange={(e) => setDown(e.target.value)}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
          <p className="font-mono text-[11px] text-faint">
            Financed principal: <span className="tabular text-muted">{money0(principal)}</span>
          </p>
        </Field>

        {/* interest rate */}
        <Field label="Annual rate" readout={`${rate}%`}>
          <input
            type="number"
            inputMode="decimal"
            min={0}
            max={100}
            step={0.05}
            value={rateStr}
            onChange={(e) => setRate(e.target.value)}
            spellCheck={false}
            className="input tabular"
            placeholder="6.5"
          />
          <input
            type="range"
            min={0}
            max={20}
            step={0.05}
            value={Math.min(20, Math.max(0, rate))}
            onChange={(e) => setRate(e.target.value)}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
        </Field>

        {/* term + unit */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="readout">Term</span>
            <span className="font-mono text-xs tabular text-muted">
              {termMonths} mo · {(termMonths / 12).toFixed(termMonths % 12 === 0 ? 0 : 1)} yr
            </span>
          </div>
          <div className="flex gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={termStr}
              onChange={(e) => setTerm(e.target.value)}
              spellCheck={false}
              className="input tabular"
              placeholder={unit === "y" ? "30" : "360"}
            />
            <div className="flex shrink-0 rounded-[var(--radius-sm)] border border-edge p-0.5">
              {(["y", "m"] as TermUnit[]).map((u) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => setUnit(u)}
                  className={cn(
                    "h-7 w-12 rounded-[3px] font-mono text-xs transition-colors",
                    unit === u ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
                  )}
                >
                  {u === "y" ? "Years" : "Mo"}
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min={1}
            max={unit === "y" ? 40 : 480}
            step={1}
            value={Math.min(unit === "y" ? 40 : 480, Math.max(1, termValue))}
            onChange={(e) => setTerm(e.target.value)}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
          />
        </div>

        {/* repayment type */}
        <div className="space-y-2">
          <span className="readout">Repayment type</span>
          <select
            value={repayment}
            onChange={(e) => setRepayment(e.target.value as RepaymentType)}
            className="input"
          >
            {REPAYMENTS.map((rp) => (
              <option key={rp.value} value={rp.value}>{rp.label}</option>
            ))}
          </select>
          <p className="font-mono text-[11px] text-faint">
            {REPAYMENTS.find((rp) => rp.value === repayment)?.hint}
          </p>
          {repayment === "annuity" && (
            <Field
              label="Pay interest only, first"
              readout={interestOnlyMonths > 0 ? `${interestOnlyMonths} mo` : "off"}
            >
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={Math.max(0, termMonths - 1)}
                step={1}
                value={ioStr}
                onChange={(e) => setIo(e.target.value)}
                spellCheck={false}
                className="input tabular"
                placeholder="0"
              />
            </Field>
          )}
        </div>

        {/* extra monthly */}
        <Field
          label="Extra monthly"
          readout={extra > 0 ? `+${money0(extra)}/mo` : "optional"}
        >
          <input
            type="number"
            inputMode="decimal"
            min={0}
            step={50}
            value={extraStr}
            onChange={(e) => setExtra(e.target.value)}
            spellCheck={false}
            className="input tabular"
            placeholder="0"
          />
        </Field>

        {/* currency + start date */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <span className="readout">Currency</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value as Currency)}
              className="input"
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <StartDateField value={startDate} onChange={setStartDate} />
        </div>
      </div>

      {/* ---------------------------------------------------------- results */}
      <div className="space-y-3">
        {/* big readouts */}
        <div className="panel registered p-4">
          <div className="flex flex-col gap-1">
            <span className="readout">
              {paymentVaries ? "First payment" : "Monthly payment"}{hasExtra && " · base"}
            </span>
            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-3xl font-semibold tabular text-accent glow sm:text-4xl">
                {money(monthlyPayment)}
              </span>
              <CopyButton value={plain(monthlyPayment)} label="" className="shrink-0" />
            </div>
            {paymentNote && (
              <p className="font-mono text-[11px] text-muted">{paymentNote}</p>
            )}
            {hasExtra && (
              <p className="font-mono text-[11px] text-muted">
                Paying <span className="tabular text-ink">{money(monthlyPayment + extra)}</span>/mo with the extra.
              </p>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Total interest" value={money(totalInterest)} copy={plain(totalInterest)} tone="warn" />
            <Stat label="Total paid" value={money(totalPaid)} copy={plain(totalPaid)} />
            <Stat label="Total cost" value={money(totalCost)} copy={plain(totalCost)} hint="incl. down" />
            <Stat
              label="Payoff"
              value={payoffLabel ?? `${active.payoffMonths} mo`}
              copy={payoffLabel ?? String(active.payoffMonths)}
            />
          </div>

          {/* split bar: principal vs interest */}
          {totalPaid > 0 && (
            <div className="mt-4 space-y-2">
              <div className="flex h-3 overflow-hidden rounded-full bg-raised">
                <div
                  className="bg-accent"
                  style={{ width: `${principalPct}%` }}
                  title={`Principal ${principalPct.toFixed(1)}%`}
                />
                <div
                  className="bg-faint"
                  style={{ width: `${interestPct}%` }}
                  title={`Interest ${interestPct.toFixed(1)}%`}
                />
              </div>
              <div className="flex items-center justify-between font-mono text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-accent" />
                  Principal {principalPct.toFixed(1)}%
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-faint" />
                  Interest {interestPct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </div>

        {/* prepayment savings */}
        {hasExtra && (
          <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 p-3">
            <span className="inline-flex items-center gap-1.5 text-positive">
              <TrendingDown size={15} />
              <span className="readout text-positive">Prepayment</span>
            </span>
            <Savings label="Time saved" value={formatMonths(monthsSaved)} />
            <Savings label="Interest saved" value={money(interestSaved)} tone="positive" />
            <Savings
              label="Payoff"
              value={
                payoffLabel
                  ? `${payoffLabel} vs ${labelForMonth(startDate || null, baseline.payoffMonths) ?? `${baseline.payoffMonths} mo`}`
                  : `${active.payoffMonths} vs ${baseline.payoffMonths} mo`
              }
            />
          </div>
        )}

        {/* balance chart */}
        {schedule.length > 1 && (
          <BalanceChart schedule={schedule} principal={principal} money={money0} />
        )}

        {/* amortization schedule — grouped by year */}
        <div className="panel">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">
              Amortization · {schedule.length} payments
              {yearGroups.length > 0 && ` · ${yearGroups.length} yr`}
            </span>
          </div>
          {yearGroups.length > 0 ? (
            <div className="max-h-[440px] overflow-auto">
              <table className="w-full border-collapse text-right font-mono text-[12px] tabular">
                <thead className="sticky top-0 z-10 bg-surface">
                  <tr className="text-faint">
                    <th className="px-3 py-2 text-left font-normal">
                      <span className="readout">Period</span>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <span className="readout">Principal</span>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <span className="readout">Interest</span>
                    </th>
                    <th className="px-3 py-2 font-normal">
                      <span className="readout">Balance</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {yearGroups.map((g) => (
                    <YearRow
                      key={g.year}
                      group={g}
                      money={money}
                      startDate={startDate || null}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-8 text-center font-mono text-xs text-faint">
              Enter a loan amount and term to see the schedule.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ============================================================ schedule groups */

interface YearGroup {
  year: number;
  rows: AmortizationRow[];
  principalPaid: number;
  interestPaid: number;
  endBalance: number;
}

function groupByYear(schedule: AmortizationRow[]): YearGroup[] {
  const groups: YearGroup[] = [];
  for (const row of schedule) {
    const year = Math.ceil(row.month / 12);
    let g = groups[groups.length - 1];
    if (!g || g.year !== year) {
      g = { year, rows: [], principalPaid: 0, interestPaid: 0, endBalance: 0 };
      groups.push(g);
    }
    g.rows.push(row);
    g.principalPaid += row.principal;
    g.interestPaid += row.interest;
    g.endBalance = row.balance;
  }
  return groups;
}

function YearRow({
  group,
  money,
  startDate,
}: {
  group: YearGroup;
  money: (n: number) => string;
  startDate: string | null;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-t border-edge text-ink hover:bg-raised/50"
      >
        <td className="px-3 py-2 text-left">
          <span className="inline-flex items-center gap-1.5">
            <ChevronRight
              size={13}
              className={cn("text-faint transition-transform", open && "rotate-90")}
            />
            <span className="readout text-ink">Year {group.year}</span>
          </span>
        </td>
        <td className="px-3 py-2 text-accent">{money(group.principalPaid)}</td>
        <td className="px-3 py-2 text-warn">{money(group.interestPaid)}</td>
        <td className="px-3 py-2">{money(group.endBalance)}</td>
      </tr>
      {open &&
        group.rows.map((row) => {
          const label = labelForMonth(startDate, row.month);
          return (
            <tr key={row.month} className="border-t border-edge/60 bg-base/40 text-muted">
              <td className="px-3 py-1.5 pl-9 text-left text-faint">
                {label ?? `Mo ${row.month}`}
              </td>
              <td className="px-3 py-1.5">{money(row.principal)}</td>
              <td className="px-3 py-1.5 text-warn/80">{money(row.interest)}</td>
              <td className="px-3 py-1.5 text-ink">{money(row.balance)}</td>
            </tr>
          );
        })}
    </>
  );
}

/* =================================================================== chart */

function BalanceChart({
  schedule,
  principal,
  money,
}: {
  schedule: AmortizationRow[];
  principal: number;
  money: (n: number) => string;
}) {
  const W = 720;
  const H = 200;
  const padL = 8;
  const padR = 8;
  const padT = 12;
  const padB = 18;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;

  const n = schedule.length;
  const maxBal = principal > 0 ? principal : 1;

  const x = (i: number) => padL + (innerW * i) / Math.max(1, n);
  const y = (bal: number) => padT + innerH * (1 - bal / maxBal);

  // Remaining-balance line: start at full principal (point 0), then each row.
  const pts: [number, number][] = [[x(0), y(principal)]];
  schedule.forEach((row, i) => pts.push([x(i + 1), y(row.balance)]));

  const linePath = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${pts[pts.length - 1][0].toFixed(1)} ${(padT + innerH).toFixed(1)} L${padL} ${(padT + innerH).toFixed(1)} Z`;

  // Cumulative interest line (as fraction of total of the same axis).
  let cumInterest = 0;
  const totalInterest = schedule.reduce((s, r) => s + r.interest, 0) || 1;
  const intPts: [number, number][] = [[x(0), padT + innerH]];
  schedule.forEach((row, i) => {
    cumInterest += row.interest;
    intPts.push([x(i + 1), padT + innerH * (1 - cumInterest / totalInterest)]);
  });
  const intPath = intPts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  // Horizontal grid lines at 0/25/50/75/100% of principal.
  const grids = [0, 0.25, 0.5, 0.75, 1];

  return (
    <div className="panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="readout">Remaining balance over time</span>
        <span className="inline-flex items-center gap-3 font-mono text-[10px] text-muted">
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-accent" /> Balance
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-warn" /> Interest paid
          </span>
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="h-44 w-full"
        role="img"
        aria-label="Loan remaining balance over time"
      >
        <defs>
          <linearGradient id="loan-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {grids.map((g) => {
          const gy = padT + innerH * g;
          return (
            <g key={g}>
              <line
                x1={padL}
                x2={W - padR}
                y1={gy}
                y2={gy}
                stroke="var(--color-edge)"
                strokeWidth={1}
                strokeDasharray={g === 1 ? "0" : "2 4"}
              />
              <text
                x={padL + 2}
                y={gy - 3}
                className="fill-[var(--color-faint)] font-mono"
                fontSize={9}
              >
                {money(maxBal * (1 - g))}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#loan-area)" />
        <path d={intPath} fill="none" stroke="var(--color-warn)" strokeWidth={1.5} strokeOpacity={0.8} />
        <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth={2} />
      </svg>
    </div>
  );
}

/* ============================================================ small controls */

function Field({
  label,
  readout,
  children,
}: {
  label: string;
  readout: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="readout">{label}</span>
        <span className="font-mono text-xs tabular text-muted">{readout}</span>
      </div>
      {children}
    </div>
  );
}

/** Start-date input. Reads "today" only in an event handler / deferred effect. */
function StartDateField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [thisMonth, setThisMonth] = useState("");

  // Deferred (post-render) read of the current month so the "Today" shortcut
  // doesn't call Date during render.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const d = new Date();
      setThisMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="readout">Start date</span>
        {thisMonth && (
          <button
            type="button"
            onClick={() => onChange(thisMonth)}
            className="font-mono text-[10px] text-faint hover:text-accent"
          >
            today
          </button>
        )}
      </div>
      {/* No max: past or future start dates are both allowed. */}
      <input
        type="month"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input"
      />
    </div>
  );
}

function Stat({
  label,
  value,
  copy,
  tone,
  hint,
}: {
  label: string;
  value: string;
  copy: string;
  tone?: "warn";
  hint?: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-edge bg-base p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="readout truncate">{label}</span>
        <CopyButton value={copy} label="" className="h-6 shrink-0 px-1.5" />
      </div>
      <p
        className={cn(
          "mt-1 font-mono text-base font-semibold tabular text-ink sm:text-lg",
          tone === "warn" && "text-warn",
        )}
      >
        {value}
      </p>
      {hint && <p className="font-mono text-[10px] text-faint">{hint}</p>}
    </div>
  );
}

function Savings({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "positive";
}) {
  return (
    <div className="flex flex-col">
      <span className="readout text-[10px]">{label}</span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular text-ink",
          tone === "positive" && "text-positive",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatMonths(months: number): string {
  if (months <= 0) return "—";
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m} mo`;
  if (m === 0) return `${y} yr`;
  return `${y} yr ${m} mo`;
}
