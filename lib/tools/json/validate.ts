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

/** Validate `data` against `schema`; `draftPref` "auto" follows `$schema`, else draft-07. */
export function validateJson(schema: unknown, data: unknown, draftPref: Draft | "auto"): ValidationResult {
  const draft: Draft = draftPref === "auto" ? (detectDraft(schema) ?? "draft-07") : draftPref;
  // A fresh instance per run: schemas with `$id` would otherwise collide in Ajv's cache.
  const ajv = makeAjv(draft);
  const schemaErrors: string[] = [];

  if (!ajv.validateSchema(schema as object)) {
    for (const e of ajv.errors ?? []) schemaErrors.push(`${prettyPath(e.instancePath)}: ${e.message ?? e.keyword}`);
  }

  let validate;
  try {
    validate = ajv.compile(schema as object);
  } catch (e) {
    schemaErrors.push(e instanceof Error ? e.message : String(e));
    return { draft, schemaErrors, issues: [], valid: false };
  }

  const ok = validate(data);
  const issues = (validate.errors ?? []).map(toIssue);
  return { draft, schemaErrors, issues, valid: ok === true && schemaErrors.length === 0 };
}
