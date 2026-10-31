/**
 * Pre-flight for an export: everything that has bitten a long export, checked before the button, each with a state
 * and an action. Pure: the editor supplies what it knows about the environment (folder, files, disk, encoders,
 * measurements) and renders the list; action ids are handled by the editor.
 */

import { YOUTUBE_LUFS } from "./loudness";
import { audioBytesFor } from "./space";
import { YOUTUBE_AUDIO_KBPS, uploadLimits } from "./youtube";
import { youtubeBitrateRange, youtubeBandText } from "./export-presets";
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
  /** Room the export wants on the drive holding the project folder: the parts, then the join on top of them. The browser cannot read a drive's free space, so this is stated, not compared. */
  room: { parts: number; join: number; mode: "keep" | "remove"; resumable: boolean } | null;
  support: { hevc: boolean; avc: boolean } | null;
  /** The mix as last measured, if it was: stale when the sound changed since, predicted after a level change. */
  loudness: { integrated: number | null; peakDb: number; stale: boolean; predicted: boolean; matchGain: number } | null;
  /** Parts of a stopped export found in the folder. */
  resumable: { name: string; parts: number; bytes: number; endAt: number; total: number; matches: boolean; consumedParts: number; consumedSeconds: number; skipped: number } | null;
  /** Running on battery, when the browser says. */
  onBattery: boolean | null;
  /** Length of the export in timeline seconds, and the output frame rate, for YouTube's limits and bands. */
  seconds: number;
  fps: number;
}

const fmtGb = (n: number) => (n < 1e9 ? `${(n / 1e6).toFixed(n < 10e6 ? 1 : 0)} MB` : `${(n / 1e9).toFixed(n >= 100e9 ? 0 : 1)} GB`);

export function preflight(project: Project, estimate: ExportEstimate, out: { width: number; height: number }, env: PreflightEnv): PreflightItem[] {
  const items: PreflightItem[] = [];
  const clips = project.clips.length;
  // YouTube's bands go by the picture's class: for a vertical or square frame that is its short side (1080×1920 is 1080p).
  const outHeight = Math.min(out.width, out.height);
  const sizeText = `${out.width}×${out.height}`;

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
    else items.push({ id: "encoder", state: "ok", title: `${want === "hevc" ? "HEVC" : "H.264"} encoder ready at ${sizeText}` });
  } else items.push({ id: "encoder", state: "info", title: "Checking the encoders…" });

  if (env.room && clips) {
    const r = env.room;
    items.push({
      id: "room",
      state: "info",
      title: `Room needed: about ${fmtGb(r.parts)} for the ${r.resumable ? "rest of the " : ""}parts, then about ${fmtGb(r.join)} more while they are joined`,
      detail: `${r.mode === "remove" ? "Each part is removed as soon as it is in the file, so the join needs the room of the largest part plus the audio." : "Under 8 GB the parts stay until the file is finished, so the join needs their room once more, beside them."} The browser cannot read a drive's free space (Chrome tells every site the same figure whatever the disk holds), so check the drive holding the project folder yourself; a full drive stops the export at the last finished part, and Resume carries on once room is freed.`,
    });
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

  const yt = youtubeBitrateRange(outHeight, env.fps);
  const mbps = project.export.bitrateMbps;
  if (yt) {
    const band = youtubeBandText(yt);
    if (mbps < yt.min) items.push({ id: "bitrate", state: "warn", title: `${mbps} Mbps is below YouTube's ${band} for ${yt.label}`, detail: "The upload is re-encoded by YouTube; starting it softer than that costs detail.", actions: [{ id: `set-bitrate:${yt.min}`, label: `Use ${yt.min} Mbps` }] });
    else if (mbps > yt.max * 1.5) items.push({ id: "bitrate", state: "info", title: `${mbps} Mbps is well above YouTube's ${band} for ${yt.label}`, detail: "Fine for an archive; for an upload it only makes the file bigger.", actions: [{ id: `set-bitrate:${yt.max}`, label: `Use ${yt.max} Mbps` }] });
    else items.push({ id: "bitrate", state: "ok", title: `${mbps} Mbps, ${mbps > yt.max ? "above" : yt.min === yt.max ? "at" : "inside"} YouTube's ${band} for ${yt.label}` });
  }

  // YouTube's limits, so a long export is not wasted: 256 GB or 12 hours, whichever comes first; 15 minutes unverified.
  if (clips) {
    const lim = uploadLimits(estimate.bytes, env.seconds, project.export.audioBitrateKbps);
    const fitAction = lim.fit > 0 ? [{ id: `set-bitrate:${lim.fit}`, label: `Fit YouTube: use ${lim.fit} Mbps` }] : [];
    const splitAction = [{ id: "open-range", label: "Export in two ranges" }];
    if (lim.overSize)
      items.push({
        id: "limit",
        state: "warn",
        title: `About ${fmtGb(estimate.bytes)}: YouTube refuses files over 256 GB`,
        detail: `YouTube takes up to 256 GB or 12 hours, whichever comes first. ${fmtTime(env.seconds)} at ${mbps} Mbps makes about ${fmtGb(estimate.bytes)}; ${lim.fit > 0 ? `${lim.fit} Mbps would fit${yt && lim.fit < yt.min ? `, below YouTube's ${yt.min} Mbps floor for ${yt.label} — export in two ranges, or at a lower resolution, instead` : ""}` : "no bitrate fits — export in two ranges"}.`,
        actions: [...fitAction, ...splitAction],
      });
    else if (lim.overLength) items.push({ id: "limit", state: "warn", title: `${fmtTime(env.seconds)} is longer than YouTube's 12 hours`, detail: "YouTube takes up to 12 hours or 256 GB, whichever comes first; export in two ranges.", actions: splitAction });
    else if (lim.needsVerified) items.push({ id: "limit", state: "info", title: `Within YouTube's limits (about ${fmtGb(estimate.bytes)}, ${fmtTime(env.seconds)}) — over 15 minutes needs a verified account`, detail: "Unverified accounts stop at 15 minutes; verifying the account by phone once lifts that to 256 GB or 12 hours." });
    else items.push({ id: "limit", state: "ok", title: `Within YouTube's limits: about ${fmtGb(estimate.bytes)}, ${fmtTime(env.seconds)}` });
    const kbps = project.export.audioBitrateKbps;
    if (kbps < YOUTUBE_AUDIO_KBPS) items.push({ id: "audio", state: "info", title: `AAC ${kbps} kbps — YouTube recommends ${YOUTUBE_AUDIO_KBPS} kbps stereo`, detail: `Sound is cheap next to the picture: ${YOUTUBE_AUDIO_KBPS} kbps over ${fmtTime(env.seconds)} is ${fmtGb(audioBytesFor(YOUTUBE_AUDIO_KBPS, env.seconds))}.`, actions: [{ id: `set-audio:${YOUTUBE_AUDIO_KBPS}`, label: `Use ${YOUTUBE_AUDIO_KBPS} kbps` }] });
    else items.push({ id: "audio", state: "ok", title: `AAC ${kbps} kbps, at YouTube's ${YOUTUBE_AUDIO_KBPS} kbps or above` });
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
      detail: `${p.parts} part${p.parts === 1 ? "" : "s"} (${fmtGb(p.bytes)}) kept in the folder.${consumed}${skipped}${p.matches ? " Resume carries on from there, then joins the parts into the file — a copy, no re-encoding." : " The project may have changed since they were made (or the editor was updated): Resume anyway carries on all the same — the parts stay as they are and only the rest follows the current edit — or discard them and export again."}`,
      actions: [{ id: "resume", label: p.matches ? "Resume export" : "Resume anyway", hook: p.matches ? "resume-export" : "resume-anyway" }, { id: "discard", label: "Discard parts", hook: "discard-parts" }],
    });
  }

  if (env.onBattery) items.push({ id: "power", state: "warn", title: "Running on battery", detail: "A long export drains it; plug in, and keep the lid open — the page keeps the display awake while it is visible." });

  return items;
}

export const preflightBlocks = (items: PreflightItem[]) => items.filter((i) => i.state === "block");
