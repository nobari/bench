/**
 * Export presets: one click sets the picture and sound settings for a common destination. A project whose settings
 * match a preset shows it highlighted; any other combination reads as "Custom".
 */

import type { ExportSettings } from "./project";

export type PresetSettings = Pick<ExportSettings, "codec" | "bitrateMbps" | "preset" | "audioBitrateKbps" | "resolution">;

export interface ExportPreset {
  id: string;
  name: string;
  /** One line on what it is for and what it sets. */
  blurb: string;
  settings: PresetSettings;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "youtube-8k", name: "YouTube 8K", blurb: "HEVC at the source size, 100 Mbps — inside YouTube's 80–160 Mbps range for 8K — with 320 kbps sound", settings: { codec: "hevc", bitrateMbps: 100, preset: "balanced", audioBitrateKbps: 320, resolution: "source" } },
  { id: "youtube-4k", name: "YouTube 4K", blurb: "HEVC at 2160p, 45 Mbps, 320 kbps sound — YouTube's range for 4K at 30 fps is 35–45 Mbps", settings: { codec: "hevc", bitrateMbps: 45, preset: "balanced", audioBitrateKbps: 320, resolution: 2160 } },
  { id: "share-1080", name: "1080p share", blurb: "H.264 at 1080p, 12 Mbps, 192 kbps sound — plays on anything, a tenth of the size", settings: { codec: "avc", bitrateMbps: 12, preset: "balanced", audioBitrateKbps: 192, resolution: 1080 } },
  { id: "archive", name: "Archive", blurb: "HEVC at the source size, 200 Mbps, the quality preset, 320 kbps sound — a master to cut from later", settings: { codec: "hevc", bitrateMbps: 200, preset: "quality", audioBitrateKbps: 320, resolution: "source" } },
];

const KEYS: (keyof PresetSettings)[] = ["codec", "bitrateMbps", "preset", "audioBitrateKbps", "resolution"];

/** The preset these settings match exactly, or null for a custom combination. */
export function matchPreset(s: ExportSettings): string | null {
  return EXPORT_PRESETS.find((p) => KEYS.every((k) => p.settings[k] === s[k]))?.id ?? null;
}

export function applyPreset(s: ExportSettings, id: string): ExportSettings {
  const p = EXPORT_PRESETS.find((x) => x.id === id);
  return p ? { ...s, ...p.settings } : s;
}

/**
 * YouTube's recommended video bitrate (Mbps) for an SDR upload at up to 30 fps, by frame height; the ranges from its
 * upload encoding guide. Null below 720p.
 */
export function youtubeBitrateRange(height: number): { min: number; max: number; label: string } | null {
  if (height >= 4320) return { min: 80, max: 160, label: "8K" };
  if (height >= 2160) return { min: 35, max: 45, label: "4K" };
  if (height >= 1440) return { min: 16, max: 24, label: "1440p" };
  if (height >= 1080) return { min: 8, max: 12, label: "1080p" };
  if (height >= 720) return { min: 5, max: 7.5, label: "720p" };
  return null;
}
