import {
  Music,
  Binary,
  Braces,
  Image as ImageIcon,
  KeyRound,
  Sparkles,
  Clock,
  Palette,
  Globe,
  Calculator,
  Archive,
} from "lucide-react";
import type { Category, CategorySlug } from "./types";

/** Ordered for the homepage rail. */
export const CATEGORIES: Category[] = [
  {
    slug: "text",
    name: "Text & Encoding",
    tagline: "Encode, decode, convert and reshape text",
    description:
      "Base64, URL and HTML encoding, case conversion, full-width / half-width, address checksums, and 40+ other text transforms — instant and reversible.",
    icon: Binary,
    accentVar: "--cat-text",
  },
  {
    slug: "json",
    name: "JSON & Data",
    tagline: "Inspect, format and convert structured data",
    description:
      "A professional JSON viewer with virtualized trees, JSONPath search, validation and conversion between JSON, YAML, CSV and more.",
    icon: Braces,
    accentVar: "--cat-json",
  },
  {
    slug: "image",
    name: "Image & Media",
    tagline: "Build GIFs and convert images, locally",
    description:
      "Turn image sequences into optimized GIFs, convert between formats and resize — all processed in your browser with no uploads.",
    icon: ImageIcon,
    accentVar: "--cat-image",
  },
  {
    slug: "audio",
    name: "Audio & Music",
    tagline: "Convert audio files and do the music math, locally",
    description:
      "Convert between MP3, WAV, FLAC, AAC and Opus in your browser, and convert notes, frequencies, MIDI numbers, tempos, keys, decibels, pitch ratios and bitrates.",
    icon: Music,
    accentVar: "--cat-audio",
  },
  {
    slug: "files",
    name: "Files & Archives",
    tagline: "Pack, unpack and read archives",
    description:
      "Create ZIP and TAR archives, extract ZIP, RAR, 7z and TAR files, and read comic book archives — all unpacked locally in your browser with WebAssembly, no uploads.",
    icon: Archive,
    accentVar: "--cat-files",
  },
  {
    slug: "crypto",
    name: "Crypto & Hashing",
    tagline: "Hashes, checksums and tokens",
    description:
      "Generate SHA and Keccak hashes, decode JWTs, and compute address checksums entirely client-side.",
    icon: KeyRound,
    accentVar: "--cat-crypto",
  },
  {
    slug: "generators",
    name: "Generators",
    tagline: "UUIDs, IDs and mock data",
    description:
      "Generate UUIDs, NanoIDs, lorem ipsum and other placeholder data in bulk.",
    icon: Sparkles,
    accentVar: "--cat-gen",
  },
  {
    slug: "time",
    name: "Time & Date",
    tagline: "Timestamps, epochs and timezones",
    description:
      "Convert Unix timestamps to readable dates, work across timezones and compute relative time.",
    icon: Clock,
    accentVar: "--cat-time",
  },
  {
    slug: "color",
    name: "Color & Design",
    tagline: "Convert and inspect colors",
    description:
      "Convert between HEX, RGB, HSL and OKLCH, build palettes and check contrast.",
    icon: Palette,
    accentVar: "--cat-color",
  },
  {
    slug: "math",
    name: "Math & Units",
    tagline: "Convert numbers, units and run calculators",
    description:
      "Convert number bases and units, simulate loans and crunch everyday numbers — fast, exact and entirely in your browser.",
    icon: Calculator,
    accentVar: "--cat-math",
  },
  {
    slug: "web",
    name: "Web & Dev",
    tagline: "Everyday developer utilities",
    description:
      "Diff text, test regular expressions, preview Markdown and more.",
    icon: Globe,
    accentVar: "--cat-web",
  },
];

const BY_SLUG = new Map<CategorySlug, Category>(
  CATEGORIES.map((c) => [c.slug, c]),
);

export function getCategory(slug: string): Category | undefined {
  return BY_SLUG.get(slug as CategorySlug);
}
