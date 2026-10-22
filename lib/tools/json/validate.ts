/**
 * JSON Schema validation with Ajv. One Ajv instance per draft, created lazily
 * in the browser (widgets are client-only). `strict: false` so any real-world
 * schema compiles; `allErrors` so the report lists everything at once.
 */

import Ajv, { type ErrorObject, type Options } from "ajv";
import Ajv2019 from "ajv/dist/2019.js";
import Ajv2020 from "ajv/dist/2020.js";
import Ajv04 from "ajv-draft-04";
import addFormats from "ajv-formats";
import draft6 from "ajv/dist/refs/json-schema-draft-06.json" with { type: "json" };
import { detectDraft, prettyPath, type Draft } from "./schema";

export interface ValidationIssue {
  /** JSON pointer into the data ("" = root). */
  pointer: string;
  path: string;
  message: string;
  keyword: string;
  params: Record<string, unknown>;
  schemaPath: string;
}

export interface ValidationResult {
  draft: Draft;
  /** Problems with the schema itself (meta-schema violations, bad $ref …). */
  schemaErrors: string[];
  issues: ValidationIssue[];
  valid: boolean;
}

const OPTIONS: Options = { allErrors: true, strict: false, allowUnionTypes: true, validateFormats: true };

function makeAjv(draft: Draft): Ajv {
  let ajv: Ajv;
  switch (draft) {
    case "2020-12":
      ajv = new Ajv2020(OPTIONS);
      break;
    case "2019-09":
      ajv = new Ajv2019(OPTIONS);
      break;
    case "draft-04":
      ajv = new Ajv04(OPTIONS) as unknown as Ajv;
      break;
    case "draft-06":
      ajv = new Ajv(OPTIONS);
      ajv.addMetaSchema(draft6);
      break;
    default:
      ajv = new Ajv(OPTIONS);
  }
  addFormats(ajv);
  return ajv;
}

function toIssue(e: ErrorObject): ValidationIssue {
  return {
    pointer: e.instancePath,
    path: prettyPath(e.instancePath),
    message: e.message ?? e.keyword,
    keyword: e.keyword,
    params: (e.params ?? {}) as Record<string, unknown>,
    schemaPath: e.schemaPath,
  };
}

export interface SchemaCheck {
  draft: Draft;
  /** Problems with the schema itself: meta-schema violations, a bad $ref, a keyword Ajv cannot compile. */
  schemaErrors: string[];
  /** Whether Ajv could compile it at all; without that no data can be checked. */
  compiled: boolean;
}

/**
 * The schema on its own: checked against its draft's meta-schema and compiled, with no data involved. `draftPref`
 * "auto" follows `$schema`, else draft-07. The compiled validator comes along for a data run.
 */
export function checkSchema(schema: unknown, draftPref: Draft | "auto"): SchemaCheck & { validate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null } } {
  const draft: Draft = draftPref === "auto" ? (detectDraft(schema) ?? "draft-07") : draftPref;
  // A fresh instance per run: schemas with `$id` would otherwise collide in Ajv's cache.
  const ajv = makeAjv(draft);
  const schemaErrors: string[] = [];
  if (!ajv.validateSchema(schema as object)) {
    for (const e of ajv.errors ?? []) schemaErrors.push(`${prettyPath(e.instancePath)}: ${e.message ?? e.keyword}`);
  }
  let validate: ((data: unknown) => boolean) & { errors?: ErrorObject[] | null };
  let compiled = true;
  try {
    validate = ajv.compile(schema as object) as typeof validate;
  } catch (e) {
    schemaErrors.push(e instanceof Error ? e.message : String(e));
    validate = Object.assign(() => false, { errors: null });
    compiled = false;
  }
  return { draft, schemaErrors, compiled, validate };
}

/** Validate `data` against `schema`: the schema check first, then the data when the schema compiled. */
export function validateJson(schema: unknown, data: unknown, draftPref: Draft | "auto"): ValidationResult {
  const { draft, schemaErrors, compiled, validate } = checkSchema(schema, draftPref);
  if (!compiled) return { draft, schemaErrors, issues: [], valid: false };
  const ok = validate(data);
  const issues = (validate.errors ?? []).map(toIssue);
  return { draft, schemaErrors, issues, valid: ok === true && schemaErrors.length === 0 };
}
