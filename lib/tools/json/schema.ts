/**
 * JSON Schema tooling — the pure half. A small editable node model for the
 * visual designer, conversion to and from real JSON Schema (2020-12 out,
 * any draft in — unknown keywords are preserved), schema inference from
 * sample JSON, and draft detection. Validation itself lives in
 * `./validate.ts` (Ajv) so this module stays dependency-free.
 */

export type NodeType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | "any";

export const NODE_TYPES: NodeType[] = ["object", "array", "string", "number", "integer", "boolean", "null", "any"];

/** Formats supported by ajv-formats that are worth offering in the designer. */
export const STRING_FORMATS = [
  "email", "uri", "uri-reference", "url", "hostname", "ipv4", "ipv6", "date", "time", "date-time",
  "duration", "uuid", "regex", "json-pointer",
] as const;

export interface SchemaNode {
  /** Stable key for React lists. */
  id: string;
  type: NodeType;
  nullable: boolean;
  title: string;
  description: string;
  /** Comma-separated allowed values; each is parsed as JSON when possible. */
  enum: string;
  // object
  properties: PropertyEntry[];
  additionalProperties: boolean;
  // array
  items?: SchemaNode;
  minItems: string;
  maxItems: string;
  uniqueItems: boolean;
  // string
  minLength: string;
  maxLength: string;
  pattern: string;
  format: string;
  // number / integer
  minimum: string;
  maximum: string;
  multipleOf: string;
  /** Keywords the designer doesn't model, kept verbatim so imports round-trip. */
  extra: Record<string, unknown>;
}

export interface PropertyEntry {
  key: string;
  required: boolean;
  node: SchemaNode;
}

let seq = 0;
const nextId = () => `n${++seq}`;

export function createNode(type: NodeType = "string", partial: Partial<SchemaNode> = {}): SchemaNode {
  return {
    id: nextId(),
    type,
    nullable: false,
    title: "",
    description: "",
    enum: "",
    properties: [],
    additionalProperties: true,
    items: type === "array" ? createNode("string") : undefined,
    minItems: "",
    maxItems: "",
    uniqueItems: false,
    minLength: "",
    maxLength: "",
    pattern: "",
    format: "",
    minimum: "",
    maximum: "",
    multipleOf: "",
    extra: {},
    ...partial,
  };
}

/** Immutable update of the node with `id` anywhere in the tree. */
export function updateNode(root: SchemaNode, id: string, fn: (n: SchemaNode) => SchemaNode): SchemaNode {
  if (root.id === id) return fn(root);
  let changed = false;
  const properties = root.properties.map((p) => {
    const node = updateNode(p.node, id, fn);
    if (node !== p.node) changed = true;
    return node === p.node ? p : { ...p, node };
  });
  const items = root.items ? updateNode(root.items, id, fn) : undefined;
  if (items !== root.items) changed = true;
  return changed ? { ...root, properties, items } : root;
}

/* ------------------------------------------------------------ node → schema */

const DRAFT_2020 = "https://json-schema.org/draft/2020-12/schema";

function num(s: string): number | undefined {
  const t = s.trim();
  if (!t) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function parseEnum(s: string): unknown[] | undefined {
  const parts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (!parts.length) return undefined;
  return parts.map((p) => {
    try {
      return JSON.parse(p);
    } catch {
      return p;
    }
  });
}

export function nodeToSchema(node: SchemaNode, root = true): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (root) out.$schema = DRAFT_2020;
  if (node.type !== "any") out.type = node.nullable ? [node.type, "null"] : node.type;
  if (node.title.trim()) out.title = node.title.trim();
  if (node.description.trim()) out.description = node.description.trim();
  const en = parseEnum(node.enum);
  if (en) out.enum = en;

  switch (node.type) {
    case "object": {
      if (node.properties.length) {
        const props: Record<string, unknown> = {};
        for (const p of node.properties) if (p.key.trim()) props[p.key.trim()] = nodeToSchema(p.node, false);
        out.properties = props;
        const required = node.properties.filter((p) => p.required && p.key.trim()).map((p) => p.key.trim());
        if (required.length) out.required = required;
      }
      if (!node.additionalProperties) out.additionalProperties = false;
      break;
    }
    case "array": {
      if (node.items) out.items = nodeToSchema(node.items, false);
      const a = num(node.minItems), b = num(node.maxItems);
      if (a !== undefined) out.minItems = a;
      if (b !== undefined) out.maxItems = b;
      if (node.uniqueItems) out.uniqueItems = true;
      break;
    }
    case "string": {
      const a = num(node.minLength), b = num(node.maxLength);
      if (a !== undefined) out.minLength = a;
      if (b !== undefined) out.maxLength = b;
      if (node.pattern.trim()) out.pattern = node.pattern.trim();
      if (node.format.trim()) out.format = node.format.trim();
      break;
    }
    case "number":
    case "integer": {
      const a = num(node.minimum), b = num(node.maximum), c = num(node.multipleOf);
      if (a !== undefined) out.minimum = a;
      if (b !== undefined) out.maximum = b;
      if (c !== undefined) out.multipleOf = c;
      break;
    }
    default:
      break;
  }
  for (const [k, v] of Object.entries(node.extra)) if (!(k in out)) out[k] = v;
  return out;
}

/* ------------------------------------------------------------ schema → node */

const HANDLED = new Set([
  "$schema", "type", "title", "description", "enum", "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf",
]);

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/**
 * Best-effort import of a JSON Schema into the designer model. Structural
 * keywords the designer understands become editable; everything else is
 * kept in `extra` and written back unchanged.
 */
export function schemaToNode(schema: unknown, root = true): SchemaNode {
  if (typeof schema === "boolean" || schema === null || typeof schema !== "object") return createNode("any");
  const s = schema as Record<string, unknown>;

  let type: NodeType = "any";
  let nullable = false;
  const extra: Record<string, unknown> = {};
  const t = s.type;
  if (typeof t === "string" && NODE_TYPES.includes(t as NodeType)) type = t as NodeType;
  else if (Array.isArray(t)) {
    const nonNull = t.filter((x) => x !== "null");
    nullable = t.includes("null");
    if (nonNull.length === 1 && NODE_TYPES.includes(nonNull[0] as NodeType)) type = nonNull[0] as NodeType;
    else extra.type = t;
  }
  if (type === "any" && !("type" in extra)) {
    if (s.properties || s.required) type = "object";
    else if (s.items) type = "array";
  }

  const node = createNode(type, {
    nullable,
    title: str(s.title),
    description: str(s.description),
    enum: Array.isArray(s.enum) ? s.enum.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : "",
    additionalProperties: s.additionalProperties !== false,
    minItems: str(s.minItems),
    maxItems: str(s.maxItems),
    uniqueItems: s.uniqueItems === true,
    minLength: str(s.minLength),
    maxLength: str(s.maxLength),
    pattern: str(s.pattern),
    format: str(s.format),
    minimum: str(s.minimum),
    maximum: str(s.maximum),
    multipleOf: str(s.multipleOf),
    items: undefined,
  });

  if (type === "object" && s.properties && typeof s.properties === "object") {
    const required = new Set(Array.isArray(s.required) ? (s.required as unknown[]).map(String) : []);
    node.properties = Object.entries(s.properties as Record<string, unknown>).map(([key, sub]) => ({
      key,
      required: required.has(key),
      node: schemaToNode(sub, false),
    }));
  } else if (Array.isArray(s.required) && type === "object") {
    node.properties = (s.required as unknown[]).map((k) => ({ key: String(k), required: true, node: createNode("any") }));
  }
  if (type === "array") {
    node.items = s.items && typeof s.items === "object" && !Array.isArray(s.items) ? schemaToNode(s.items, false) : createNode("any");
    if (Array.isArray(s.items)) extra.items = s.items;
  }

  for (const [k, v] of Object.entries(s)) {
    if (HANDLED.has(k)) continue;
    extra[k] = v;
  }
  if (!root && "$schema" in s) extra.$schema = s.$schema;
  if (type === "array" && "additionalProperties" in s) extra.additionalProperties = s.additionalProperties;
  node.extra = extra;
  return node;
}

/* ---------------------------------------------------------------- inference */

const RE = {
  dateTime: /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/,
  date: /^\d{4}-\d{2}-\d{2}$/,
  time: /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/,
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  uri: /^[a-z][a-z0-9+.-]*:\/\/\S+$/i,
  ipv4: /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/,
};

export function detectFormat(s: string): string {
  if (RE.dateTime.test(s)) return "date-time";
  if (RE.date.test(s)) return "date";
  if (RE.time.test(s)) return "time";
  if (RE.email.test(s)) return "email";
  if (RE.uuid.test(s)) return "uuid";
  if (RE.ipv4.test(s)) return "ipv4";
  if (RE.uri.test(s)) return "uri";
  return "";
}

/** Infer a designer node from a sample value. Arrays merge their elements. */
export function inferNode(value: unknown): SchemaNode {
  if (value === null) return createNode("null");
  if (Array.isArray(value)) {
    const node = createNode("array", { items: undefined });
    node.items = value.length ? value.map(inferNode).reduce(mergeNodes) : createNode("any");
    return node;
  }
  switch (typeof value) {
    case "string":
      return createNode("string", { format: detectFormat(value) });
    case "number":
      return createNode(Number.isInteger(value) ? "integer" : "number");
    case "boolean":
      return createNode("boolean");
    case "object": {
      const node = createNode("object");
      node.properties = Object.entries(value as Record<string, unknown>).map(([key, v]) => ({
        key,
        required: true,
        node: inferNode(v),
      }));
      return node;
    }
    default:
      return createNode("any");
  }
}

/** Merge two inferred nodes (used for array elements). */
export function mergeNodes(a: SchemaNode, b: SchemaNode): SchemaNode {
  if (a.type === "null" && b.type === "null") return a;
  if (a.type === "null") return { ...b, nullable: true };
  if (b.type === "null") return { ...a, nullable: true };
  const nullable = a.nullable || b.nullable;
  if (a.type === b.type) {
    switch (a.type) {
      case "object": {
        const map = new Map<string, PropertyEntry>();
        for (const p of a.properties) map.set(p.key, { ...p });
        for (const p of b.properties) {
          const cur = map.get(p.key);
          if (cur) map.set(p.key, { key: p.key, required: cur.required && p.required, node: mergeNodes(cur.node, p.node) });
          else map.set(p.key, { ...p, required: false });
        }
        for (const [key, p] of map) if (!b.properties.some((q) => q.key === key)) map.set(key, { ...p, required: false });
        return { ...a, nullable, properties: [...map.values()] };
      }
      case "array":
        return { ...a, nullable, items: a.items && b.items ? mergeNodes(a.items, b.items) : (a.items ?? b.items) };
      case "string":
        return { ...a, nullable, format: a.format === b.format ? a.format : "" };
      default:
        return { ...a, nullable };
    }
  }
  if ((a.type === "integer" && b.type === "number") || (a.type === "number" && b.type === "integer"))
    return { ...a, type: "number", nullable };
  return createNode("any", { nullable });
}

/* ------------------------------------------------------------------- drafts */

export type Draft = "draft-04" | "draft-06" | "draft-07" | "2019-09" | "2020-12";

export const DRAFTS: { id: Draft; label: string; uri: string }[] = [
  { id: "2020-12", label: "2020-12", uri: "https://json-schema.org/draft/2020-12/schema" },
  { id: "2019-09", label: "2019-09", uri: "https://json-schema.org/draft/2019-09/schema" },
  { id: "draft-07", label: "Draft 7", uri: "http://json-schema.org/draft-07/schema#" },
  { id: "draft-06", label: "Draft 6", uri: "http://json-schema.org/draft-06/schema#" },
  { id: "draft-04", label: "Draft 4", uri: "http://json-schema.org/draft-04/schema#" },
];

/** Draft named by a schema's `$schema`, or null when absent/unknown. */
export function detectDraft(schema: unknown): Draft | null {
  if (!schema || typeof schema !== "object") return null;
  const uri = (schema as { $schema?: unknown }).$schema;
  if (typeof uri !== "string") return null;
  if (uri.includes("2020-12")) return "2020-12";
  if (uri.includes("2019-09")) return "2019-09";
  if (uri.includes("draft-07")) return "draft-07";
  if (uri.includes("draft-06")) return "draft-06";
  if (uri.includes("draft-04")) return "draft-04";
  return null;
}

/** "/users/0/email" → "users[0].email"; "" → "(root)". */
export function prettyPath(pointer: string): string {
  if (!pointer) return "(root)";
  return pointer
    .split("/")
    .slice(1)
    .map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"))
    .map((seg, i) => (/^\d+$/.test(seg) ? `[${seg}]` : i === 0 ? seg : `.${seg}`))
    .join("");
}

/** Parse JSON with a friendlier error message (line/column when available). */
export function parseJsonText(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  const t = text.trim();
  if (!t) return { ok: false, error: "empty" };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const m = msg.match(/position (\d+)/);
    if (m) {
      const pos = Number(m[1]);
      const before = t.slice(0, pos);
      const line = before.split("\n").length;
      const col = pos - before.lastIndexOf("\n");
      return { ok: false, error: `${msg.replace(/ in JSON at position \d+.*$/, "")} (line ${line}, column ${col})` };
    }
    return { ok: false, error: msg };
  }
}
