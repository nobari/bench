/**
 * Sample documents for the Markdown editor, each built around embedded tools: what an empty editor opens with,
 * and what the Samples menu offers. Links are built here so every embed points at a real tool in a real state.
 */
import { BENCH_HOST, SAMPLE } from "./markdown";

const origin = `https://${BENCH_HOST}`;
const link = (path: string, params: Record<string, string>) =>
  `${origin}${path}?${Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("&")}`;
const embed = (url: string, title?: string, height?: number) => "```embed\n" + url + "\n" + (title ? `title: ${title}\n` : "") + (height ? `height: ${height}\n` : "") + "```";

export interface MarkdownSample {
  id: string;
  title: string;
  blurb: string;
  text: string;
}

const INGOT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  title: "Ingot Registry Record",
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    assay: { $ref: "#/$defs/assay" },
    markings: { $ref: "#/$defs/markings" },
    imageHash: { $ref: "#/$defs/sha256" },
  },
  required: ["name", "imageHash"],
  additionalProperties: false,
  $defs: {
    assay: { type: "object", properties: { assayer: { type: "string" }, certificateNumber: { type: "string" }, assayedAt: { type: "string", format: "date" } }, required: ["assayer", "certificateNumber"] },
    markings: {
      type: "object",
      properties: { refiner: { type: "string" }, serialNumber: { type: "string" }, fineness: { type: "number", minimum: 0, maximum: 1 }, form: { enum: ["bar", "ingot", "coin"] } },
      required: ["refiner", "serialNumber", "fineness"],
    },
    sha256: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};
const INGOT_RECORD = {
  name: "Gold bar 1 kg, serial HPM-2024-017345",
  imageHash: "9c56cc51b374c3ba189210d5b6d4bf57790d351c96c47c02190ecf1e430635ab",
  assay: { assayer: "Metalor", certificateNumber: "A-88213", assayedAt: "2024-05-02" },
  markings: { refiner: "Heraeus", serialNumber: "HPM-2024-017345", fineness: 0.9999, form: "bar" },
};

export const WELCOME = `${SAMPLE}

## Embedded tools

Any Bench tool can live inside a document, in a state you choose. This is the palette generator, open on an analogous scheme — try it, then open it in full from the bar above it:

${embed(link("/color/palette", { m: "harmony", base: "#55555e", scheme: "analogous", n: "5" }), "An analogous palette")}

The block is just a fence with the language \`embed\` and the tool's link. The toolbar's embed button inserts one, and **Samples** (next to Clear) has whole documents built this way.
`;

export const SAMPLES: MarkdownSample[] = [
  { id: "welcome", title: "Welcome", blurb: "The basics, plus one embedded tool.", text: WELCOME },
  {
    id: "spec",
    title: "Spec with a live schema",
    blurb: "A record format described in prose, with its schema open in the designer and a sample record to inspect.",
    text: `# Ingot registry record

A record describes one bar or ingot held in custody. It commits to the object with hashes only, never with private data, and every version of it stays public.

## Requirements

| Field | Rule |
| --- | --- |
| \`name\` | 1–120 characters, shown in lists |
| \`imageHash\` | SHA-256 of the photograph of the stamped area |
| \`markings\` | the stamped markings, as read from the object |
| \`assay\` | the certificate, by number and assayer |

> [!IMPORTANT]
> \`imageHash\` and \`name\` are required from the first version. A record may start without an assay and gain one later.

## The schema, live

Open a definition, follow a \`$ref\`, add a property — the designer below is the real tool:

${embed(link("/json/schema", { m: "design", s: JSON.stringify(INGOT_SCHEMA) }), "Ingot record schema")}

## A sample record

${embed(link("/json/viewer", { i: JSON.stringify(INGOT_RECORD) }), "A record, formatted", 420)}

## How a record changes

\`\`\`mermaid
sequenceDiagram
  participant C as Custodian
  participant H as Hub
  participant R as Registry
  C->>H: beneficiary change
  H->>R: new record version (hubEventId)
  R-->>C: version published
\`\`\`
`,
  },
  {
    id: "review",
    title: "Code review notes",
    blurb: "Findings with the code open in the editor and the two versions in the diff checker.",
    text: `# Review: \`countWords\`

Two findings, one nit. The snippet is open below in the code editor — press Prettify to see what the formatter would change, and the syntax check runs as you type.

${embed(link("/web/code", { l: "javascript", i: 'import { readFile } from "node:fs/promises";\n\nexport async function countWords(path) {\n  const text = await readFile(path, "utf8")\n  const words = text.split(/\\s+/).filter(Boolean)\n  return { path, words: words.length, longest: words.reduce((a, b) => a.length >= b.length ? a : b, "") }\n}\n' }), "countWords.js", 420)}

## Findings

> [!WARNING]
> **Empty input.** \`words.reduce\` on an empty array throws without an initial value — it has one here (\`""\`), but \`text.split(/\\s+/)\` on an empty file yields \`[""]\`, which \`filter(Boolean)\` removes, so this is fine. Worth a test.

> [!NOTE]
> **Encoding.** \`readFile(path, "utf8")\` strips a BOM? It does not; a file starting with U+FEFF counts it as part of the first word.

- [x] Missing semicolons (the formatter adds them)
- [ ] Add a test for the empty file
- [ ] Handle the BOM

## What changed since the last round

${embed(link("/web/diff", { a: "export async function countWords(path) {\n  const text = await readFile(path)\n  const words = text.split(' ')\n  return words.length\n}", b: 'export async function countWords(path) {\n  const text = await readFile(path, "utf8")\n  const words = text.split(/\\s+/).filter(Boolean)\n  return { path, words: words.length }\n}' }), "Before and after", 460)}
`,
  },
  {
    id: "design",
    title: "Design tokens memo",
    blurb: "A colour decision with the converter and a palette open on the proposed values.",
    text: `# Accent colour for the dashboard

We settled on **#c8f135** for the accent. The converter below has it open in every notation; the palette gives the tints and shades the components will use.

${embed(link("/color/converter", { c: "#c8f135" }), "The accent in every notation", 520)}

## Tints and shades

${embed(link("/color/palette", { m: "scale", base: "#c8f135" }), "Scale of the accent")}

## Where each step goes

| Step | Use |
| --- | --- |
| 100 | hover background |
| 300 | borders, focus rings |
| 500 | the accent itself |
| 700 | text on light surfaces |

> [!CAUTION]
> Check contrast before using the accent for text: #c8f135 on white is below 2:1.
`,
  },
  {
    id: "runbook",
    title: "Ops runbook",
    blurb: "A schedule, a timestamp and a hash, each in its tool, next to the steps that use them.",
    text: `# Nightly export runbook

## When it runs

The job runs on weekdays at 09:30 Tokyo time. The expression, with its next runs:

${embed(link("/time/cron", { e: "30 9 * * 1-5", tz: "Asia/Tokyo" }), "The schedule", 420)}

## Reading the logs

Log lines carry Unix timestamps. Paste one into the converter to see it in every zone:

${embed(link("/time/timestamp", { t: "1719100800" }), "A log timestamp", 380)}

## Checking an artefact

Each export ends with its SHA-256. To verify a file by hand, hash it here and compare:

${embed(link("/crypto/hash", { i: "hello" }), "Hash a value", 380)}

## Steps

1. Confirm the job ran (schedule above).
2. Open the log, convert the first and last timestamps, and check the run took under an hour.
3. Hash the artefact and compare with the line at the end of the log.
4. If anything differs, re-run with \`--verify\` and attach both hashes to the ticket.
`,
  },
];

export const sampleById = (id: string) => SAMPLES.find((s) => s.id === id) ?? null;
