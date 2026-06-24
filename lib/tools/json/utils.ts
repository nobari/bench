/** Pure helpers for the JSON viewer. */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [k: string]: JsonValue };

export type JsonType =
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

export function typeOf(v: unknown): JsonType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as JsonType;
}

export interface ParseError {
  message: string;
  line?: number;
  column?: number;
}

export function parseJson(
  text: string,
): { ok: true; value: JsonValue } | { ok: false; error: ParseError } {
  try {
    return { ok: true, value: JSON.parse(text) as JsonValue };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Invalid JSON";
    // V8 sometimes embeds "(line X column Y)"; otherwise derive from "position N".
    const lc = message.match(/line (\d+) column (\d+)/i);
    if (lc) {
      return { ok: false, error: { message, line: +lc[1], column: +lc[2] } };
    }
    const pos = message.match(/position (\d+)/i);
    if (pos) {
      const idx = +pos[1];
      const upto = text.slice(0, idx);
      const line = upto.split("\n").length;
      const column = idx - upto.lastIndexOf("\n");
      return { ok: false, error: { message, line, column } };
    }
    return { ok: false, error: { message } };
  }
}

export function sortDeep(v: JsonValue): JsonValue {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortDeep((v as Record<string, JsonValue>)[k])]),
    );
  }
  return v;
}

export function formatJson(v: JsonValue, indent: number | "\t"): string {
  return JSON.stringify(v, null, indent === "\t" ? "\t" : indent);
}

/** HTML-escaped, token-wrapped highlighting for a formatted JSON string. */
export function highlightJson(json: string): string {
  const escaped = json
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (m) => {
      let cls = "num";
      if (/^"/.test(m)) cls = /:\s*$/.test(m) ? "key" : "str";
      else if (/true|false/.test(m)) cls = "bool";
      else if (/null/.test(m)) cls = "null";
      return `<span class="tok-${cls}">${m}</span>`;
    },
  );
}

/** Short inline preview for a collapsed container. */
export function preview(v: JsonValue): string {
  if (Array.isArray(v)) return `[] ${v.length}`;
  if (v && typeof v === "object") return `{} ${Object.keys(v).length}`;
  return "";
}

export interface ContainerInfo {
  id: string;
  depth: number;
}

/** Every object/array path id, for expand-all (capped to stay responsive). */
export function collectContainers(
  root: JsonValue,
  cap = 6000,
): ContainerInfo[] {
  const out: ContainerInfo[] = [];
  const walk = (v: JsonValue, id: string, depth: number) => {
    if (out.length > cap) return;
    if (Array.isArray(v)) {
      out.push({ id, depth });
      v.forEach((child, i) => walk(child, `${id}/${i}`, depth + 1));
    } else if (v && typeof v === "object") {
      out.push({ id, depth });
      for (const [k, child] of Object.entries(v))
        walk(child as JsonValue, `${id}/${k}`, depth + 1);
    }
  };
  walk(root, "root", 0);
  return out;
}

/** Compute which node ids to open (ancestors of matches) and which match. */
export function searchJson(
  root: JsonValue,
  q: string,
  cap = 12000,
): { open: Set<string>; hit: Set<string> } {
  const open = new Set<string>();
  const hit = new Set<string>();
  const needle = q.toLowerCase();
  let count = 0;

  const walk = (v: JsonValue, id: string): boolean => {
    if (count++ > cap) return false;
    let match = false;

    if (v === null) {
      if ("null".includes(needle)) match = true;
    } else if (typeof v !== "object") {
      if (String(v).toLowerCase().includes(needle)) match = true;
    }
    if (match) hit.add(id);

    if (v && typeof v === "object") {
      const entries: [string, JsonValue][] = Array.isArray(v)
        ? v.map((c, i) => [String(i), c])
        : Object.entries(v);
      for (const [k, child] of entries) {
        const childId = `${id}/${k}`;
        const keyMatch = k.toLowerCase().includes(needle);
        if (keyMatch) hit.add(childId);
        const childMatch = walk(child, childId);
        if (keyMatch || childMatch) {
          open.add(id);
          match = true;
        }
      }
    }
    return match;
  };

  walk(root, "root");
  return { open, hit };
}

export function highlightText(text: string, q: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  if (!q) return escaped;
  const safeQ = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escaped.replace(
    new RegExp(`(${safeQ})`, "ig"),
    '<span class="tok-mark">$1</span>',
  );
}
