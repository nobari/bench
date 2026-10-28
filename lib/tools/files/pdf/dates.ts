/** PDF date strings — "D:20261028180000+09'00'" — both ways. */

const pad = (n: number) => String(n).padStart(2, "0");

/** A Date as a PDF date string in local time with its UTC offset. */
export function pdfDate(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off === 0 ? "Z" : off > 0 ? "+" : "-";
  const abs = Math.abs(off);
  const zone = off === 0 ? "" : `${pad(Math.floor(abs / 60))}'${pad(abs % 60)}'`;
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${sign}${zone}`;
}

/** The Date a PDF date string names, or null when it is not one; a missing offset is read as UTC. */
export function parsePdfDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([+\-Z])?(\d{2})?'?(\d{2})?'?/.exec(s.trim());
  if (!m) return null;
  const [, y, mo = "01", d = "01", h = "00", mi = "00", sec = "00", sign, oh = "00", om = "00"] = m;
  const year = Number(y);
  if (year < 1 || Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  let utc = Date.UTC(year, Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec));
  if (sign === "+" || sign === "-") utc -= (sign === "+" ? 1 : -1) * (Number(oh) * 60 + Number(om)) * 60_000;
  const out = new Date(utc);
  return Number.isNaN(out.getTime()) ? null : out;
}
