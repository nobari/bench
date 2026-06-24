/**
 * Unit conversion for the Unit Converter.
 *
 * Pure & deterministic — given the same inputs it always returns the same
 * result, which is what makes results shareable via the URL. SSR-safe: no
 * `window`/`document`/`Date`/`Math.random` at module scope or in the functions.
 *
 * Most categories convert through a single base unit: each unit declares a
 * `factor` such that `value_in_base = value * factor`. Converting from unit A to
 * unit B is therefore `value * A.factor / B.factor`. Temperature is the
 * exception (its scales have offsets, not just factors) and is special-cased.
 */

export interface UnitDef {
  /** Stable key used in the URL (`from` param) and as a map key. */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Multiplier to the category's base unit (ignored for temperature). */
  factor: number;
}

export interface CategoryDef {
  /** Stable key used in the URL (`cat` param). */
  key: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Units in display order; the first is conventionally the base unit. */
  units: UnitDef[];
  /** Default from-unit key. */
  defaultFrom: string;
}

/* ------------------------------------------------------------------ helpers */

const u = (key: string, label: string, factor: number): UnitDef => ({
  key,
  label,
  factor,
});

/* ----------------------------------------------------------------- temperature */

/** Convert a temperature `value` from unit `from` to unit `to` (keys C/F/K). */
export function convertTemperature(value: number, from: string, to: string): number {
  if (from === to) return value;
  // Normalize to Celsius first.
  let c: number;
  switch (from) {
    case "C":
      c = value;
      break;
    case "F":
      c = (value - 32) * (5 / 9);
      break;
    case "K":
      c = value - 273.15;
      break;
    default:
      c = value;
  }
  // Then Celsius to target.
  switch (to) {
    case "C":
      return c;
    case "F":
      return c * (9 / 5) + 32;
    case "K":
      return c + 273.15;
    default:
      return c;
  }
}

/* ------------------------------------------------------------------ categories */

export const CATEGORIES: CategoryDef[] = [
  {
    key: "length",
    label: "Length",
    defaultFrom: "m",
    units: [
      u("m", "Meter (m)", 1),
      u("km", "Kilometer (km)", 1000),
      u("cm", "Centimeter (cm)", 0.01),
      u("mm", "Millimeter (mm)", 0.001),
      u("mi", "Mile (mi)", 1609.344),
      u("yd", "Yard (yd)", 0.9144),
      u("ft", "Foot (ft)", 0.3048),
      u("in", "Inch (in)", 0.0254),
      u("nmi", "Nautical mile (nmi)", 1852),
    ],
  },
  {
    key: "mass",
    label: "Mass",
    defaultFrom: "kg",
    units: [
      u("kg", "Kilogram (kg)", 1),
      u("g", "Gram (g)", 0.001),
      u("mg", "Milligram (mg)", 0.000001),
      u("t", "Tonne (t)", 1000),
      u("lb", "Pound (lb)", 0.45359237),
      u("oz", "Ounce (oz)", 0.028349523125),
      u("st", "Stone (st)", 6.35029318),
    ],
  },
  {
    key: "temperature",
    label: "Temperature",
    defaultFrom: "C",
    units: [
      // factor is unused for temperature; conversion is special-cased.
      u("C", "Celsius (°C)", 1),
      u("F", "Fahrenheit (°F)", 1),
      u("K", "Kelvin (K)", 1),
    ],
  },
  {
    key: "area",
    label: "Area",
    defaultFrom: "m2",
    units: [
      u("m2", "Square meter (m²)", 1),
      u("km2", "Square kilometer (km²)", 1_000_000),
      u("ha", "Hectare (ha)", 10_000),
      u("ft2", "Square foot (ft²)", 0.09290304),
      u("ac", "Acre (ac)", 4046.8564224),
      u("mi2", "Square mile (mi²)", 2_589_988.110336),
    ],
  },
  {
    key: "volume",
    label: "Volume",
    defaultFrom: "l",
    units: [
      u("l", "Liter (l)", 1),
      u("ml", "Milliliter (ml)", 0.001),
      u("m3", "Cubic meter (m³)", 1000),
      u("gal", "Gallon — US (gal)", 3.785411784),
      u("qt", "Quart — US (qt)", 0.946352946),
      u("pt", "Pint — US (pt)", 0.473176473),
      u("cup", "Cup — US (cup)", 0.2365882365),
      u("floz", "Fluid ounce — US (fl oz)", 0.0295735295625),
    ],
  },
  {
    key: "speed",
    label: "Speed",
    defaultFrom: "m_s",
    units: [
      u("m_s", "Meter/second (m/s)", 1),
      u("km_h", "Kilometer/hour (km/h)", 1 / 3.6),
      u("mph", "Mile/hour (mph)", 0.44704),
      u("knot", "Knot (kn)", 0.514444444444),
      u("ft_s", "Foot/second (ft/s)", 0.3048),
    ],
  },
  {
    key: "time",
    label: "Time",
    defaultFrom: "s",
    units: [
      u("s", "Second (s)", 1),
      u("ms", "Millisecond (ms)", 0.001),
      u("min", "Minute (min)", 60),
      u("h", "Hour (h)", 3600),
      u("day", "Day (d)", 86_400),
      u("week", "Week (wk)", 604_800),
    ],
  },
  {
    key: "digital",
    label: "Digital",
    defaultFrom: "MB",
    units: [
      u("B", "Byte (B)", 1),
      u("KB", "Kilobyte (KB)", 1_000),
      u("MB", "Megabyte (MB)", 1_000_000),
      u("GB", "Gigabyte (GB)", 1_000_000_000),
      u("TB", "Terabyte (TB)", 1_000_000_000_000),
      u("KiB", "Kibibyte (KiB)", 1024),
      u("MiB", "Mebibyte (MiB)", 1024 ** 2),
      u("GiB", "Gibibyte (GiB)", 1024 ** 3),
    ],
  },
];

/* ------------------------------------------------------------------ lookups */

export function getCategory(key: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.key === key);
}

export function getUnit(cat: CategoryDef, key: string): UnitDef | undefined {
  return cat.units.find((un) => un.key === key);
}

/**
 * Convert `value` from `from` to `to` within `cat`. Temperature is handled by
 * `convertTemperature`; everything else converts through the base unit.
 */
export function convert(
  cat: CategoryDef,
  value: number,
  from: string,
  to: string,
): number {
  if (cat.key === "temperature") return convertTemperature(value, from, to);
  const f = getUnit(cat, from);
  const t = getUnit(cat, to);
  if (!f || !t) return NaN;
  return (value * f.factor) / t.factor;
}

/**
 * Format a numeric result for display: trims trailing zeros, keeps a sensible
 * number of significant digits, and falls back to exponential notation for very
 * large/small magnitudes so output stays readable.
 */
export function formatResult(n: number): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";

  const abs = Math.abs(n);
  // Very large or very small — use compact exponential.
  if (abs >= 1e15 || abs < 1e-6) {
    return trimZeros(n.toExponential(6));
  }
  // toPrecision keeps ~10 significant figures; parseFloat drops trailing zeros.
  const precise = Number(n.toPrecision(10));
  // Avoid exponential output from String() for mid-range values.
  return trimZeros(precise.toString());
}

/** Remove trailing zeros (and a dangling decimal point) from a number string. */
function trimZeros(s: string): string {
  if (!s.includes(".") && !s.includes("e") && !s.includes("E")) return s;
  if (s.includes("e") || s.includes("E")) {
    // Split mantissa / exponent, trim the mantissa only.
    const [mantissa, exp] = s.split(/[eE]/);
    const m = mantissa.includes(".")
      ? mantissa.replace(/0+$/, "").replace(/\.$/, "")
      : mantissa;
    return `${m}e${exp}`;
  }
  return s.replace(/0+$/, "").replace(/\.$/, "");
}
