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
  if (!/xmlns=/.test(out)) out = out.replace(/<svg\b/, '<svg xmlns="http://www.w3.org/2000/svg"');
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
export function printableHtml(title: string, svg: string, opts: { paper?: PaperSize; includeSource?: boolean; source?: string } = {}): string {
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
  pre { font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; border-top: 1px solid #ddd; padding-top: 8px; margin-top: 14px; page-break-inside: avoid; }
  @media print { body { padding: 0; } .meta { display: none; } }
</style>
</head>
<body>
${title ? `<h1>${escapeHtml(title)}</h1>` : ""}
<figure>${fitted}</figure>
<p class="meta">${Math.round(width)} × ${Math.round(height)} px · printed from bench.bozmoz.com</p>
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
