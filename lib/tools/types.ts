import type { LucideIcon } from "lucide-react";

/** Stable category identifiers — also the first URL segment (e.g. /text/base64). */
export type CategorySlug =
  | "text"
  | "json"
  | "image"
  | "audio"
  | "crypto"
  | "generators"
  | "time"
  | "color"
  | "math"
  | "files"
  | "web";

export interface Category {
  slug: CategorySlug;
  name: string;
  /** One-line summary shown on cards and category landing. */
  tagline: string;
  /** Longer description for the category page + SEO. */
  description: string;
  icon: LucideIcon;
  /** CSS custom property name carrying this category's accent hue. */
  accentVar: `--cat-${string}`;
}

export interface FaqItem {
  q: string;
  a: string;
}

/** A deep link demonstrating the tool with pre-filled inputs. */
export interface ToolExample {
  label: string;
  /** Query string (without leading "?") applied to the tool route. */
  query: string;
}

/**
 * Which interactive widget a tool entry mounts. Many SEO tool pages can reuse a
 * single widget with different `widgetProps`, decoupling routes from components.
 */
export type WidgetKey =
  | "text-transform"
  | "finglish-converter"
  | "romaji-converter"
  | "short-url"
  | "json-viewer"
  | "json-schema"
  | "gif-maker"
  | "hash-generator"
  | "id-generator"
  | "timestamp-converter"
  | "cron"
  | "color-converter"
  | "palette-generator"
  | "image-converter"
  | "base64-image"
  | "provenance"
  | "audio-converter"
  | "note-frequency"
  | "bpm-calculator"
  | "transposer"
  | "audio-units"
  | "slow-mo"
  | "diff-checker"
  | "regex-tester"
  | "jwt"
  | "qr-code"
  | "qr-scanner"
  | "comic-reader"
  | "tgs-studio"
  | "text-compress"
  | "markdown-editor"
  | "archive-extract"
  | "archive-create"
  | "date-converter"
  | "day-calculator"
  | "password-generator"
  | "ecdsa"
  | "loan-simulator"
  | "lucky-draw"
  | "random-generator"
  | "base-converter"
  | "unit-converter"
  | "ascii-generator"
  | "wallet-generator";

/**
 * The unit of expansion. Adding a tool = appending one of these to the registry.
 * Routing, search, sitemap, llms.txt, JSON-LD and OG images all derive from it.
 */
export interface ToolDef {
  /** Unique within its category; second URL segment. */
  slug: string;
  category: CategorySlug;
  /** Human title, used as H1 and <title>. */
  title: string;
  /** Short name for navigation and lists; defaults to the title without a parenthetical. */
  short?: string;
  /** Short pitch shown on cards and under the H1. */
  tagline: string;
  /** ~150 char meta description / GEO answer opener. */
  description: string;
  /** Search + SEO keywords (and command-palette matches). */
  keywords: string[];
  icon: LucideIcon;
  status: "stable" | "beta";
  /** Interactive component to mount. */
  widget: WidgetKey;
  /** Props handed to the widget (e.g. a preset transform). */
  widgetProps?: Record<string, unknown>;
  /** Crawlable “how it works” prose for GEO. */
  howItWorks?: string;
  faq?: FaqItem[];
  examples?: ToolExample[];
  /** `category/slug` ids of related tools. */
  related?: string[];
  /** Extra search aliases. */
  aliases?: string[];
  /** Newer-than badge / sort hint (ISO date). */
  added?: string;
}

/** Convenience: fully-qualified tool id. */
export function toolId(t: Pick<ToolDef, "category" | "slug">): string {
  return `${t.category}/${t.slug}`;
}

/** Short name for navigation and lists. */
export function toolShortTitle(t: Pick<ToolDef, "title" | "short">): string {
  return t.short ?? t.title.replace(/\s*\(.*?\)\s*$/, "");
}
