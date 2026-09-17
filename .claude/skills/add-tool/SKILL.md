---
name: add-tool
description: >-
  Add a new tool/utility to the Bench tools site. Comprehensive guide covering
  the tool registry, interactive widget, routing, URL state, the design system,
  SEO/GEO/llms.txt, lint rules, and verification. Use whenever adding, creating,
  scaffolding, or wiring up a new tool, converter, encoder, generator, or
  utility in this repository.
---

# Adding a tool to Bench

Bench is **registry-driven**: one typed array generates routes, the ⌘K command
palette, the sitemap, `robots.txt`, `/llms.txt` + `/llms-full.txt`, JSON-LD, and
all metadata. Adding a tool is mostly **data entry plus one client component**.

> Everything runs **client-side** — no server compute on tools. Keep it that way
> (privacy + free on Vercel Hobby). Heavy work goes in a Web Worker.

## The 5 steps (TL;DR)

1. **Pick a category** (`lib/tools/categories.ts`). Add one only if needed.
2. **Write the logic** as a pure module in `lib/tools/<category>/<name>.ts`.
3. **Build the widget** (`components/widgets/<name>.tsx`, `"use client"`), using
   `nuqs` for URL state and the design-system classes.
4. **Register the widget**: add a `WidgetKey` in `lib/tools/types.ts` and an
   entry in `components/tool-mount.tsx`.
5. **Register the tool**: append a `ToolDef` to `lib/tools/registry.ts`.

Then `pnpm lint && pnpm build`, and verify in the browser. Routes, palette,
sitemap, llms.txt, JSON-LD and related-tool links update automatically.

If your tool is just another **text transform**, you may not need steps 2–4 at
all — see [Shortcut: a new text transform](#shortcut-a-new-text-transform).

---

## Step 1 — Category

Categories live in `lib/tools/categories.ts` as a `Category[]` (slug, name,
tagline, description, `icon`, `accentVar`). The slug is the first URL segment
(`/<category>/<slug>`). Current slugs: `text`, `json`, `image`, `crypto`,
`generators`, `time`, `color`, `web`.

**To add a new category:**
1. Add a `Category` object (pick a `lucide-react` icon).
2. Choose an `accentVar` like `--cat-foo` and define it in `app/globals.css`
   under `:root` (a hex color). This drives the per-category accent.
3. The category landing page, footer and nav pick it up automatically.

The accent is exposed to tool/category pages as `var(--accent)` — components use
`text-accent`, `bg-accent`, `border-accent`, and `accent-[var(--accent)]`.

---

## Step 2 — Tool logic (pure module)

Put pure logic in `lib/tools/<category>/<name>.ts`. Rules:

- **Pure & deterministic** where possible — deterministic output is what makes
  results shareable via the URL.
- **SSR-safe**: this module may be imported in server contexts indirectly. Don't
  touch `window`/`document` at module scope. (Browser-only work belongs in the
  widget, which is `ssr: false`.)
- Keep it framework-free and unit-testable. Return `{ ok, value } | { ok:false,
  error }` shapes for fallible operations so the widget can show inline errors
  (see `lib/tools/text/transforms.ts` → `runTransform`).

Examples to mirror: `lib/tools/text/transforms.ts`, `lib/tools/json/utils.ts`,
`lib/tools/color/convert.ts`, `lib/tools/crypto/hash.ts`, `lib/tools/web/diff.ts`.

---

## Step 3 — The widget (`components/widgets/<name>.tsx`)

Start the file with `"use client"`. Widgets are mounted lazily with
`ssr: false`, so the browser APIs are available — **but all crawlable SEO text
lives in the server-rendered `ToolShell`, not here.** Keep the widget purely
interactive.

### URL state with `nuqs` (shareability)

Read/write shared state with `useQueryState` so any result is a link:

```tsx
import { useQueryState, parseAsString, parseAsInteger } from "nuqs";

const [input, setInput] = useQueryState(
  "i",
  parseAsString.withDefault("").withOptions({ history: "replace", throttleMs: 300 }),
);
```

- Use `history: "replace"` (don't spam browser history) and `throttleMs` for
  text inputs.
- **Param-name conventions** (keep them short & consistent): `i` = primary
  input, `t` = transform id, `c` = color, `a`/`b` = diff sides, `kind`/`n` =
  id generator, `fmt`/`q`/`w` = image options, `ec` = QR error-correction.
- **Large payloads** (big JSON/text) must NOT bloat the query string. Keep them
  in local state and offer a "Share" that compresses into the URL hash with
  `lz-string` — see `components/widgets/json-viewer.tsx` (`readInitial` +
  `compressToEncodedURIComponent`).

### Design system (match the "Precision Instrument" look)

Reuse these utilities (defined in `app/globals.css`) so the tool looks native:

- `panel` — bordered surface card. Add `registered` for corner registration marks.
- `readout` — uppercase mono micro-label. `tabular` — tabular numerals.
- `bg-ticks` / `bg-instrument` — fine grid backgrounds. `glow`, `blink`, `rise`.
- `input` — shared form-field style (inputs, selects, textareas).
- Colors: `text-ink` / `text-muted` / `text-faint`, `border-edge`,
  `bg-surface` / `bg-raised` / `bg-base`, status `text-positive|warn|danger`.
- **Accent**: use `text-accent` / `bg-accent` / `border-accent` and
  `accent-[var(--accent)]` for range inputs. The page sets `--accent` per
  category — never hard-code a category color in a widget.
- Primary action buttons: `bg-accent text-on-accent font-medium` (vivid matcha fill with dark text; `text-accent` is the deeper readable green).

Reusable components: `CopyButton` (`@/components/copy-button`), `ShareButton`
(`@/components/share-button`, copies the current URL), and the `Button`
primitive (`@/components/ui/button`).

### Heavy work → Web Worker

For CPU-heavy work (encoding, large transforms) use a worker so the UI stays
responsive. Pattern (see `components/widgets/gif.worker.ts` + `gif-maker.tsx`):

```ts
// Classic worker — Turbopack's worker bootstrap uses importScripts, which `type: "module"` forbids.
const worker = new Worker(new URL("./my.worker.ts", import.meta.url));
```

Transfer large `ArrayBuffer`s (don't copy). If the worker imports an untyped
package, add a declaration in `types/<pkg>.d.ts` (see `types/gifenc.d.ts`).

### Lint rules you MUST respect (React Compiler is on)

These are **errors**, not warnings:

- **`react-hooks/purity`** — no impure calls during render (no
  `crypto.getRandomValues`, `Date.now()`, `Math.random()` in render/`useMemo`).
- **`react-hooks/set-state-in-effect`** — no *synchronous* `setState` in an
  effect body.

For "generate random/now on mount + on change", run it in a **deferred effect
callback** so it's neither during render nor a synchronous effect setState:

```tsx
useEffect(() => {
  let active = true;
  queueMicrotask(() => { if (active) setIds(generate(/* uses Date.now()/crypto */)); });
  return () => { active = false; };
}, [deps]);
```

Async work (`fetch`, `crypto.subtle.digest`, `QRCode.toDataURL`) is fine because
the `setState` happens in a `.then` callback — see
`components/widgets/hash-generator.tsx`.

---

## Step 4 — Register the widget

1. `lib/tools/types.ts` — add your key to the `WidgetKey` union.
2. `components/tool-mount.tsx` — add a lazy entry to `WIDGETS`:

```tsx
"my-widget": dynamic(
  () => import("@/components/widgets/my-widget").then((m) => m.MyWidget),
  { ssr: false, loading: Skeleton },
),
```

Many tools can share one widget via `widgetProps` (e.g. every text-encoding page
reuses `text-transform` with a different `preset`).

---

## Step 5 — Register the tool (`lib/tools/registry.ts`)

Append a `ToolDef`. This is the SEO/GEO surface — write it well:

```tsx
{
  slug: "my-tool",                 // unique within its category; the URL segment
  category: "web",
  title: "My Tool",                // H1 + <title>
  tagline: "One-line pitch shown on cards and under the H1",
  description: "~150-char meta description / GEO answer opener.",
  keywords: ["primary phrase", "synonyms", "what people search"],
  icon: SomeLucideIcon,            // import at top; lucide dropped brand icons
  status: "stable",                // or "beta"
  widget: "my-widget",
  widgetProps: { /* optional, passed to the widget */ },
  howItWorks: "Crawlable prose for SEO/GEO — what it does and how, plainly.",
  faq: [{ q: "...", a: "..." }],   // becomes FAQPage JSON-LD
  examples: [{ label: "Try X", query: "i=hello" }], // deep links into the tool
  related: ["category/slug"],      // fully-qualified ids of related tools
  aliases: ["alt search terms"],   // extra command-palette/search matches
}
```

**SEO/GEO checklist for the copy:**
- `keywords` + `aliases` should cover the real phrases people search (including
  non-English where relevant — see the Japanese terms on `text/full-width`).
- `howItWorks` and `faq` are answer-style content that LLMs cite — write them to
  directly answer the obvious questions. They feed `/llms-full.txt`.
- `examples` deep-link with a `query` string (no leading `?`) and must use the
  same param names the widget reads.
- `related` improves internal linking; reference real `category/slug` ids.

What you get for free: the route `/<category>/<slug>` (SSG), a ⌘K palette entry,
sitemap + llms.txt entries, `SoftwareApplication` + `BreadcrumbList` + `FAQPage`
JSON-LD, breadcrumbs, related-tool cards, and per-tool metadata/OG.

---

## Shortcut: a new text transform

If the tool is just another string→string transform, add it to the `TRANSFORMS`
array in `lib/tools/text/transforms.ts` (id, label, group, summary, `fn`,
optional `inverse`). It is then:
- available in the Text Transformer's picker immediately, and
- deep-linkable at `/text/transform?t=<id>&i=<input>`.

To give it a dedicated SEO page, add a `ToolDef` (step 5) with
`widget: "text-transform"` and `widgetProps: { preset: "<id>", featured: ["<id>", ...] }`
— no new widget needed.

---

## Verify (do not skip)

```bash
pnpm lint     # must be clean — purity & set-state-in-effect are errors
pnpm build    # type-checks + statically generates every tool page
pnpm dev      # then open the tool and exercise it
```

Manual checks:
- Open `/<category>/<slug>` — widget mounts, no console errors.
- A deep link (`?...`) pre-fills input **and** produces the right output.
- The **Share** button copies a URL that reproduces the state.
- The tool appears in ⌘K search and in `/llms.txt`.
- For correctness-critical tools (hashes, checksums, conversions), verify
  against a known value.

## Gotchas

- **Slug uniqueness** is per category. `image/converter` and `color/converter`
  coexist fine; two tools in the same category can't share a slug.
- **Unknown routes 404** — `dynamicParams = false` on the `[category]` and
  `[category]/[tool]` routes; only registered tools render.
- **lucide brand icons were removed** (no `Github`). For brand glyphs, inline an
  SVG (see `components/icons.tsx`).
- **Untyped worker deps** need a `types/*.d.ts` declaration.
- **Don't put big inputs in the query string** — compress to the URL hash.
- Keep tool logic **out of the widget** where it's reusable and testable.
