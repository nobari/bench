/**
 * JSON Schema tooling — the pure half. A small editable node model for the
 * visual designer, conversion to and from real JSON Schema (2020-12 out,
 * any draft in — unknown keywords are preserved), schema inference from
 * sample JSON, and draft detection. Validation itself lives in
 * `./validate.ts` (Ajv) so this module stays dependency-free.
 */

export type NodeType = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null" | "any" | "ref";

export const NODE_TYPES: NodeType[] = ["object", "array", "string", "number", "integer", "boolean", "null", "any", "ref"];

/** Where a document keeps its reusable definitions. */
export type DefsKeyword = "$defs" | "definitions";

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
  // object, continued
  minProperties: string;
  maxProperties: string;
  /** When extra keys must match a schema rather than being simply allowed or refused. */
  additionalSchema?: SchemaNode;
  /** The one allowed value, as JSON text; empty for none. */
  const: string;
  /** For type "ref": a JSON pointer in this document (`#/$defs/name`) or a URI. */
  ref: string;
  /** Reusable definitions (normally on the root), referenced by `#/<defsKeyword>/<key>`. */
  defs: DefEntry[];
  defsKeyword: DefsKeyword;
  /** The order `required` had when imported, so it is written back unchanged (new keys follow in property order). */
  requiredOrder: string[];
  /** Keywords the designer doesn't model, kept verbatim so imports round-trip. */
  extra: Record<string, unknown>;
  /** The root's `$schema` as written; empty for none. Only the root node's is written out. */
  schemaUri: string;
}

export interface PropertyEntry {
  key: string;
  required: boolean;
  node: SchemaNode;
}

export interface DefEntry {
  key: string;
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
    minProperties: "",
    maxProperties: "",
    additionalSchema: undefined,
    const: "",
    ref: "",
    defs: [],
    defsKeyword: "$defs",
    requiredOrder: [],
    extra: {},
    schemaUri: "",
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
  const additionalSchema = root.additionalSchema ? updateNode(root.additionalSchema, id, fn) : undefined;
  if (additionalSchema !== root.additionalSchema) changed = true;
  const defs = root.defs.map((d) => {
    const node = updateNode(d.node, id, fn);
    if (node !== d.node) changed = true;
    return node === d.node ? d : { ...d, node };
  });
  return changed ? { ...root, properties, items, additionalSchema, defs } : root;
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

function parseConst(s: string): unknown {
  const t = s.trim();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

export function nodeToSchema(node: SchemaNode, root = true): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (root && node.schemaUri.trim()) out.$schema = node.schemaUri.trim();
  if (node.type === "ref") {
    if (node.ref.trim()) out.$ref = node.ref.trim();
  } else if (node.type !== "any") out.type = node.nullable ? [node.type, "null"] : node.type;
  if (node.title.trim()) out.title = node.title.trim();
  if (node.description.trim()) out.description = node.description.trim();
  const en = parseEnum(node.enum);
  if (en) out.enum = en;
  if (node.const.trim()) out.const = parseConst(node.const);

  switch (node.type) {
    case "object": {
      if (node.properties.length) {
        const props: Record<string, unknown> = {};
        for (const p of node.properties) if (p.key.trim()) props[p.key.trim()] = nodeToSchema(p.node, false);
        out.properties = props;
        const required = node.properties.filter((p) => p.required && p.key.trim()).map((p) => p.key.trim());
        const kept = node.requiredOrder.filter((k) => required.includes(k));
        const ordered = [...kept, ...required.filter((k) => !kept.includes(k))];
        if (ordered.length) out.required = ordered;
      }
      if (node.additionalSchema) out.additionalProperties = nodeToSchema(node.additionalSchema, false);
      else if (!node.additionalProperties) out.additionalProperties = false;
      const a = num(node.minProperties), b = num(node.maxProperties);
      if (a !== undefined) out.minProperties = a;
      if (b !== undefined) out.maxProperties = b;
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
  if (node.defs.length) {
    const defs: Record<string, unknown> = {};
    for (const d of node.defs) if (d.key.trim()) defs[d.key.trim()] = nodeToSchema(d.node, false);
    out[node.defsKeyword] = defs;
  }
  return out;
}

/* ------------------------------------------------------------ schema → node */

const HANDLED = new Set([
  "$schema", "type", "title", "description", "enum", "properties", "required", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems", "minLength", "maxLength", "pattern", "format",
  "minimum", "maximum", "multipleOf", "minProperties", "maxProperties", "const", "$ref", "$defs", "definitions",
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
  const isRef = typeof s.$ref === "string";
  const t = s.type;
  if (isRef) type = "ref";
  else if (typeof t === "string" && t !== "ref" && NODE_TYPES.includes(t as NodeType)) type = t as NodeType;
  else if (Array.isArray(t)) {
    const nonNull = t.filter((x) => x !== "null");
    nullable = t.includes("null");
    if (nonNull.length === 1 && nonNull[0] !== "ref" && NODE_TYPES.includes(nonNull[0] as NodeType)) type = nonNull[0] as NodeType;
    else extra.type = t;
  } else if (t !== undefined) extra.type = t;
  if (type === "any" && !("type" in extra)) {
    if (s.properties || s.required) type = "object";
    else if (s.items) type = "array";
  }
  const extraSchema = s.additionalProperties && typeof s.additionalProperties === "object" ? s.additionalProperties : null;
  const defsKeyword: DefsKeyword = s.$defs && typeof s.$defs === "object" ? "$defs" : "definitions";
  const defsSource = s[defsKeyword];

  const node = createNode(type, {
    nullable,
    title: str(s.title),
    description: str(s.description),
    enum: Array.isArray(s.enum) ? s.enum.map((v) => (typeof v === "string" ? v : JSON.stringify(v))).join(", ") : "",
    const: "const" in s ? JSON.stringify(s.const) : "",
    ref: isRef ? (s.$ref as string) : "",
    additionalProperties: s.additionalProperties !== false,
    additionalSchema: type === "object" && extraSchema ? schemaToNode(extraSchema, false) : undefined,
    minProperties: str(s.minProperties),
    maxProperties: str(s.maxProperties),
    defsKeyword,
    defs:
      defsSource && typeof defsSource === "object" && !Array.isArray(defsSource)
        ? Object.entries(defsSource as Record<string, unknown>).map(([key, sub]) => ({ key, node: schemaToNode(sub, false) }))
        : [],
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

  node.requiredOrder = Array.isArray(s.required) ? (s.required as unknown[]).map(String) : [];
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
  if (root) node.schemaUri = typeof s.$schema === "string" ? s.$schema : "";
  else if ("$schema" in s) extra.$schema = s.$schema;
  if (type !== "object" && "additionalProperties" in s) extra.additionalProperties = s.additionalProperties;
  if (type !== "object" && ("minProperties" in s || "maxProperties" in s)) {
    if ("minProperties" in s) extra.minProperties = s.minProperties;
    if ("maxProperties" in s) extra.maxProperties = s.maxProperties;
  }
  // Both keywords present: the one the designer does not edit is kept verbatim.
  if (defsKeyword === "$defs" && "definitions" in s) extra.definitions = s.definitions;
  node.extra = extra;
  return node;
}

/** The pointers a `$ref` in this design can name, in definition order. */
export function listDefinitions(root: SchemaNode): string[] {
  return root.defs.filter((d) => d.key.trim()).map((d) => `#/${root.defsKeyword}/${d.key.trim()}`);
}

/* --------------------------------------------------------------- references */

/** The value a JSON pointer into this document names (`#/$defs/x`), or undefined for a URI, an anchor or a missing target. */
export function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#")) return undefined;
  const path = ref.slice(1);
  if (path === "") return root;
  if (!path.startsWith("/")) return undefined;
  let cur: unknown = root;
  for (const raw of path.split("/").slice(1)) {
    let seg = raw;
    try {
      seg = decodeURIComponent(raw);
    } catch {
      /* keep as is */
    }
    seg = seg.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
    if (cur === undefined) return undefined;
  }
  return cur;
}

/** A schema's shape in words, with references followed, for showing what a value may be. */
export interface SchemaSummary {
  /** Property name, "items", "extra keys", or "" for the schema itself. */
  label: string;
  type: string;
  /** The pointer this came through, when the schema was a reference. */
  ref?: string;
  required: boolean;
  description: string;
  constraints: string[];
  conditions: string[];
  children: SchemaSummary[];
  /** The reference is already open further up: not expanded again. */
  recursive?: boolean;
  /** The reference could not be followed (missing, or a URI outside this document). */
  missing?: boolean;
}

const MAX_SUMMARY_DEPTH = 24;
const fmtValue = (v: unknown) => (typeof v === "string" ? JSON.stringify(v) : JSON.stringify(v));
const range = (min: unknown, max: unknown, unit: string, exMin?: unknown, exMax?: unknown): string[] => {
  const out: string[] = [];
  const lo = typeof min === "number" ? min : undefined, hi = typeof max === "number" ? max : undefined;
  if (lo !== undefined && hi !== undefined) out.push(unit ? `${lo}–${hi} ${unit}` : `${lo}–${hi}`);
  else if (lo !== undefined) out.push(unit ? `≥ ${lo} ${unit}` : `≥ ${lo}`);
  else if (hi !== undefined) out.push(unit ? `≤ ${hi} ${unit}` : `≤ ${hi}`);
  if (typeof exMin === "number") out.push(`> ${exMin}`);
  if (typeof exMax === "number") out.push(`< ${exMax}`);
  return out;
};

export function summarizeSchema(schema: unknown, rootSchema: unknown, label = "", required = false): SchemaSummary {
  return walkSummary(schema, rootSchema, label, required, new Set(), 0);
}

function walkSummary(schema: unknown, rootSchema: unknown, label: string, required: boolean, open: Set<string>, depth: number): SchemaSummary {
  const base: SchemaSummary = { label, type: "any", required, description: "", constraints: [], conditions: [], children: [] };
  if (schema === true || schema === undefined) return base;
  if (schema === false) return { ...base, type: "nothing" };
  if (!schema || typeof schema !== "object") return base;
  let s = schema as Record<string, unknown>;
  let ref: string | undefined;
  const siblings = s;
  if (typeof s.$ref === "string") {
    ref = s.$ref;
    if (open.has(ref)) return { ...base, type: "…", ref, recursive: true, description: str(s.description) };
    const target = resolvePointer(rootSchema, ref);
    if (!target || typeof target !== "object") return { ...base, type: "?", ref, missing: true, description: str(s.description) };
    s = target as Record<string, unknown>;
    open = new Set(open).add(ref);
  }
  const out: SchemaSummary = { ...base, ref, description: str(siblings.description) || str(s.description) };
  if (depth > MAX_SUMMARY_DEPTH) {
    out.constraints.push("…");
    return out;
  }
  // Type
  let type = "any";
  const t = s.type;
  if (typeof t === "string") type = t;
  else if (Array.isArray(t)) {
    const nonNull = t.filter((x) => x !== "null");
    type = nonNull.join(" | ") || "null";
    if (t.includes("null") && nonNull.length) out.constraints.push("or null");
  } else if (s.properties || s.required || s.additionalProperties !== undefined) type = "object";
  else if (s.items !== undefined) type = "array";
  if (Array.isArray(s.enum)) {
    type = "enum";
    out.constraints.push(s.enum.map(fmtValue).join(" · "));
  } else if ("const" in s) {
    type = "const";
    out.constraints.push(`= ${fmtValue(s.const)}`);
  }
  out.type = type;
  // Constraints by type
  if (type === "string" || typeof s.format === "string" || typeof s.pattern === "string") {
    if (typeof s.format === "string") out.constraints.push(s.format);
    out.constraints.push(...range(s.minLength, s.maxLength, "chars"));
    if (typeof s.pattern === "string") out.constraints.push(`pattern ${s.pattern}`);
  }
  if (type === "number" || type === "integer" || "minimum" in s || "maximum" in s || "exclusiveMinimum" in s || "exclusiveMaximum" in s) {
    out.constraints.push(...range(s.minimum, s.maximum, "", s.exclusiveMinimum, s.exclusiveMaximum));
    if (typeof s.multipleOf === "number") out.constraints.push(`multiple of ${s.multipleOf}`);
  }
  if (type === "object") {
    if (s.additionalProperties === false) out.constraints.push("no extra keys");
    out.constraints.push(...range(s.minProperties, s.maxProperties, "keys"));
    const req = new Set(Array.isArray(s.required) ? (s.required as unknown[]).map(String) : []);
    if (s.properties && typeof s.properties === "object") {
      for (const [key, sub] of Object.entries(s.properties as Record<string, unknown>)) out.children.push(walkSummary(sub, rootSchema, key, req.has(key), open, depth + 1));
    }
    for (const key of req) if (!out.children.some((c) => c.label === key)) out.children.push({ ...walkSummary(true, rootSchema, key, true, open, depth + 1) });
    if (s.additionalProperties && typeof s.additionalProperties === "object") out.children.push(walkSummary(s.additionalProperties, rootSchema, "extra keys", false, open, depth + 1));
    if (s.patternProperties && typeof s.patternProperties === "object") {
      for (const [pat, sub] of Object.entries(s.patternProperties as Record<string, unknown>)) out.children.push(walkSummary(sub, rootSchema, `keys matching ${pat}`, false, open, depth + 1));
    }
  }
  if (type === "array") {
    const minItems = typeof s.minItems === "number" && s.minItems > 0 ? s.minItems : undefined;
    out.constraints.push(...range(minItems, s.maxItems, "items"));
    if (s.uniqueItems === true) out.constraints.push("unique");
    if (Array.isArray(s.prefixItems)) (s.prefixItems as unknown[]).forEach((sub, i) => out.children.push(walkSummary(sub, rootSchema, `item ${i + 1}`, true, open, depth + 1)));
    if (s.items !== undefined && typeof s.items === "object" && !Array.isArray(s.items)) out.children.push(walkSummary(s.items, rootSchema, "items", false, open, depth + 1));
    else if (Array.isArray(s.items)) (s.items as unknown[]).forEach((sub, i) => out.children.push(walkSummary(sub, rootSchema, `item ${i + 1}`, true, open, depth + 1)));
  }
  for (const key of ["oneOf", "anyOf", "allOf"] as const) {
    if (!Array.isArray(s[key])) continue;
    (s[key] as unknown[]).forEach((sub, i) => out.children.push(walkSummary(sub, rootSchema, `${key === "oneOf" ? "one of" : key === "anyOf" ? "any of" : "all of"} · ${i + 1}`, false, open, depth + 1)));
  }
  out.conditions = describeConditions(s);
  return out;
}

/** Conditional and combining keywords in plain words, e.g. `if reason = "other" then note is required`. */
export function describeConditions(schema: unknown): string[] {
  if (!schema || typeof schema !== "object") return [];
  const s = schema as Record<string, unknown>;
  const out: string[] = [];
  if (s.if && typeof s.if === "object") {
    const cond = describeTest(s.if as Record<string, unknown>);
    const then = s.then && typeof s.then === "object" ? describeEffect(s.then as Record<string, unknown>) : "";
    const otherwise = s.else && typeof s.else === "object" ? describeEffect(s.else as Record<string, unknown>) : "";
    let line = `if ${cond}`;
    if (then) line += ` then ${then}`;
    if (otherwise) line += ` else ${otherwise}`;
    out.push(line);
  }
  if (Array.isArray(s.oneOf)) out.push(`one of ${s.oneOf.length} schemas`);
  if (Array.isArray(s.anyOf)) out.push(`any of ${s.anyOf.length} schemas`);
  if (Array.isArray(s.allOf)) out.push(`all of ${s.allOf.length} schemas`);
  if (s.not !== undefined) out.push("must not match a schema");
  if (s.dependentRequired && typeof s.dependentRequired === "object") {
    for (const [key, deps] of Object.entries(s.dependentRequired as Record<string, unknown>)) if (Array.isArray(deps)) out.push(`with ${key}, ${listWords(deps.map(String))} ${deps.length === 1 ? "is" : "are"} required`);
  }
  return out;
}

const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function describeTest(test: Record<string, unknown>): string {
  const parts: string[] = [];
  const req = new Set(Array.isArray(test.required) ? (test.required as unknown[]).map(String) : []);
  if (test.properties && typeof test.properties === "object") {
    for (const [key, sub] of Object.entries(test.properties as Record<string, unknown>)) {
      const p = sub && typeof sub === "object" ? (sub as Record<string, unknown>) : {};
      if ("const" in p) parts.push(`${key} = ${fmtValue(p.const)}`);
      else if (Array.isArray(p.enum)) parts.push(`${key} is ${p.enum.map(fmtValue).join(" or ")}`);
      else if (typeof p.type === "string") parts.push(`${key} is ${p.type === "integer" || p.type === "object" || p.type === "array" ? "an" : "a"} ${p.type}`);
      else parts.push(`${key} matches a schema`);
      req.delete(key);
    }
  }
  for (const key of req) parts.push(`${key} is present`);
  return parts.length ? parts.join(" and ") : JSON.stringify(test);
}

function describeEffect(effect: Record<string, unknown>): string {
  const parts: string[] = [];
  if (Array.isArray(effect.required) && effect.required.length) {
    const keys = (effect.required as unknown[]).map(String);
    parts.push(`${listWords(keys)} ${keys.length === 1 ? "is" : "are"} required`);
  }
  if (effect.properties && typeof effect.properties === "object") {
    for (const [key, sub] of Object.entries(effect.properties as Record<string, unknown>)) {
      const p = sub && typeof sub === "object" ? (sub as Record<string, unknown>) : {};
      if ("const" in p) parts.push(`${key} = ${fmtValue(p.const)}`);
      else if (sub === false) parts.push(`${key} is not allowed`);
      else parts.push(`${key} matches a schema`);
    }
  }
  const rest = Object.keys(effect).filter((k) => k !== "required" && k !== "properties");
  if (rest.length && !parts.length) parts.push(JSON.stringify(effect));
  return parts.join(" and ");
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
  return { ...inferNodeInner(value), schemaUri: DRAFT_2020 };
}

function inferNodeInner(value: unknown): SchemaNode {
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
        node: inferNodeInner(v),
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
