/**
 * Pre-flight for an export: everything that has bitten a long export, checked before the button, each with a state
 * and an action. Pure: the editor supplies what it knows about the environment (folder, files, disk, encoders,
 * measurements) and renders the list; action ids are handled by the editor.
 */

import { YOUTUBE_LUFS } from "./loudness";
import { youtubeBitrateRange } from "./export-presets";
import { fmtTime, soundLevels, soundState, type ExportEstimate, type Project } from "./project";

export type PreflightState = "ok" | "warn" | "block" | "info";

export interface PreflightAction {
  id: string;
  label: string;
  /** A test hook name for the button, when the editor's tests look for one. */
  hook?: string;
}

export interface PreflightItem {
  id: string;
  state: PreflightState;
  title: string;
  detail?: string;
  actions?: PreflightAction[];
}

export interface PreflightEnv {
  /** The browser can open folders (File System Access); without it nothing can be exported. */
  fileSystem: boolean;
  folderName: string | null;
  /** Recordings the project needs that are not at hand. */
  missing: number;
  freeBytes: number | null;
  support: { hevc: boolean; avc: boolean } | null;
  /** The mix as last measured, if it was: stale when the sound changed since, predicted after a level change. */
  loudness: { integrated: number | null; peakDb: number; stale: boolean; predicted: boolean; matchGain: number } | null;
  /** Parts of a stopped export found in the folder. */
  resumable: { name: string; parts: number; bytes: number; endAt: number; total: number; matches: boolean; consumedParts: number; consumedSeconds: number; skipped: number } | null;
  /** Running on battery, when the browser says. */
  onBattery: boolean | null;
}

const fmtGb = (n: number) => (n < 1e9 ? `${(n / 1e6).toFixed(n < 10e6 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(n >= 100e9 ? 0 : 1)} GB`);

export function preflight(project: Project, estimate: ExportEstimate, outHeight: number, env: PreflightEnv): PreflightItem[] {
  const items: PreflightItem[] = [];
  const clips = project.clips.length;

  if (!env.fileSystem) items.push({ id: "browser", state: "block", title: "This browser cannot write to a folder", detail: "Exports need Chrome or Edge, which can open a project folder and write the file there." });
  else if (!env.folderName) items.push({ id: "folder", state: "block", title: "No project folder", detail: "The export is written next to your recordings; pick the folder first.", actions: [{ id: "pick-folder", label: "Pick a folder", hook: "preflight-pick-folder" }] });
  else items.push({ id: "folder", state: "ok", title: `Writes to the project folder “${env.folderName}”` });

  if (!clips) items.push({ id: "footage", state: "block", title: "Nothing on the timeline", detail: "Add recordings before exporting." });
  else if (env.missing > 0) items.push({ id: "footage", state: "block", title: `${env.missing} recording${env.missing === 1 ? " is" : "s are"} missing`, detail: "The export needs every recording on the timeline at hand.", actions: [{ id: "locate", label: "Locate files", hook: "preflight-locate" }] });
  else {
    const n = new Set(project.clips.map((c) => c.media)).size;
    items.push({ id: "footage", state: "ok", title: `All ${n} recording${n === 1 ? "" : "s"} at hand` });
  }

  if (env.support) {
    const want = project.export.codec;
    if (want === "hevc" && !env.support.hevc) items.push({ id: "encoder", state: env.support.avc ? "block" : "block", title: "No HEVC encoder for this size", detail: env.support.avc ? "This machine's browser cannot encode HEVC at the output size; H.264 can." : "No hardware encoder for this size was found; pick a smaller resolution.", actions: env.support.avc ? [{ id: "use-avc", label: "Switch to H.264", hook: "preflight-use-avc" }] : [{ id: "lower-resolution", label: "Use 4K", hook: "preflight-lower-resolution" }] });
    else if (want === "avc" && !env.support.avc) items.push({ id: "encoder", state: "block", title: "No H.264 encoder for this size", detail: "Pick a smaller resolution, or HEVC if the machine has it.", actions: env.support.hevc ? [{ id: "use-hevc", label: "Switch to HEVC" }] : [{ id: "lower-resolution", label: "Use 4K" }] });
    else items.push({ id: "encoder", state: "ok", title: `${want === "hevc" ? "HEVC" : "H.264"} encoder ready at ${outHeight}p` });
  } else items.push({ id: "encoder", state: "info", title: "Checking the encoders…" });

  if (env.freeBytes !== null && clips) {
    const need = estimate.bytes;
    if (env.freeBytes < need) items.push({ id: "space", state: "warn", title: `${fmtGb(env.freeBytes)} free, about ${fmtGb(need)} needed`, detail: "The export is written in parts and pauses itself when the disk runs low, so it can still be finished after you free space — but it will stop on the way." });
    else if (env.freeBytes < need * 1.2) items.push({ id: "space", state: "warn", title: `${fmtGb(env.freeBytes)} free for a file of about ${fmtGb(need)}`, detail: "Tight: the browser keeps a reserve and the join needs room for one part on top." });
    else items.push({ id: "space", state: "ok", title: `${fmtGb(env.freeBytes)} free for a file of about ${fmtGb(need)}` });
  }

  const r = project.export.range;
  if (r && !(r.from < r.to)) items.push({ id: "range", state: "warn", title: "The export range is empty", detail: "From must come before To; the whole timeline is exported instead.", actions: [{ id: "whole-timeline", label: "Whole timeline" }] });
  else if (r) items.push({ id: "range", state: "info", title: `Range ${fmtTime(r.from)} → ${fmtTime(r.to)} (${fmtTime(r.to - r.from)}) — not the whole video`, actions: [{ id: "whole-timeline", label: "Whole timeline" }] });

  if (clips) {
    const levels = soundLevels(project);
    const st = soundState(project);
    const off = st.clipsOther + st.musicOther;
    const mode = project.sound === "music-video" ? "Music video" : "Footage";
    if (off > 0) items.push({ id: "sound", state: "warn", title: `${mode}: ${off} ${off === 1 ? "level differs" : "levels differ"} from the mode's`, detail: `The mode sets camera sound ${levels.camera} dB and music ${levels.music} dB; ${st.clipsOther} clip${st.clipsOther === 1 ? "" : "s"} and ${st.musicOther} track${st.musicOther === 1 ? "" : "s"} sit elsewhere.`, actions: [{ id: "apply-levels", label: "Set them to the mode", hook: "preflight-apply-levels" }] });
    else items.push({ id: "sound", state: "ok", title: `${mode}: camera sound ${levels.camera} dB, music ${levels.music} dB on every clip and track` });

    const l = env.loudness;
    if (!l || l.integrated === null) items.push({ id: "loudness", state: "warn", title: "Loudness not measured", detail: `YouTube plays everything at ${YOUTUBE_LUFS} LUFS and never turns a quiet video up; measuring takes a minute per hour of timeline.`, actions: [{ id: "measure", label: "Measure", hook: "preflight-measure" }] });
    else {
      const diff = l.integrated - YOUTUBE_LUFS;
      const value = `${l.predicted ? "about " : ""}${l.integrated.toFixed(1)} LUFS`;
      if (l.stale && !l.predicted) items.push({ id: "loudness", state: "warn", title: `${value} — measured before the sound changed`, actions: [{ id: "measure", label: "Measure again", hook: "preflight-measure" }] });
      else if (diff < -1) items.push({ id: "loudness", state: "warn", title: `${value}: ${Math.abs(diff).toFixed(1)} dB quieter than YouTube's level`, detail: l.matchGain > 0.4 ? `The peaks allow raising the whole mix ${l.matchGain} dB.` : "The peaks leave no room to raise it; a limiter would be needed.", actions: l.matchGain > 0.4 ? [{ id: "match", label: `Raise ${l.matchGain} dB`, hook: "preflight-match" }] : undefined });
      else if (diff > 1) items.push({ id: "loudness", state: "info", title: `${value}: YouTube will turn it down ${diff.toFixed(1)} dB`, actions: [{ id: "match", label: `Lower ${Math.abs(l.matchGain)} dB`, hook: "preflight-match" }] });
      else items.push({ id: "loudness", state: "ok", title: `${value}: at YouTube's level` });
    }
  }

  const yt = youtubeBitrateRange(outHeight);
  const mbps = project.export.bitrateMbps;
  if (yt) {
    if (mbps < yt.min) items.push({ id: "bitrate", state: "warn", title: `${mbps} Mbps is below YouTube's ${yt.min}–${yt.max} Mbps for ${yt.label}`, detail: "The upload is re-encoded by YouTube; starting it softer than that costs detail.", actions: [{ id: `set-bitrate:${yt.min}`, label: `Use ${yt.min} Mbps` }] });
    else if (mbps > yt.max * 1.5) items.push({ id: "bitrate", state: "info", title: `${mbps} Mbps is well above YouTube's ${yt.min}–${yt.max} Mbps for ${yt.label}`, detail: "Fine for an archive; for an upload it only makes the file bigger.", actions: [{ id: `set-bitrate:${yt.max}`, label: `Use ${yt.max} Mbps` }] });
    else items.push({ id: "bitrate", state: "ok", title: `${mbps} Mbps, ${mbps > yt.max ? "above" : "inside"} YouTube's ${yt.min}–${yt.max} Mbps for ${yt.label}` });
  }

  const t = project.export.tags;
  const filled = [t.title && "title", t.artist && "artist", t.album && "album", t.genre && "genre", t.year && "year"].filter(Boolean) as string[];
  if (!t.title.trim()) items.push({ id: "tags", state: "info", title: `No title tag — the file carries the project name “${project.name}”`, detail: filled.length ? `Set: ${filled.join(", ")}.` : undefined, actions: [{ id: "open-tags", label: "Edit tags" }] });
  else items.push({ id: "tags", state: "ok", title: `Tagged ${t.kind === "music-video" ? "as a music video" : "as a video"}: ${filled.join(", ")}` });

  if (env.resumable) {
    const p = env.resumable;
    const consumed = p.consumedParts ? ` ${p.consumedParts} part${p.consumedParts === 1 ? " was" : "s were"} already joined into a file that did not finish; Resume exports ${fmtTime(p.consumedSeconds)} of them again.` : "";
    const skipped = p.skipped ? ` ${p.skipped} stretch${p.skipped === 1 ? " was" : "es were"} skipped after frames failed.` : "";
    items.push({
      id: "parts",
      state: p.matches ? "info" : "warn",
      title: `An export of ${p.name} stopped at ${fmtTime(p.endAt)} of ${fmtTime(p.total)}`,
      detail: `${p.parts} part${p.parts === 1 ? "" : "s"} (${fmtGb(p.bytes)}) kept in the folder.${consumed}${skipped}${p.matches ? " Resume carries on from there, then joins the parts into the file — a copy, no re-encoding." : " The project has changed since, so these parts cannot be continued; discard them and export again."}`,
      actions: p.matches ? [{ id: "resume", label: "Resume export", hook: "resume-export" }, { id: "discard", label: "Discard parts", hook: "discard-parts" }] : [{ id: "discard", label: "Discard parts", hook: "discard-parts" }],
    });
  }

  if (env.onBattery) items.push({ id: "power", state: "warn", title: "Running on battery", detail: "A long export drains it; plug in, and keep the lid open — the page keeps the display awake while it is visible." });

  return items;
}

export const preflightBlocks = (items: PreflightItem[]) => items.filter((i) => i.state === "block");
