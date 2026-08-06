/**
 * QR payload classification — turns a decoded QR string into a typed,
 * human-readable structure (URL, Wi-Fi credentials, contact card, …).
 * Pure and framework-free; the pixel decoding itself happens in the widget.
 */

export type QrKind =
  | "url"
  | "wifi"
  | "email"
  | "phone"
  | "sms"
  | "geo"
  | "contact"
  | "event"
  | "text";

export interface QrField {
  label: string;
  value: string;
}

export interface QrClassified {
  kind: QrKind;
  /** Short human label for the kind badge, e.g. "Wi-Fi network". */
  label: string;
  /** Parsed fields for structured payloads (empty for plain text). */
  fields: QrField[];
  /** Actionable link for the payload, when one exists. */
  href?: string;
}

/**
 * Parse `KEY:value;KEY:value;;` bodies (WIFI:, MECARD:, MATMSG:) honoring
 * backslash escapes (\; \: \, \\) per the respective specs.
 */
function parseSemiSegments(body: string): [string, string][] {
  const out: [string, string][] = [];
  let key = "";
  let value = "";
  let phase: "key" | "value" = "key";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "\\" && i + 1 < body.length) {
      if (phase === "key") key += body[++i];
      else value += body[++i];
      continue;
    }
    if (ch === ";") {
      if (key) out.push([key.toUpperCase(), value]);
      key = "";
      value = "";
      phase = "key";
      continue;
    }
    if (ch === ":" && phase === "key") {
      phase = "value";
      continue;
    }
    if (phase === "key") key += ch;
    else value += ch;
  }
  if (key) out.push([key.toUpperCase(), value]);
  return out;
}

function field(label: string, value: string | undefined | null): QrField[] {
  const v = value?.trim();
  return v ? [{ label, value: v }] : [];
}

/** Unescape vCard/iCalendar text values (\n \, \; \\). */
function unescapeVText(v: string): string {
  return v.replace(/\\([\\,;nN])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));
}

/** `20260806T193000Z` → `2026-08-06 19:30 UTC`; `20260806` → `2026-08-06`. */
function formatIcsDate(v: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(?:\d{2})?(Z)?)?$/.exec(v.trim());
  if (!m) return v;
  const date = `${m[1]}-${m[2]}-${m[3]}`;
  if (!m[4]) return date;
  return `${date} ${m[4]}:${m[5]}${m[6] ? " UTC" : ""}`;
}

/** Unfold continuation lines and split a vCard/iCalendar body into [NAME, value] pairs. */
function parseVLines(raw: string): [string, string][] {
  return raw
    .replace(/\r?\n[ \t]/g, "")
    .split(/\r?\n/)
    .flatMap((line): [string, string][] => {
      const idx = line.indexOf(":");
      if (idx <= 0) return [];
      const name = line.slice(0, idx).split(";")[0].trim().toUpperCase();
      return [[name, line.slice(idx + 1)]];
    });
}

const WIFI_AUTH: Record<string, string> = {
  WPA: "WPA/WPA2",
  WPA2: "WPA2",
  WPA3: "WPA3",
  SAE: "WPA3",
  WEP: "WEP",
  NOPASS: "Open (no password)",
};

export function classifyQr(input: string): QrClassified {
  const raw = input.trim();

  if (/^WIFI:/i.test(raw)) {
    const seg = parseSemiSegments(raw.slice(5));
    const get = (k: string) => seg.find(([key]) => key === k)?.[1];
    const auth = (get("T") ?? "").toUpperCase();
    return {
      kind: "wifi",
      label: "Wi-Fi network",
      fields: [
        ...field("Network (SSID)", get("S")),
        ...field("Security", WIFI_AUTH[auth] ?? (auth || "Open (no password)")),
        ...field("Password", get("P")),
        ...(get("H")?.toLowerCase() === "true" ? [{ label: "Hidden network", value: "yes" }] : []),
      ],
    };
  }

  if (/^MECARD:/i.test(raw)) {
    const seg = parseSemiSegments(raw.slice(7));
    const fields = seg.flatMap(([k, v]) => {
      switch (k) {
        case "N":
          return field("Name", v.split(",").reverse().filter(Boolean).join(" ").trim());
        case "TEL":
          return field("Phone", v);
        case "EMAIL":
          return field("Email", v);
        case "ORG":
          return field("Organization", v);
        case "URL":
          return field("Website", v);
        case "ADR":
          return field("Address", v);
        case "NOTE":
          return field("Note", v);
        default:
          return [];
      }
    });
    return { kind: "contact", label: "Contact card", fields };
  }

  if (/^BEGIN:VCARD/i.test(raw)) {
    const lines = parseVLines(raw);
    const fields: QrField[] = [];
    const push = (label: string, v: string) => fields.push(...field(label, unescapeVText(v)));
    const fn = lines.find(([n]) => n === "FN");
    if (fn) push("Name", fn[1]);
    else {
      const n = lines.find(([name]) => name === "N");
      if (n) {
        const parts = n[1].split(";");
        push("Name", [parts[1], parts[0]].filter(Boolean).join(" "));
      }
    }
    for (const [name, v] of lines) {
      if (name === "ORG") push("Organization", v.split(";").filter(Boolean).join(", "));
      else if (name === "TITLE") push("Title", v);
      else if (name === "TEL") push("Phone", v);
      else if (name === "EMAIL") push("Email", v);
      else if (name === "URL") push("Website", v);
      else if (name === "ADR") push("Address", unescapeVText(v).split(";").map((p) => p.trim()).filter(Boolean).join(", "));
      else if (name === "BDAY") push("Birthday", v);
      else if (name === "NOTE") push("Note", v);
    }
    return { kind: "contact", label: "Contact card", fields };
  }

  if (/BEGIN:VEVENT/i.test(raw)) {
    const lines = parseVLines(raw);
    const get = (name: string) => lines.find(([n]) => n === name)?.[1];
    return {
      kind: "event",
      label: "Calendar event",
      fields: [
        ...field("Event", unescapeVText(get("SUMMARY") ?? "")),
        ...field("Starts", formatIcsDate(get("DTSTART") ?? "")),
        ...field("Ends", formatIcsDate(get("DTEND") ?? "")),
        ...field("Location", unescapeVText(get("LOCATION") ?? "")),
        ...field("Details", unescapeVText(get("DESCRIPTION") ?? "")),
      ],
    };
  }

  if (/^MATMSG:/i.test(raw)) {
    const seg = parseSemiSegments(raw.slice(7));
    const get = (k: string) => seg.find(([key]) => key === k)?.[1];
    const to = get("TO") ?? "";
    return {
      kind: "email",
      label: "Email",
      fields: [
        ...field("To", to),
        ...field("Subject", get("SUB")),
        ...field("Body", get("BODY")),
      ],
      href: to ? `mailto:${to}` : undefined,
    };
  }

  if (/^mailto:/i.test(raw)) {
    const [addr, query = ""] = raw.slice(7).split("?");
    const params = new URLSearchParams(query);
    return {
      kind: "email",
      label: "Email",
      fields: [
        ...field("To", decodeURIComponent(addr)),
        ...field("Subject", params.get("subject")),
        ...field("Body", params.get("body")),
      ],
      href: raw,
    };
  }

  if (/^tel:/i.test(raw)) {
    return {
      kind: "phone",
      label: "Phone number",
      fields: field("Number", decodeURIComponent(raw.slice(4))),
      href: raw,
    };
  }

  const smsto = /^smsto:([^:]*)(?::([\s\S]*))?$/i.exec(raw);
  if (smsto) {
    return {
      kind: "sms",
      label: "SMS",
      fields: [...field("Number", smsto[1]), ...field("Message", smsto[2])],
      href: smsto[1] ? `sms:${smsto[1]}` : undefined,
    };
  }
  if (/^sms:/i.test(raw)) {
    const [num, query = ""] = raw.slice(4).split("?");
    const params = new URLSearchParams(query);
    return {
      kind: "sms",
      label: "SMS",
      fields: [...field("Number", num), ...field("Message", params.get("body"))],
      href: raw,
    };
  }

  const geo = /^geo:(-?[\d.]+),(-?[\d.]+)/i.exec(raw);
  if (geo) {
    return {
      kind: "geo",
      label: "Location",
      fields: [
        { label: "Latitude", value: geo[1] },
        { label: "Longitude", value: geo[2] },
      ],
      href: `https://www.google.com/maps?q=${geo[1]},${geo[2]}`,
    };
  }

  if (/^https?:\/\/\S+$/i.test(raw)) {
    return { kind: "url", label: "Link", fields: [], href: raw };
  }
  if (/^www\.\S+$/i.test(raw)) {
    return { kind: "url", label: "Link", fields: [], href: `https://${raw}` };
  }

  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { kind: "email", label: "Email", fields: field("To", raw), href: `mailto:${raw}` };
  }
  if (/^\+[\d\s().-]{5,}$/.test(raw)) {
    return { kind: "phone", label: "Phone number", fields: field("Number", raw), href: `tel:${raw.replace(/[\s().-]/g, "")}` };
  }

  return { kind: "text", label: "Plain text", fields: [] };
}
