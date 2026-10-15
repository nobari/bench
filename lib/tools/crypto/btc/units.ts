/** Amounts: satoshis are the unit of record (bigint); BTC and fiat are views of them. */
export type Unit = "btc" | "sats";
export const SATS_PER_BTC = 100_000_000n;
export const FIAT_CURRENCIES = ["usd", "eur", "jpy", "gbp"] as const;
export type Fiat = (typeof FIAT_CURRENCIES)[number];

/** "0.00123456 BTC" or "123,456 sats". */
export function formatAmount(sats: bigint | number, unit: Unit, withUnit = true): string {
  const n = BigInt(sats);
  if (unit === "sats") return `${n.toLocaleString("en-US")}${withUnit ? " sats" : ""}`;
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const whole = abs / SATS_PER_BTC;
  const frac = (abs % SATS_PER_BTC).toString().padStart(8, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}${withUnit ? " BTC" : ""}`;
}

/** Parses what the user typed in the given unit; null when it is not a non-negative amount. */
export function parseAmount(text: string, unit: Unit): bigint | null {
  const t = text.trim().replace(/[,_\s]/g, "");
  if (!t) return null;
  if (unit === "sats") return /^\d+$/.test(t) ? BigInt(t) : null;
  const m = /^(\d*)(?:\.(\d{0,8}))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) return null;
  return BigInt(m[1] || "0") * SATS_PER_BTC + BigInt((m[2] ?? "").padEnd(8, "0"));
}

/** Fiat value of an amount at a BTC price. */
export function fiatValue(sats: bigint | number, pricePerBtc: number): number {
  return (Number(sats) / 1e8) * pricePerBtc;
}

export function formatFiat(value: number, currency: Fiat): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase(), maximumFractionDigits: currency === "jpy" ? 0 : 2 }).format(value);
}

/** sat/vB with one decimal when it helps. */
export const formatRate = (satPerVb: number) => (satPerVb >= 10 ? Math.round(satPerVb).toString() : (Math.round(satPerVb * 10) / 10).toString()) + " sat/vB";
