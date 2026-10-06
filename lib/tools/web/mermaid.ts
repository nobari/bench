/**
 * Mermaid editor support: starter templates for every diagram type, a cheat
 * sheet, and pure helpers for exporting (standalone SVG, PNG rasterisation,
 * printable HTML, Markdown fence). Rendering itself happens in the widget,
 * which lazy-loads the mermaid library.
 */

export interface Template {
  id: string;
  label: string;
  group: "Process" | "Structure" | "Data" | "Planning" | "Other";
  code: string;
}

export const TEMPLATES: Template[] = [
  {
    id: "flowchart",
    label: "Flowchart",
    group: "Process",
    code: `flowchart TD
    A([Start]) --> B{Is the build green?}
    B -- Yes --> C[Deploy to staging]
    B -- No --> D[Fix the failing test]
    D --> B
    C --> E{Smoke tests pass?}
    E -- Yes --> F[(Promote to production)]
    E -- No --> G[Roll back]
    G --> D
    F --> H([Done])`,
  },
  {
    id: "print",
    label: "Black & white (print)",
    group: "Process",
    code: `flowchart TD
      %% Incident response, print-safe. Pick the "Print (black & white)" theme.
      %% Print tip: let shapes, line styles and words do the work, not colour.
      %% Solid arrows = normal path, dotted = exceptional path, thick = escalation.
      A([Alert fires]) --> B{Is a customer affected?}
      B -- Yes --> C[[Page the on-call engineer]]
      B -- No --> D[Log it for the morning]
      C --> E{Fixed within 30 min?}
      E -- Yes --> F[Write the postmortem]
      E -- No ==> G[[Escalate to the incident lead]]
      G -.-> H[(Status page updated)]
      G --> I[Assemble the response team]
      I --> E
      D --> J([Done])
      F --> J
      subgraph Severity key
          direction LR
          K1[Routine] ~~~ K2[[Urgent]] ~~~ K3[(External notice)]
      end`,
  },
  {
    id: "sequence",
    label: "Sequence diagram",
    group: "Process",
    code: `sequenceDiagram
    autonumber
    actor U as User
    participant B as Browser
    participant A as API
    participant D as Database
    U->>B: Click "Sign in"
    B->>A: POST /session (email, password)
    activate A
    A->>D: SELECT user WHERE email = ?
    D-->>A: user row
    alt password matches
        A-->>B: 200 + session cookie
        B-->>U: Show dashboard
    else wrong password
        A-->>B: 401 Unauthorized
        B-->>U: Show error
    end
    deactivate A`,
  },
  {
    id: "state",
    label: "State diagram",
    group: "Process",
    code: `stateDiagram-v2
    [*] --> Draft
    Draft --> InReview: submit
    InReview --> Draft: request changes
    InReview --> Approved: approve
    Approved --> Published: publish
    Published --> Archived: archive
    Archived --> [*]
    state InReview {
        [*] --> Waiting
        Waiting --> Reviewing: reviewer opens
        Reviewing --> [*]
    }`,
  },
  {
    id: "journey",
    label: "User journey",
    group: "Process",
    code: `journey
    title Ordering a coffee
    section Arrive
      Walk in: 5: Customer
      Join the queue: 3: Customer
    section Order
      Choose a drink: 4: Customer
      Pay: 3: Customer, Barista
    section Wait
      Watch the barista: 4: Customer
      Receive the drink: 5: Customer, Barista`,
  },
  {
    id: "class",
    label: "Class diagram",
    group: "Structure",
    code: `classDiagram
    class Animal {
        +String name
        +int age
        +makeSound() void
    }
    class Dog {
        +String breed
        +fetch() void
    }
    class Cat {
        +bool indoor
        +purr() void
    }
    class Owner {
        +String name
        +adopt(Animal) void
    }
    Animal <|-- Dog
    Animal <|-- Cat
    Owner "1" o-- "*" Animal : owns`,
  },
  {
    id: "er",
    label: "Entity relationship",
    group: "Structure",
    code: `erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE_ITEM : contains
    PRODUCT ||--o{ LINE_ITEM : "appears in"
    CUSTOMER {
        int id PK
        string name
        string email UK
    }
    ORDER {
        int id PK
        int customer_id FK
        date placed_at
        string status
    }
    LINE_ITEM {
        int order_id FK
        int product_id FK
        int quantity
    }
    PRODUCT {
        int id PK
        string sku UK
        decimal price
    }`,
  },
  {
    id: "c4",
    label: "C4 context",
    group: "Structure",
    code: `C4Context
    title System context — online shop
    Person(customer, "Customer", "Buys products on the web")
    System(shop, "Online shop", "Lets customers browse and order")
    System_Ext(payments, "Payment provider", "Takes card payments")
    System_Ext(email, "Email service", "Sends receipts")
    Rel(customer, shop, "Uses", "HTTPS")
    Rel(shop, payments, "Charges cards", "API")
    Rel(shop, email, "Sends receipts", "SMTP")`,
  },
  {
    id: "architecture",
    label: "Architecture",
    group: "Structure",
    code: `architecture-beta
    group api(cloud)[API]

    service db(database)[Database] in api
    service disk1(disk)[Storage] in api
    service server(server)[Server] in api
    service gateway(internet)[Gateway]

    gateway:R --> L:server
    db:L -- R:server
    disk1:T -- B:server`,
  },
  {
    id: "pie",
    label: "Pie chart",
    group: "Data",
    code: `pie showData
    title Where the time goes
    "Meetings" : 35
    "Coding" : 30
    "Code review" : 15
    "Planning" : 10
    "Everything else" : 10`,
  },
  {
    id: "xy",
    label: "XY chart",
    group: "Data",
    code: `xychart-beta
    title "Monthly signups"
    x-axis [Jan, Feb, Mar, Apr, May, Jun]
    y-axis "Signups" 0 --> 1200
    bar [320, 410, 560, 700, 820, 1100]
    line [320, 410, 560, 700, 820, 1100]`,
  },
  {
    id: "quadrant",
    label: "Quadrant chart",
    group: "Data",
    code: `quadrantChart
    title Reach and engagement
    x-axis Low reach --> High reach
    y-axis Low engagement --> High engagement
    quadrant-1 Expand
    quadrant-2 Promote
    quadrant-3 Re-evaluate
    quadrant-4 Improve
    Newsletter: [0.3, 0.6]
    Blog: [0.45, 0.25]
    Podcast: [0.57, 0.7]
    Social: [0.8, 0.4]`,
  },
  {
    id: "sankey",
    label: "Sankey",
    group: "Data",
    code: `sankey-beta
    Visitors,Signed up,120
    Visitors,Left,880
    Signed up,Paid,30
    Signed up,Free tier,90`,
  },
  {
    id: "radar",
    label: "Radar chart",
    group: "Data",
    code: `radar-beta
    title Skills
    axis Frontend, Backend, Design, Testing, DevOps
    curve Alice{4, 3, 5, 2, 3}
    curve Bob{2, 5, 2, 4, 5}
    max 5`,
  },
  {
    id: "gantt",
    label: "Gantt chart",
    group: "Planning",
    code: `gantt
    title Website relaunch
    dateFormat YYYY-MM-DD
    axisFormat %b %d
    section Design
      Research          :done,    r1, 2026-10-01, 7d
      Wireframes        :active,  w1, after r1, 10d
      Visual design     :         v1, after w1, 10d
    section Build
      Frontend          :         f1, after w1, 21d
      Backend           :         b1, after w1, 14d
      QA                :crit,    q1, after f1, 7d
    section Launch
      Go live           :milestone, m1, after q1, 0d`,
  },
  {
    id: "timeline",
    label: "Timeline",
    group: "Planning",
    code: `timeline
    title History of the web
    1989 : Tim Berners-Lee proposes the Web
    1993 : Mosaic browser
    1995 : JavaScript
         : Amazon launches
    2004 : Web 2.0
    2008 : Chrome
    2015 : ES2015`,
  },
  {
    id: "kanban",
    label: "Kanban",
    group: "Planning",
    code: `kanban
  Todo
    [Write the spec]
    [Design the schema]@{ assigned: "Ada" }
  In progress
    [Build the API]@{ assigned: "Grace", priority: "High" }
  Done
    [Set up CI]
    [Create the repo]`,
  },
  {
    id: "mindmap",
    label: "Mind map",
    group: "Other",
    code: `mindmap
  root((Product launch))
    Marketing
      Landing page
      Launch email
      Social posts
    Engineering
      Feature freeze
      Load testing
      Rollback plan
    Support
      FAQ
      Training`,
  },
  {
    id: "git",
    label: "Git graph",
    group: "Other",
    code: `gitGraph
    commit id: "init"
    commit id: "scaffold"
    branch feature/login
    checkout feature/login
    commit id: "form"
    commit id: "validation"
    checkout main
    commit id: "readme"
    merge feature/login id: "merge login" tag: "v1.0"
    commit id: "hotfix"`,
  },
  {
    id: "requirement",
    label: "Requirement diagram",
    group: "Other",
    code: `requirementDiagram
    requirement login_req {
        id: 1
        text: "Users must be able to sign in"
        risk: high
        verifymethod: test
    }
    functionalRequirement mfa_req {
        id: 1.1
        text: "Sign-in must support a second factor"
        risk: medium
        verifymethod: demonstration
    }
    element auth_service {
        type: service
    }
    login_req - contains -> mfa_req
    auth_service - satisfies -> login_req`,
  },
  {
    id: "packet",
    label: "Packet diagram",
    group: "Other",
    code: `packet-beta
    0-15: "Source port"
    16-31: "Destination port"
    32-63: "Sequence number"
    64-95: "Acknowledgment number"
    96-99: "Data offset"
    100-105: "Reserved"
    106: "URG"
    107: "ACK"
    108: "PSH"
    109: "RST"
    110: "SYN"
    111: "FIN"
    112-127: "Window"
    128-143: "Checksum"
    144-159: "Urgent pointer"`,
  },
];

export const DEFAULT_TEMPLATE = TEMPLATES[0];

export const CHEATSHEET: { title: string; rows: [string, string][] }[] = [
  {
    title: "Flowchart",
    rows: [
      ["flowchart TD / LR", "top-down or left-to-right"],
      ["A[Box]  B(Rounded)  C([Pill])", "node shapes"],
      ["D{Decision}  E[(Database)]  F((Circle))", "more shapes"],
      ["A --> B", "arrow"],
      ["A -- text --> B  or  A -->|text| B", "labelled arrow"],
      ["A -.-> B   A ==> B", "dotted, thick"],
      ["subgraph Name … end", "group nodes"],
      ["style A fill:#e4eed3,stroke:#3f7414", "colour a node"],
    ],
  },
  {
    title: "Sequence",
    rows: [
      ["participant A / actor B", "declare, in order"],
      ["A->>B: message", "solid arrow"],
      ["B-->>A: reply", "dashed arrow"],
      ["activate A … deactivate A", "lifeline bar"],
      ["alt … else … end", "branches; also opt, loop, par"],
      ["Note over A,B: text", "note"],
      ["autonumber", "number the messages"],
    ],
  },
  {
    title: "Class & ER",
    rows: [
      ["A <|-- B", "inheritance"],
      ["A *-- B   A o-- B", "composition, aggregation"],
      ["+field  -private  #protected", "visibility"],
      ["A ||--o{ B : label", "one to many (ER)"],
      ["PK  FK  UK", "key markers (ER)"],
    ],
  },
  {
    title: "Everything",
    rows: [
      ["%% comment", "comments"],
      ["---\\ntitle: My diagram\\n---", "front matter title"],
      ["%%{init: {'theme': 'forest'}}%%", "inline config"],
      ["\"text with spaces\"", "quote labels with punctuation"],
      ["<br/>", "line break inside a label"],
    ],
  },
];

/** The diagram keyword on the first non-comment, non-frontmatter line. */
export function detectType(code: string): string {
  let body = code.replace(/^﻿/, "");
  if (body.startsWith("---")) {
    const end = body.indexOf("\n---", 3);
    if (end >= 0) body = body.slice(end + 4);
  }
  const line = body
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("%%"));
  if (!line) return "";
  const m = line.match(/^([A-Za-z][\w-]*)/);
  return m ? m[1].replace(/-v2$/, "") : "";
}

/** A self-contained SVG file: XML header, explicit size, and the fonts named. */
export function standaloneSvg(svg: string, background?: string): string {
  let out = svg.trim();
  if (!/^<\?xml/.test(out)) out = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n${out}`;
  // Only the root tag matters: a duplicate xmlns makes the file invalid XML, which <img> refuses to load.
  const root = out.match(/<svg\b[^>]*>/)?.[0] ?? "";
  if (!/\sxmlns="/.test(root)) out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
  if (background) out = out.replace(/<svg\b([^>]*)>/, `<svg$1 style="background-color:${background}">`);
  return out;
}

/** The root <svg> tag with its width and height attributes removed. */
export function stripSvgSize(svg: string): string {
  return svg.replace(/<svg\b[^>]*>/, (tag) => tag.replace(/\s(?:width|height)="[^"]*"/g, ""));
}

/** Width and height from the SVG's viewBox or attributes, in CSS pixels. */
export function svgSize(svg: string): { width: number; height: number } {
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]?.split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) return { width: vb[2], height: vb[3] };
  const w = Number(svg.match(/\swidth="([\d.]+)/)?.[1]), h = Number(svg.match(/\sheight="([\d.]+)/)?.[1]);
  return { width: w > 0 ? w : 800, height: h > 0 ? h : 600 };
}

/** Rasterise an SVG string to a PNG blob at `scale` × its CSS size (browser only). */
export async function svgToPng(svg: string, scale = 2, background = "#ffffff"): Promise<Blob> {
  const { width, height } = svgSize(svg);
  const sized = stripSvgSize(standaloneSvg(svg)).replace(/<svg\b/, `<svg width="${width}" height="${height}"`);
  const url = URL.createObjectURL(new Blob([sized], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error("The SVG couldn't be drawn to an image."));
      i.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const ctx = canvas.getContext("2d")!;
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed."))), "image/png"));
  } finally {
    URL.revokeObjectURL(url);
  }
}

export type PaperSize = "auto" | "a4" | "a4-landscape" | "letter" | "letter-landscape";

export const PAPER_SIZES: { id: PaperSize; label: string; css: string }[] = [
  { id: "auto", label: "Browser default", css: "auto" },
  { id: "a4", label: "A4 portrait", css: "A4 portrait" },
  { id: "a4-landscape", label: "A4 landscape", css: "A4 landscape" },
  { id: "letter", label: "Letter portrait", css: "letter portrait" },
  { id: "letter-landscape", label: "Letter landscape", css: "letter landscape" },
];

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A printable page: the diagram scaled to fit one sheet, with an optional title and the source. */
export function printableHtml(title: string, svg: string, opts: { paper?: PaperSize; includeSource?: boolean; source?: string; notes?: string } = {}): string {
  const paper = PAPER_SIZES.find((p) => p.id === (opts.paper ?? "auto"))?.css ?? "auto";
  const { width, height } = svgSize(svg);
  const fitted = stripSvgSize(svg).replace(/<svg\b/, `<svg width="100%" style="max-height:${opts.includeSource ? "70vh" : "92vh"};height:auto;display:block;margin:0 auto" preserveAspectRatio="xMidYMid meet"`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${paper}; margin: 12mm; }
  html, body { margin: 0; background: #fff; color: #111; font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  body { padding: 12mm; }
  h1 { font-size: 16px; font-weight: 600; margin: 0 0 10px; }
  figure { margin: 0; }
  .meta { font-size: 11px; color: #666; margin-top: 8px; }
  ul.notes { font-size: 12px; line-height: 1.5; margin: 10px 0 0; padding-left: 18px; page-break-inside: avoid; }
  pre { font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; border-top: 1px solid #ddd; padding-top: 8px; margin-top: 14px; page-break-inside: avoid; }
  @media print { body { padding: 0; } .meta { display: none; } }
</style>
</head>
<body>
${title ? `<h1>${escapeHtml(title)}</h1>` : ""}
<figure>${fitted}</figure>
<p class="meta">${Math.round(width)} × ${Math.round(height)} px · printed from bench.bozmoz.com</p>
${opts.notes ? `<ul class="notes">${opts.notes.split("\n").map((l) => `<li>${escapeHtml(l.replace(/^- /, ""))}</li>`).join("")}</ul>` : ""}
${opts.includeSource && opts.source ? `<pre>${escapeHtml(opts.source)}</pre>` : ""}
</body>
</html>`;
}

export const markdownFence = (code: string) => `\`\`\`mermaid\n${code.trim()}\n\`\`\``;

export const TITLE_RE = /^---\s*\n(?:[^\n]*\n)*?title:\s*(.+?)\s*\n(?:[^\n]*\n)*?---/;

/** Title from the front matter, or from a `title` line inside the diagram, else "". */
export function diagramTitle(code: string): string {
  const fm = code.match(TITLE_RE)?.[1];
  if (fm) return fm.replace(/^["']|["']$/g, "");
  const line = code.match(/^\s*title\s+(.+)$/m)?.[1];
  return line ? line.replace(/^["']|["']$/g, "").trim() : "";
}

/* ------------------------------------------------------------ annotations */

/**
 * Annotations sit on top of a rendered diagram. Positions are fractions of
 * the SVG's viewBox (0–1), so they stay put through zoom, pan, re-renders and
 * theme changes, and can be baked into the exported SVG at any size.
 */
export type Annotation =
  | { id: string; kind: "note"; x: number; y: number; text: string; color: AnnotationColor }
  | { id: string; kind: "check"; x: number; y: number; text: string; done: boolean }
  | { id: string; kind: "arrow"; x: number; y: number; x2: number; y2: number; text: string; color: AnnotationColor }
  | { id: string; kind: "highlight"; x: number; y: number; w: number; h: number; color: AnnotationColor }
  | { id: string; kind: "number"; x: number; y: number; n: number };

export type AnnotationColor = "yellow" | "red" | "green" | "blue";
export type AnnotationKind = Annotation["kind"];

export const ANNOTATION_COLORS: Record<AnnotationColor, { fill: string; stroke: string; text: string }> = {
  yellow: { fill: "#fff3a8", stroke: "#d9a400", text: "#4a3700" },
  red: { fill: "#ffd9d6", stroke: "#d8402f", text: "#5a1a12" },
  green: { fill: "#dcf2c9", stroke: "#4f8d1f", text: "#1f3d0b" },
  blue: { fill: "#d6e8ff", stroke: "#2f6fd1", text: "#102a52" },
};

/** Greyscale stand-ins for the annotation colours: distinguishable by shade, with black ink. */
export const MONO_COLORS: Record<AnnotationColor, { fill: string; stroke: string; text: string }> = {
  yellow: { fill: "#ffffff", stroke: "#000000", text: "#000000" },
  red: { fill: "#d9d9d9", stroke: "#000000", text: "#000000" },
  green: { fill: "#f0f0f0", stroke: "#000000", text: "#000000" },
  blue: { fill: "#e6e6e6", stroke: "#000000", text: "#000000" },
};

const ANN_ID_RE = /^[\w-]{1,32}$/;
const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1.5, Math.max(-0.5, v)) : null);

/** Keeps only well-formed annotations (positions are numbers, text is a string, kinds are known). */
export function sanitizeAnnotations(input: unknown): Annotation[] {
  if (!Array.isArray(input)) return [];
  const out: Annotation[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    const id = typeof a.id === "string" && ANN_ID_RE.test(a.id) ? a.id : null;
    const x = clamp01(a.x), y = clamp01(a.y);
    if (!id || x === null || y === null) continue;
    const text = typeof a.text === "string" ? a.text.slice(0, 500) : "";
    const color = (typeof a.color === "string" && a.color in ANNOTATION_COLORS ? a.color : "yellow") as AnnotationColor;
    switch (a.kind) {
      case "note":
        out.push({ id, kind: "note", x, y, text, color });
        break;
      case "check":
        out.push({ id, kind: "check", x, y, text, done: a.done === true });
        break;
      case "arrow": {
        const x2 = clamp01(a.x2), y2 = clamp01(a.y2);
        if (x2 !== null && y2 !== null) out.push({ id, kind: "arrow", x, y, x2, y2, text, color });
        break;
      }
      case "highlight": {
        const w = clamp01(a.w), h = clamp01(a.h);
        if (w !== null && h !== null && w > 0 && h > 0) out.push({ id, kind: "highlight", x, y, w, h, color });
        break;
      }
      case "number": {
        const n = typeof a.n === "number" && Number.isInteger(a.n) && a.n > 0 && a.n < 1000 ? a.n : null;
        if (n !== null) out.push({ id, kind: "number", x, y, n });
        break;
      }
    }
    if (out.length >= 200) break;
  }
  return out;
}

export const nextNumber = (list: Annotation[]) => list.reduce((m, a) => (a.kind === "number" ? Math.max(m, a.n) : m), 0) + 1;

/** Breaks text into lines of at most `max` characters, respecting explicit newlines. */
export function wrapText(text: string, max = 28): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (!line) line = word;
      else if (line.length + 1 + word.length <= max) line += " " + word;
      else {
        lines.push(line);
        line = word;
      }
      while (line.length > max) {
        lines.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/** Base unit for annotation geometry — roughly one line of text, sized to the diagram so notes stay legible on tall, wide and tiny drawings alike. */
export const annotationUnit = (width: number, height: number) => Math.max(11, Math.min(Math.max(width, height) / 45, Math.min(width, height) / 12));

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The annotation layer as SVG markup in the diagram's own coordinate space
 * (`width`/`height` are the viewBox size). Shared by the live overlay, print
 * and export so all three look the same. Sizes scale with the diagram so a
 * note stays readable on a huge Gantt and a tiny pie alike.
 */
export function annotationsSvg(list: Annotation[], width: number, height: number, opts: { interactive?: boolean; mono?: boolean } = {}): string {
  if (!list.length) return "";
  const u = annotationUnit(width, height);
  // Mono: every annotation colour becomes a grey, so the layer prints as cleanly as a print-theme diagram.
  const palette = (c: AnnotationColor) => (opts.mono ? MONO_COLORS[c] : ANNOTATION_COLORS[c]);
  const font = `font-family="ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"`;
  const parts: string[] = [];
  const hit = (a: Annotation) => (opts.interactive ? ` data-ann="${a.id}" style="cursor:move"` : "");
  for (const a of list) {
    const px = a.x * width, py = a.y * height;
    if (a.kind === "highlight") {
      const c = palette(a.color);
      parts.push(`<rect${hit(a)} x="${px}" y="${py}" width="${a.w * width}" height="${a.h * height}" rx="${u * 0.3}" fill="${c.fill}" fill-opacity="0.45" stroke="${c.stroke}" stroke-width="${u * 0.12}" stroke-dasharray="${u * 0.5} ${u * 0.3}"/>`);
    } else if (a.kind === "arrow") {
      const c = palette(a.color);
      const x2 = a.x2 * width, y2 = a.y2 * height;
      const ang = Math.atan2(y2 - py, x2 - px);
      const head = u * 0.9;
      const hx = x2 - head * Math.cos(ang), hy = y2 - head * Math.sin(ang);
      const left = `${hx + (head / 2) * Math.sin(ang)},${hy - (head / 2) * Math.cos(ang)}`, right = `${hx - (head / 2) * Math.sin(ang)},${hy + (head / 2) * Math.cos(ang)}`;
      parts.push(`<g${hit(a)}><line x1="${px}" y1="${py}" x2="${hx}" y2="${hy}" stroke="${c.stroke}" stroke-width="${u * 0.18}" stroke-linecap="round"/><polygon points="${x2},${y2} ${left} ${right}" fill="${c.stroke}"/>`);
      if (a.text) {
        const lines = wrapText(a.text, 24);
        const tw = Math.max(...lines.map((l) => l.length)) * u * 0.56 + u, th = lines.length * u * 1.25 + u * 0.6;
        const lx = px - tw / 2, ly = py - th - u * 0.4;
        parts.push(`<rect x="${lx}" y="${ly}" width="${tw}" height="${th}" rx="${u * 0.3}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${u * 0.08}"/>`);
        lines.forEach((l, i) => parts.push(`<text x="${px}" y="${ly + u * 0.45 + (i + 1) * u * 1.25 - u * 0.3}" text-anchor="middle" font-size="${u}" fill="${c.text}" ${font}>${esc(l)}</text>`));
      }
      parts.push(`</g>`);
    } else if (a.kind === "note") {
      const c = palette(a.color);
      const lines = wrapText(a.text || "…", 28);
      const tw = Math.max(...lines.map((l) => l.length)) * u * 0.56 + u * 1.2, th = lines.length * u * 1.25 + u * 0.9;
      parts.push(`<g${hit(a)}><path d="M${px + u * 0.5},${py + u * 0.9} l${u * 0.5},${-u * 0.9} l${u * 0.5},${u * 0.9}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${u * 0.08}"/><rect x="${px}" y="${py + u * 0.9}" width="${tw}" height="${th}" rx="${u * 0.3}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${u * 0.08}"/>`);
      lines.forEach((l, i) => parts.push(`<text x="${px + u * 0.6}" y="${py + u * 0.9 + u * 0.45 + (i + 1) * u * 1.25 - u * 0.3}" font-size="${u}" fill="${c.text}" ${font}>${esc(l)}</text>`));
      parts.push(`</g>`);
    } else if (a.kind === "check") {
      const lines = wrapText(a.text || "To do", 30);
      const box = u * 1.1;
      const tw = Math.max(...lines.map((l) => l.length)) * u * 0.56 + box + u * 1.2, th = Math.max(lines.length * u * 1.25, box) + u * 0.7;
      const fill = a.done ? (opts.mono ? "#e6e6e6" : "#dcf2c9") : "#ffffff", stroke = a.done ? (opts.mono ? "#000000" : "#4f8d1f") : (opts.mono ? "#000000" : "#6b7280");
      parts.push(`<g${hit(a)}><rect x="${px}" y="${py}" width="${tw}" height="${th}" rx="${u * 0.3}" fill="${fill}" fill-opacity="0.95" stroke="${stroke}" stroke-width="${u * 0.08}"/>`);
      parts.push(`<rect${opts.interactive ? ` data-check="${a.id}" style="cursor:pointer"` : ""} x="${px + u * 0.45}" y="${py + (th - box) / 2}" width="${box}" height="${box}" rx="${u * 0.2}" fill="#fff" stroke="${stroke}" stroke-width="${u * 0.1}"/>`);
      if (a.done) parts.push(`<path d="M${px + u * 0.7},${py + th / 2} l${u * 0.3},${u * 0.3} l${u * 0.55},${-u * 0.65}" fill="none" stroke="${opts.mono ? "#000000" : "#2f7a12"}" stroke-width="${u * 0.16}" stroke-linecap="round" stroke-linejoin="round" pointer-events="none"/>`);
      lines.forEach((l, i) => parts.push(`<text x="${px + box + u * 0.9}" y="${py + th / 2 - ((lines.length - 1) * u * 1.25) / 2 + i * u * 1.25 + u * 0.36}" font-size="${u}" fill="${a.done ? "#52606d" : "#111"}" ${a.done ? 'text-decoration="line-through"' : ""} ${font}>${esc(l)}</text>`));
      parts.push(`</g>`);
    } else if (a.kind === "number") {
      const r = u * 0.75;
      parts.push(`<g${hit(a)}><circle cx="${px}" cy="${py}" r="${r}" fill="${opts.mono ? "#000000" : "#d8402f"}" stroke="#fff" stroke-width="${u * 0.1}"/><text x="${px}" y="${py + u * 0.36}" text-anchor="middle" font-size="${u * 0.95}" font-weight="700" fill="#fff" ${font}>${a.n}</text></g>`);
    }
  }
  return `<g class="bench-annotations" ${font}>${parts.join("")}</g>`;
}

/** The diagram SVG with the annotation layer baked in, for print and export. */
export function annotatedSvg(svg: string, list: Annotation[], opts: { mono?: boolean } = {}): string {
  if (!list.length) return svg;
  const { width, height } = svgSize(svg);
  const layer = annotationsSvg(list, width, height, { mono: opts.mono });
  const close = svg.lastIndexOf("</svg>");
  return close < 0 ? svg : svg.slice(0, close) + layer + svg.slice(close);
}

/** Annotations as a compact, legible list — printed under the diagram and copied as Markdown. */
export function annotationsMarkdown(list: Annotation[]): string {
  const lines: string[] = [];
  for (const a of list) {
    if (a.kind === "check") lines.push(`- [${a.done ? "x" : " "}] ${a.text || "To do"}`);
    else if (a.kind === "note") lines.push(`- Note: ${a.text}`);
    else if (a.kind === "arrow" && a.text) lines.push(`- → ${a.text}`);
    else if (a.kind === "number") lines.push(`- (${a.n})`);
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------ print (B&W) */

/**
 * Theme variables for Mermaid's `base` theme that use no colour at all:
 * white fills, black lines and text, and a ladder of greys where diagrams
 * need to tell series or sections apart. Meaning never rides on hue, so a
 * greyscale printer or a photocopier loses nothing.
 */
const GREYS = ["#ffffff", "#e6e6e6", "#cccccc", "#b3b3b3", "#999999", "#808080", "#666666", "#4d4d4d", "#333333", "#1a1a1a", "#d9d9d9", "#bfbfbf"];
const onGrey = (g: string) => (parseInt(g.slice(1, 3), 16) < 0x80 ? "#ffffff" : "#000000");

export const PRINT_THEME_VARIABLES: Record<string, string | number | boolean> = {
  darkMode: false,
  background: "#ffffff",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif",
  primaryColor: "#ffffff",
  primaryTextColor: "#000000",
  primaryBorderColor: "#000000",
  secondaryColor: "#e6e6e6",
  secondaryTextColor: "#000000",
  secondaryBorderColor: "#000000",
  tertiaryColor: "#f5f5f5",
  tertiaryTextColor: "#000000",
  tertiaryBorderColor: "#000000",
  lineColor: "#000000",
  textColor: "#000000",
  mainBkg: "#ffffff",
  nodeBorder: "#000000",
  nodeTextColor: "#000000",
  clusterBkg: "#f5f5f5",
  clusterBorder: "#000000",
  titleColor: "#000000",
  edgeLabelBackground: "#ffffff",
  defaultLinkColor: "#000000",
  arrowheadColor: "#000000",
  // sequence
  actorBkg: "#ffffff",
  actorBorder: "#000000",
  actorTextColor: "#000000",
  actorLineColor: "#000000",
  signalColor: "#000000",
  signalTextColor: "#000000",
  labelBoxBkgColor: "#e6e6e6",
  labelBoxBorderColor: "#000000",
  labelTextColor: "#000000",
  loopTextColor: "#000000",
  noteBkgColor: "#f5f5f5",
  noteBorderColor: "#000000",
  noteTextColor: "#000000",
  activationBkgColor: "#e6e6e6",
  activationBorderColor: "#000000",
  sequenceNumberColor: "#ffffff",
  // gantt
  sectionBkgColor: "#f0f0f0",
  sectionBkgColor2: "#ffffff",
  altSectionBkgColor: "#ffffff",
  taskBkgColor: "#d9d9d9",
  taskBorderColor: "#000000",
  taskTextColor: "#000000",
  taskTextDarkColor: "#000000",
  taskTextLightColor: "#000000",
  taskTextOutsideColor: "#000000",
  activeTaskBkgColor: "#999999",
  activeTaskBorderColor: "#000000",
  doneTaskBkgColor: "#ffffff",
  doneTaskBorderColor: "#000000",
  critBkgColor: "#4d4d4d",
  critBorderColor: "#000000",
  todayLineColor: "#000000",
  taskTextClickableColor: "#000000",
  gridColor: "#bfbfbf",
  excludeBkgColor: "#eeeeee",
  // state & class
  transitionColor: "#000000",
  transitionLabelColor: "#000000",
  stateLabelColor: "#000000",
  stateBkg: "#ffffff",
  stateBorder: "#000000",
  compositeBackground: "#f5f5f5",
  compositeTitleBackground: "#e6e6e6",
  compositeBorder: "#000000",
  altBackground: "#f5f5f5",
  specialStateColor: "#000000",
  classText: "#000000",
  relationColor: "#000000",
  relationLabelColor: "#000000",
  relationLabelBackground: "#ffffff",
  // er
  attributeBackgroundColorOdd: "#ffffff",
  attributeBackgroundColorEven: "#f0f0f0",
  // requirement
  requirementBackground: "#ffffff",
  requirementBorderColor: "#000000",
  requirementTextColor: "#000000",
  relationLabelBackgroundReq: "#ffffff",
  // git
  commitLabelColor: "#000000",
  commitLabelBackground: "#ffffff",
  tagLabelColor: "#000000",
  tagLabelBackground: "#ffffff",
  tagLabelBorder: "#000000",
  // pie & charts
  pieStrokeColor: "#000000",
  pieOuterStrokeColor: "#000000",
  pieTitleTextColor: "#000000",
  pieSectionTextColor: "#000000",
  pieLegendTextColor: "#000000",
  quadrant1Fill: "#ffffff",
  quadrant2Fill: "#f0f0f0",
  quadrant3Fill: "#e0e0e0",
  quadrant4Fill: "#f8f8f8",
  quadrant1TextFill: "#000000",
  quadrant2TextFill: "#000000",
  quadrant3TextFill: "#000000",
  quadrant4TextFill: "#000000",
  quadrantPointFill: "#000000",
  quadrantPointTextFill: "#000000",
  quadrantXAxisTextFill: "#000000",
  quadrantYAxisTextFill: "#000000",
  quadrantInternalBorderStrokeFill: "#000000",
  quadrantExternalBorderStrokeFill: "#000000",
  quadrantTitleFill: "#000000",
  // mindmap / timeline / architecture
  archEdgeColor: "#000000",
  archEdgeArrowColor: "#000000",
  archGroupBorderColor: "#000000",
  // journey / misc
  fillType0: "#ffffff",
  fillType1: "#e6e6e6",
  fillType2: "#cccccc",
  fillType3: "#b3b3b3",
  fillType4: "#999999",
  fillType5: "#808080",
  fillType6: "#666666",
  fillType7: "#4d4d4d",
  errorBkgColor: "#ffffff",
  errorTextColor: "#000000",
  labelColor: "#000000",
  personBkg: "#ffffff",
  personBorder: "#000000",
  rowOdd: "#ffffff",
  rowEven: "#f0f0f0",
};

/** Diagram-level config for the print theme: colours that live outside the theme variables. */
export const PRINT_DIAGRAM_CONFIG = {
  journey: { actorColours: ["#000000", "#666666", "#999999", "#333333", "#b3b3b3", "#4d4d4d"], sectionFills: ["#e6e6e6", "#cccccc", "#f0f0f0", "#d9d9d9", "#bfbfbf"], sectionColours: ["#000000"] },
  sequence: { labelBoxBkgColor: "#e6e6e6", labelBoxBorderColor: "#000000" },
};
for (let i = 0; i < 12; i++) {
  PRINT_THEME_VARIABLES[`pie${i + 1}`] = GREYS[i];
  PRINT_THEME_VARIABLES[`cScale${i}`] = GREYS[i];
  PRINT_THEME_VARIABLES[`cScaleLabel${i}`] = onGrey(GREYS[i]);
  if (i < 8) {
    PRINT_THEME_VARIABLES[`git${i}`] = GREYS[i];
    PRINT_THEME_VARIABLES[`gitBranchLabel${i}`] = onGrey(GREYS[i]);
  }
}

/** Starter diagram written so that shape, line style and labels — never colour — carry the meaning. */

/**
 * Last-resort greyscale pass for diagram types that ignore theme variables
 * (Mermaid 12's user-journey renderer hard-codes its actor and section
 * colours). Every colour in a fill/stroke attribute or inline style becomes
 * a grey of the same lightness, so distinctions survive as shades.
 */
export function greyscaleSvg(svg: string): string {
  const toGrey = (hex: string): string => {
    const h = hex.length === 4 ? hex.replace(/[0-9a-f]/gi, (c) => c + c) : hex;
    const r = parseInt(h.slice(1, 3), 16), g = parseInt(h.slice(3, 5), 16), b = parseInt(h.slice(5, 7), 16);
    if (Math.max(r, g, b) - Math.min(r, g, b) <= 8) return hex;
    const y = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
    // Keep fills readable: very light stays light, mid tones spread out, dark stays dark.
    const v = Math.round(Math.min(230, Math.max(40, y))).toString(16).padStart(2, "0");
    return `#${v}${v}${v}`;
  };
  const named: Record<string, string> = { crimson: "#4d4d4d", lightgrey: "#d3d3d3", lightgray: "#d3d3d3", navy: "#333333", teal: "#666666", orange: "#999999", red: "#4d4d4d", green: "#666666", blue: "#4d4d4d", yellow: "#d9d9d9", purple: "#4d4d4d" };
  return svg.replace(/(\b(?:fill|stroke)\s*[:=]\s*["']?)(#[0-9a-f]{3,6}|[a-z]+)\b/gi, (m, pre: string, c: string) => {
    if (c.startsWith("#")) return pre + toGrey(c);
    const lower = c.toLowerCase();
    return named[lower] ? pre + named[lower] : m;
  });
}
