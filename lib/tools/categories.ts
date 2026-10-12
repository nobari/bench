import {
  Music,
  Binary,
  Braces,
  Clapperboard,
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
    groups: [{ id: "encoding", name: "Encoding" }, { id: "characters", name: "Case & characters" }, { id: "scripts", name: "Scripts & languages" }],
    name: "Text & Encoding",
    tagline: "Encode, decode, convert and reshape text",
    description:
      "Base64, URL and HTML encoding, case conversion, full-width / half-width, address checksums, and 40+ other text transforms — instant and reversible.",
    icon: Binary,
    accentVar: "--cat-text",
  },
  {
    slug: "json",
    groups: [{ id: "json", name: "JSON" }],
    name: "JSON & Data",
    tagline: "Inspect, format and convert structured data",
    description:
      "A professional JSON viewer with virtualized trees, JSONPath search, validation and conversion between JSON, YAML, CSV and more.",
    icon: Braces,
    accentVar: "--cat-json",
  },
  {
    slug: "media",
    groups: [{ id: "images", name: "Images" }, { id: "animation", name: "GIFs & stickers" }, { id: "video", name: "Video" }, { id: "qr", name: "QR codes" }],
    name: "Images & Video",
    tagline: "Convert images, build GIFs and stickers, edit and tag video, make and scan QR codes — locally",
    description:
      "Convert and resize images, turn them into data URIs or GIFs, check Content Credentials, edit Telegram stickers, cut and grade 8K video, tag MP4s, fix slow-motion clips, and make or scan QR codes — all processed in your browser with no uploads.",
    icon: Clapperboard,
    accentVar: "--cat-media",
  },
  {
    slug: "audio",
    groups: [{ id: "files", name: "Audio files" }, { id: "music", name: "Music math" }],
    name: "Audio & Music",
    tagline: "Convert audio files and do the music math, locally",
    description:
      "Convert between MP3, WAV, FLAC, AAC and Opus in your browser, and convert notes, frequencies, MIDI numbers, tempos, keys, decibels, pitch ratios and bitrates.",
    icon: Music,
    accentVar: "--cat-audio",
  },
  {
    slug: "files",
    groups: [{ id: "archives", name: "Archives" }, { id: "readers", name: "Readers" }],
    name: "Files & Archives",
    tagline: "Pack, unpack and read archives",
    description:
      "Create ZIP and TAR archives, extract ZIP, RAR, 7z and TAR files, and read comic book archives — all unpacked locally in your browser with WebAssembly, no uploads.",
    icon: Archive,
    accentVar: "--cat-files",
  },
  {
    slug: "crypto",
    groups: [{ id: "hashing", name: "Hashing & signatures" }, { id: "ethereum", name: "Ethereum" }],
    name: "Crypto & Hashing",
    tagline: "Hashes, checksums and tokens",
    description:
      "Generate SHA and Keccak hashes, decode JWTs, and compute address checksums entirely client-side.",
    icon: KeyRound,
    accentVar: "--cat-crypto",
  },
  {
    slug: "generators",
    groups: [{ id: "ids", name: "Identifiers & passwords" }, { id: "random", name: "Randomness" }],
    name: "Generators",
    tagline: "UUIDs, IDs and mock data",
    description:
      "Generate UUIDs, NanoIDs, lorem ipsum and other placeholder data in bulk.",
    icon: Sparkles,
    accentVar: "--cat-gen",
  },
  {
    slug: "time",
    groups: [{ id: "dates", name: "Dates & timestamps" }, { id: "schedules", name: "Schedules" }, { id: "sky", name: "Sky & astronomy" }],
    name: "Time & Date",
    tagline: "Timestamps, epochs and timezones",
    description:
      "Convert Unix timestamps to readable dates, work across timezones and compute relative time.",
    icon: Clock,
    accentVar: "--cat-time",
  },
  {
    slug: "color",
    groups: [{ id: "color", name: "Color" }],
    name: "Color & Design",
    tagline: "Convert and inspect colors",
    description:
      "Convert between HEX, RGB, HSL and OKLCH, build palettes and check contrast.",
    icon: Palette,
    accentVar: "--cat-color",
  },
  {
    slug: "math",
    groups: [{ id: "converters", name: "Converters" }, { id: "calculators", name: "Calculators" }],
    name: "Math & Units",
    tagline: "Convert numbers, units and run calculators",
    description:
      "Convert number bases and units, simulate loans and crunch everyday numbers — fast, exact and entirely in your browser.",
    icon: Calculator,
    accentVar: "--cat-math",
  },
  {
    slug: "web",
    groups: [{ id: "editors", name: "Editors" }, { id: "dev", name: "Developer tools" }],
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
