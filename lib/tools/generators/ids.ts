/** ID generators — UUID v4, UUID v7 and NanoID. All cryptographically random. */

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

const hex: string[] = Array.from({ length: 256 }, (_, i) =>
  i.toString(16).padStart(2, "0"),
);

export function uuidV4(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return formatUuid(b);
}

/** Time-ordered UUID v7 (48-bit ms timestamp + random). */
export function uuidV7(nowMs: number): string {
  const b = randomBytes(16);
  const ts = Math.max(0, Math.floor(nowMs));
  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = (b[6] & 0x0f) | 0x70; // version 7
  b[8] = (b[8] & 0x3f) | 0x80; // variant
  return formatUuid(b);
}

function formatUuid(b: Uint8Array): string {
  const h = [...b].map((x) => hex[x]);
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`;
}

const NANO_ALPHABET =
  "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";

export function nanoId(size = 21): string {
  const bytes = randomBytes(size);
  let id = "";
  for (let i = 0; i < size; i++) id += NANO_ALPHABET[bytes[i] & 63];
  return id;
}

export type IdKind = "uuid-v4" | "uuid-v7" | "nanoid";

export interface IdOptions {
  kind: IdKind;
  count: number;
  uppercase?: boolean;
  hyphens?: boolean;
  nanoSize?: number;
}

export function generateIds(opts: IdOptions, nowMs: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < opts.count; i++) {
    let id =
      opts.kind === "uuid-v4"
        ? uuidV4()
        : opts.kind === "uuid-v7"
          ? uuidV7(nowMs + i)
          : nanoId(opts.nanoSize ?? 21);
    if (opts.kind !== "nanoid" && opts.hyphens === false)
      id = id.replace(/-/g, "");
    if (opts.uppercase) id = id.toUpperCase();
    out.push(id);
  }
  return out;
}
