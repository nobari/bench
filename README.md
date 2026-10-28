<div align="center">

<a href="https://bench.bozmoz.com">![Bench — everyday tools for text, data, images and the web](docs/banner.svg)</a>

<p>
  <a href="https://bench.bozmoz.com"><img alt="bench.bozmoz.com" src="https://img.shields.io/badge/live-bench.bozmoz.com-232327?style=flat-square&labelColor=1c2414"></a>
  <a href="#tools"><img alt="57 tools" src="https://img.shields.io/badge/tools-57-68a52a?style=flat-square&labelColor=1c2414"></a>
  <a href="https://nextjs.org"><img alt="Next.js 16" src="https://img.shields.io/badge/Next.js-16-1e2419?style=flat-square&logo=nextdotjs&logoColor=white&labelColor=1c2414"></a>
  <a href="https://react.dev"><img alt="React 19" src="https://img.shields.io/badge/React-19-149eca?style=flat-square&logo=react&logoColor=white&labelColor=1c2414"></a>
  <a href="https://www.typescriptlang.org"><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-5-3178c6?style=flat-square&logo=typescript&logoColor=white&labelColor=1c2414"></a>
  <a href="https://tailwindcss.com"><img alt="Tailwind CSS 4" src="https://img.shields.io/badge/Tailwind-4-38bdf8?style=flat-square&logo=tailwindcss&logoColor=white&labelColor=1c2414"></a>
  <a href="#license"><img alt="MIT License" src="https://img.shields.io/badge/license-MIT-8b958d?style=flat-square&labelColor=1c2414"></a>
</p>

**A growing collection of browser-based developer utilities — most processing stays on your device.**<br/>
No Bench account required. Sharing and network features use online services; see the About page for data handling.
<br/>
**Live at [bench.bozmoz.com](https://bench.bozmoz.com)**

</div>

---

Bench is the kind of small tools you reach for a dozen times a day — encode something, inspect some JSON, turn a few images into a GIF, convert a date into the Hijri calendar — all in one cohesive, keyboard-driven workbench. Most processing happens locally with a registry-driven architecture, so adding a tool is a one-file change.

## Highlights

- 🔒 **Private by default** — most tools execute in the browser (Web Workers / WASM where needed). Shortened share links store full destination URLs on the server; wallet network features contact external providers. Analytics and performance services receive usage data.
- 🔗 **Shareable by URL** — inputs and settings live in the address bar (or a compressed hash for large payloads), so any result is one copy-paste away. Share links longer than 2,000 characters are shortened automatically.
- ⌘ **Minimum-action access** — a global **⌘K** command palette searches and jumps to any tool from anywhere.
- 🔎 **SEO / GEO / LLM-ready** — static generation, per-tool metadata, JSON-LD (`SoftwareApplication`, `BreadcrumbList`, `FAQPage`), `sitemap.xml`, `robots.txt`, and machine-readable [`/llms.txt`](https://llmstxt.org) + `/llms-full.txt`.
- 🧩 **Registry-driven** — one typed array generates routes, the category → group → tool navigation tree, command palette, sitemap, OG images, redirects for moved tools, and AI-discovery files.
- 🧰 **Built like a tool, not a landing page** — every tool is one click away in a persistent index, each page has a single primary Share action, and the light/dark palette follows your system.

## Tools

> 58 tools across 11 categories, each split into groups — and counting.

| Category | Tools |
| --- | --- |
| **Text & Encoding** (`/text`) | *Encoding:* Text Transformer · Base64 · URL Encode & Decode · HTML Entities · Gzip / Deflate — *Case & characters:* Case Converter · ASCII Table — *Scripts & languages:* Full-width ↔ Half-width · Katakana ↔ Hiragana · Finglish → Farsi · Romaji ↔ Kana |
| **JSON & Data** (`/json`) | JSON Viewer · JSON Schema |
| **Images & Video** (`/media`) | *Images:* Image Converter · Base64 image · Content Credentials (C2PA) — *GIFs & stickers:* GIF Maker · TGS Stickers — *Video:* Video editor · MP4 tags · Slow-mo to normal speed — *QR codes:* QR & barcode scanner · QR Code Generator |
| **Audio & Music** (`/audio`) | *Audio files:* Audio converter · Audio bitrate & size — *Music math:* Note ↔ frequency · BPM ↔ ms · Transpose chords · Decibels · Semitones ↔ cents |
| **Files & Archives** (`/files`) | *Archives:* Archive Extractor · Archive Creator — *Readers:* Comic Reader — *Documents:* PDF Studio — *Storage:* Storage & Card Doctor |
| **Crypto & Hashing** (`/crypto`) | *Hashing & signatures:* Hash Generator · ECDSA Sign & Verify — *Ethereum:* EIP-55 Checksum · Wallet Generator |
| **Generators** (`/generators`) | *Identifiers & passwords:* UUID & NanoID · Password Generator — *Randomness:* Random Generator · Lucky Draw |
| **Time & Date** (`/time`) | *Dates & timestamps:* Unix Timestamp · Date Converter · Day Calculator — *Schedules:* Cron — *Sky & astronomy:* Earth, Sun & Moon · Sun–Earth–Moon scale |
| **Color & Design** (`/color`) | Color Converter · Palette Generator |
| **Math & Units** (`/math`) | *Converters:* Number Base Converter · Unit Converter — *Calculators:* Loan Simulator |
| **Web & Dev** (`/web`) | *Editors:* Markdown Editor · Mermaid editor — *Developer tools:* Diff · Regex · JWT · URL shortener |

Adding a tool is a one-file change — see the add-tool skill in `.claude/skills`.

Each release bumps `version` in `package.json`; the footer shows it with the deployed commit so you can tell which release a page is.

## Tech stack

| | |
| --- | --- |
| **Framework** | [Next.js 16](https://nextjs.org) (App Router, React 19, RSC) + Turbopack |
| **Language** | TypeScript |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com) with CSS-variable theming |
| **URL state** | [nuqs](https://nuqs.47ng.com) + [lz-string](https://github.com/pieroxy/lz-string) for large payloads |
| **Command palette** | [cmdk](https://cmdk.paco.me) |
| **Motion** | [Motion](https://motion.dev) |
| **Notable libs** | `gifenc` (GIF encoding in a Web Worker), `qr-code-styling`, `@noble/curves` + `@scure/bip39/bip32` (wallets), `js-sha3` / `js-md5` (hashing) |
| **Hosting** | [Vercel](https://vercel.com) — static + edge, free on the Hobby plan |

## Getting started

```bash
git clone https://github.com/nobari/bench.git
cd bench
pnpm install
pnpm dev          # http://localhost:3000
```

Other scripts:

```bash
pnpm build        # production build (static-generates every tool page)
pnpm start        # serve the production build
pnpm lint         # eslint
pnpm typecheck    # TypeScript
pnpm test         # indexing and browser regression checks (build first; uses installed Chrome)
```

> Requires Node.js 20+ and [pnpm](https://pnpm.io). The repo uses pnpm, but npm/yarn work too.

## Adding a tool

The whole app is generated from one registry, so a new tool is a single entry plus a widget:

1. **Logic** — a pure, SSR-safe module under `lib/tools/…`.
2. **Widget** — a `"use client"` component in `components/widgets/` that reads/writes shareable state via `nuqs`. Register it in `components/tool-mount.tsx`.
3. **Registry** — append a `ToolDef` to `lib/tools/registry.ts` with its slug, copy, keywords, FAQ and which widget to mount.

That's it — the route, command-palette entry, sitemap, `llms.txt`, JSON-LD and related-tool links all update automatically. A full walkthrough lives in [`.claude/skills/add-tool/SKILL.md`](.claude/skills/add-tool/SKILL.md).

## Project structure

```
app/                 # App Router: home, [category], [category]/[tool], sitemap, robots, llms.txt
components/
  widgets/           # the interactive tool UIs (lazy-loaded, client-side)
  …                  # command palette, header/footer, shared primitives
lib/
  tools/
    registry.ts      # ← the single source of truth for every tool
    categories.ts    # category definitions + accent colors
    …                # pure logic per domain (text, json, color, crypto, math, time)
  seo.ts             # JSON-LD builders
docs/                # banner + assets
```

## Environment variables

Copy `.env.example` to `.env.local`. All are optional — the app runs fully without them.

| Variable | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Overrides the canonical URL for metadata/sitemap/OG. Defaults to `https://bench.bozmoz.com` in every environment. Preview builds are noindex. |
| `NEXT_PUBLIC_GA_ID` | Google Analytics 4 measurement ID. Unset = no analytics. Page views are sent without query strings; DNT/GPC browsers are excluded. |
| `GITHUB_REPO` | `owner/repo` that receives "Suggest a tool" issues. |
| `GITHUB_TOKEN` | Fine-grained PAT with **Issues: write**. Without it, the suggest form falls back to opening a prefilled GitHub issue. |

## Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/nobari/bench)

Import the repo into Vercel — it auto-detects Next.js. Every tool page is statically generated and served from the edge; server routes also handle short-link storage and redirects, machine-readable references, and suggestions. Set the env vars above in the project settings if you want the GitHub-issue integration.

## Contributing

Missing a tool? Open an issue with the **`tool-suggestion`** label (or use the in-app **Suggest a tool** form). PRs that add a tool via the registry are very welcome — see [Adding a tool](#adding-a-tool).

## License

[MIT](LICENSE) © [Sadegh Nobari](https://github.com/nobari)

<div align="center"><sub>Built for the browser · Open source · Local processing where possible</sub></div>


## Google indexing audit — October 20, 2026

1. **Crawl accessibility:** all 74 production sitemap URLs returned HTTP 200, indexable metadata, one H1 and a self-canonical in the baseline audit. Tests crawl the complete registry, including 60 tools and 11 categories, without JavaScript.
2. **Canonical consolidation:** canonicals now default to the public origin in all environments; preview hostnames and localhost no longer leak into sitemap, schema or metadata. Explicit origin overrides are validated. Query-string variants keep their clean tool canonical.
3. **Preview exclusion:** Vercel previews receive noindex metadata and an X-Robots-Tag header. Private previews still require deployment protection; noindex is not access control.
4. **Embed and utility exclusion:** robots.txt allows fetching embeds so Google can see noindex. Embeds, short links (including missing-link responses), and API routes carry noindex headers; they stay out of the sitemap.
5. **Sitemap accuracy:** removed build-time lastmod values. Dates are optional; introduce them only when actual per-page changes are tracked. Registry-generated canonical URLs remain the source of truth.
6. **Page metadata:** shared generation keeps tool, category, About and Suggest metadata specific to the page, preserving the Bench site name and locale. Tool pages use the website Open Graph type rather than article.
7. **Structured data accuracy:** removed the nonfunctional `/?q=` SearchAction. Website identity, breadcrumbs, software descriptions and visible FAQs remain. No fabricated ratings were added; structured data does not guarantee rich results.
8. **Search and sharing images:** added a 1200×630 generated Open Graph image and allowed large image previews. The test checks the actual PNG response and image metadata.
9. **Useful visible content:** preserved server-rendered instructions, FAQs and discovery links; added a no-JavaScript explanation for interactive tools. Corrected blanket client-only/privacy claims in the homepage, footer, About page and machine-readable index to disclose sharing and network exceptions.
10. **Regression checks and Search Console follow-up:** automated tests cover all sitemap URLs, metadata uniqueness, canonical consistency, HTML content, discovery links, JSON-LD, moved-route 308s, real 404s, embed exclusions and mobile layouts. Build, lint and type checks are release gates.

Validation: production build, lint and TypeScript checks passed; seven browser/regression tests passed (one duplicate full-crawl mobile test is intentionally skipped). A separate preview build verified noindex metadata and headers, production-domain canonicals and crawlable robots rules. The generated image was rendered and visually checked.

Search Console: the parent `sc-domain:bozmoz.com` property was observed earlier in this session reporting a “Deceptive pages” security issue with no sample URLs. This is a domain-level observation, not evidence identifying Bench as the cause. These SEO changes do not establish remediation. Bench-specific indexing counts and sitemap submission must be verified in Search Console; production HTTP checks are not Google's URL Inspection results.

Use the verified domain property to submit `https://bench.bozmoz.com/sitemap.xml` if it is not already submitted. Inspect representative tool URLs and Google-selected canonicals. Investigate the reported security issue before requesting a security review; do not assert it is fixed without evidence.

References: [Google technical requirements](https://developers.google.com/search/docs/essentials/technical), [noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing), [sitemap dates](https://developers.google.com/search/docs/crawling-indexing/sitemaps/build-sitemap), [canonical URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls).
