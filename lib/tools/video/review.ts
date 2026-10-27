/**
 * The editor's checklist before an export: what an experienced YouTube editor looks over once more — the cuts and
 * their transitions, the intro and every title to proofread, the camera sound and the music's coverage and levels,
 * the loudness, the tags, and the upload itself (chapters, thumbnail, category). Pure: the project and what the
 * editor knows about the environment come in; groups of items with a state, a summary and an action come out.
 * Each item carries a key made from its own content, so a tick survives until that item changes.
 */

import { introRegion } from "./intro";
import { stopsOnTimeline } from "./stops";
import { SOUND_LABELS, TRANSITIONS, clipSpeed, crossfades, effectiveMusicEnd, exportRange, fmtTime, hasCard, placeClips, soundLevels, soundState, timelineDuration, visibleCuts, type Project, type Title } from "./project";
import { YOUTUBE_LUFS } from "./loudness";
import { YOUTUBE_AUDIO_KBPS, fmtGb, uploadLimits } from "./youtube";

export type ReviewState = "ok" | "look" | "info";

export interface ReviewAction {
  /** "tab:<id>", "section:<id>", "save-frame", "measure", "scan-stops". */
  id: string;
  label: string;
}
export interface ReviewItem {
  id: string;
  state: ReviewState;
  title: string;
  summary: string;
  /** Details to read through (every title, the chapters, the gaps). */
  lines?: string[];
  action?: ReviewAction;
  /** A hash of the item's content: a tick is kept while the key is the same. */
  key: string;
}
export interface ReviewGroup {
  id: "story" | "sound" | "delivery" | "youtube";
  title: string;
  items: ReviewItem[];
}
export interface ReviewEnv {
  loudness: { integrated: number | null; peakDb: number; stale: boolean; predicted: boolean } | null;
  folderName: string | null;
  fileName: string;
  /** A frame was saved into the frames folder (null when unknown). */
  framesSaved: boolean | null;
  doctorDepth: "full" | "quick" | "off";
  outWidth: number;
  outHeight: number;
  /** The expected file size and the export's length, for YouTube's limits. */
  estimateBytes: number;
  seconds: number;
}
export interface Chapters {
  lines: string[];
  text: string;
  ok: boolean;
  problems: string[];
}
export interface Review {
  groups: ReviewGroup[];
  chapters: Chapters;
  /** Every item, flat. */
  items: ReviewItem[];
}

const fnv = (s: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
};
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fmtDb = (db: number) => `${db > 0 ? "+" : ""}${Math.round(db * 10) / 10} dB`;
/** YouTube's chapter timestamp: m:ss under an hour, h:mm:ss above. */
export const fmtChapter = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}` : `${m}:${String(r).padStart(2, "0")}`;
};
const item = (x: Omit<ReviewItem, "key">): ReviewItem => ({ ...x, key: fnv(`${x.title}|${x.summary}|${(x.lines ?? []).join("\n")}`) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const CORNERS: Record<string, string> = { tl: "Top left", tr: "Top right", bl: "Bottom left", br: "Bottom right" };

/* ------------------------------------------------------------------ chapters */

/** A chapters list for the YouTube description from the intro and the titles, checked against YouTube's rules. */
export function youtubeChapters(p: Project): Chapters {
  const placed = placeClips(p.clips);
  const total = timelineDuration(p);
  const range = exportRange(p);
  const from = range?.from ?? 0, to = range?.to ?? total;
  const intro = introRegion(placed);
  const marks: { at: number; text: string }[] = [];
  if (intro && intro.end > from && from === 0) marks.push({ at: 0, text: p.intro.card.text?.trim() ? `Intro — ${p.intro.card.text.trim()}` : "Intro" });
  const titles = [...p.titles].filter((t) => t.text.trim() && t.start >= from && t.start < to).sort((a, b) => a.start - b.start);
  for (const t of titles) {
    const at = t.start - from;
    if (marks.some((m) => Math.abs(m.at - at) < 1)) continue;
    marks.push({ at, text: t.text.trim().replace(/\s+/g, " ") });
  }
  marks.sort((a, b) => a.at - b.at);
  const problems: string[] = [];
  if (marks.length && marks[0].at > 0.5) {
    marks.unshift({ at: 0, text: "Opening" });
    problems.push("The first chapter must start at 0:00 — an “Opening” chapter was added; rename it or add a title at the start.");
  }
  if (marks.length < 3) problems.push(marks.length ? `Only ${plural(marks.length, "chapter")}: YouTube needs at least three, each from a title on the timeline.` : "No titles on the timeline to make chapters from.");
  for (let i = 1; i < marks.length; i++) if (marks[i].at - marks[i - 1].at < 10) problems.push(`“${marks[i - 1].text}” lasts ${Math.round(marks[i].at - marks[i - 1].at)} s: every chapter must be at least 10 s.`);
  const lines = marks.map((m) => `${fmtChapter(m.at)} ${m.text}`);
  return { lines, text: lines.join("\n"), ok: problems.length === 0 && marks.length >= 3, problems };
}

/* ------------------------------------------------------------------ review */

export function reviewProject(p: Project, env: ReviewEnv): Review {
  const placed = placeClips(p.clips);
  const duration = timelineDuration(p);
  const range = exportRange(p);
  const exportFrom = range?.from ?? 0, exportTo = range?.to ?? duration;
  const story: ReviewItem[] = [], sound: ReviewItem[] = [], delivery: ReviewItem[] = [], youtube: ReviewItem[] = [];

  // --- story and picture
  story.push(item({ id: "length", state: "info", title: range ? `Exporting ${fmtTime(range.to - range.from)} of ${fmtTime(duration)}` : `The whole timeline, ${fmtTime(duration)}`, summary: range ? `From ${fmtTime(range.from)} to ${fmtTime(range.to)}; the rest of the timeline is left out.` : `${plural(p.clips.length, "clip")} from ${new Set(p.clips.map((c) => c.media)).size} recordings.`, action: range ? { id: "section:range", label: "Range" } : undefined }));
  const cuts = visibleCuts(placed).filter((t) => t > exportFrom && t < exportTo);
  const withTransition = placed.filter((c) => c.transitionIn && !c.joinedToPrevious && c.start > exportFrom && c.start < exportTo);
  const kinds = new Map<string, number>();
  for (const c of withTransition) {
    const k = `${TRANSITIONS.find((t) => t.kind === c.transitionIn!.kind)?.name ?? c.transitionIn!.kind} ${c.transitionIn!.duration} s`;
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  const plain = cuts.length - withTransition.length;
  story.push(item({
    id: "cuts",
    state: cuts.length === 0 ? "info" : withTransition.length === 0 ? "look" : plain > 0 ? "look" : "ok",
    title: cuts.length === 0 ? "One continuous shot, no cuts" : `${plural(cuts.length, "cut")}, ${withTransition.length === 0 ? "none with a transition" : withTransition.length === cuts.length ? "every one with a transition" : `${withTransition.length} with a transition and ${plain} plain`}`,
    summary: cuts.length === 0 ? "Nothing to smooth." : withTransition.length === 0 ? "Every cut is a hard cut. For continuous footage a 2 s cross dissolve on each cut reads as one drive; stamp one onto every cut, or leave hard cuts where the jump is intended." : `${[...kinds.entries()].map(([k, n]) => `${k} ×${n}`).join(", ")}${plain > 0 ? `; the ${plural(plain, "plain cut")} at ${cuts.filter((t) => !withTransition.some((c) => Math.abs(c.start - t) < 0.01)).slice(0, 6).map((t) => fmtTime(t)).join(", ")}${plain > 6 ? ", …" : ""}` : ""}.`,
    action: cuts.length ? { id: "tab:trim", label: "Cuts and transitions" } : undefined,
  }));
  const sped = p.clips.filter((c) => clipSpeed(c) !== 1);
  if (sped.length) {
    const bySpeed = new Map<number, number>();
    for (const c of sped) bySpeed.set(clipSpeed(c), (bySpeed.get(clipSpeed(c)) ?? 0) + 1);
    story.push(item({ id: "speed", state: "look", title: `${plural(sped.length, "clip")} at another speed`, summary: `${[...bySpeed.entries()].map(([s, n]) => `${n} at ${s}×`).join(", ")}; the original sound ${[...bySpeed.keys()].some((s) => s > 4 || s < 0.25) ? "is off on the fastest or slowest ones" : "follows with its pitch shifted"}.`, action: { id: "tab:trim", label: "Speed" } }));
  }
  const stopsLeft = p.stops ? stopsOnTimeline(p.clips, p.stops).length : 0;
  story.push(item({ id: "stops", state: stopsLeft ? "look" : "info", title: p.stops ? (stopsLeft ? `${plural(stopsLeft, "stop")} still on the timeline` : "Stops scanned, none left") : "Stops not scanned", summary: p.stops ? (stopsLeft ? "Stretches where the picture stands still — a red light, a parked camera — are still in the cut; tick them in Trim and cut them out, or keep them if they are meant." : "Every stretch where the picture stood still was cut out, or none was found.") : "Scan for stops finds every stretch where the picture stands still so they can be cut out in one go.", action: { id: "scan-stops", label: p.stops ? "Stops" : "Scan for stops" } }));
  const intro = introRegion(placed);
  const card = p.intro.card;
  if (intro) {
    const lines = [`Look: ${cap(p.intro.style)}, ${plural(intro.scenes.length, "scene")}${intro.card ? `, title card ${intro.card.end - intro.card.start > 0 ? `${(intro.card.end - intro.card.start).toFixed(1)} s` : ""}` : ", no title card"}, ends at ${fmtTime(intro.end)}`];
    if (intro.card && hasCard(card)) lines.push(`Card: “${card.text}”${card.subtitle ? ` — “${card.subtitle}”` : ""}`);
    lines.push(`Intro sound: ${p.intro.keepAudio ? "the scenes' own sound" : "music only"}`);
    story.push(item({ id: "intro", state: "look", title: `Intro of ${fmtTime(intro.end)}`, summary: "Play the intro once more: the scene order, the card's wording and spelling, the hand-over into the video.", lines, action: { id: "tab:intro", label: "Intro" } }));
  } else story.push(item({ id: "intro", state: "info", title: "No intro", summary: "The video opens on the first clip. The Intro tab lifts a handful of scenes from the footage and cuts a cold open with a title card.", action: { id: "tab:intro", label: "Make an intro" } }));
  const titles = [...p.titles].sort((a, b) => a.start - b.start);
  if (titles.length) {
    const flags: string[] = [];
    const lines = titles.map((t) => {
      const issues: string[] = [];
      if (t.duration < 2) issues.push("under 2 s");
      if (!t.text.trim()) issues.push("empty");
      if (t.start >= exportTo || t.start + t.duration <= exportFrom) issues.push("outside the export range");
      const overlap = titles.find((o) => o !== t && o.position === t.position && o.start < t.start + t.duration && t.start < o.start + o.duration);
      if (overlap && overlap.start > t.start) issues.push(`overlaps “${overlap.text}” at the same position`);
      if (issues.length) flags.push(...issues);
      return `${fmtTime(t.start)} → ${fmtTime(t.start + t.duration)} · ${t.kind === "lowerThird" ? "lower third" : t.kind} · “${t.text}”${t.subtitle ? ` — “${t.subtitle}”` : ""}${issues.length ? ` ⚠ ${issues.join(", ")}` : ""}`;
    });
    story.push(item({ id: "titles", state: "look", title: `${plural(titles.length, "title")} to proofread`, summary: flags.length ? `${plural(flags.length, "thing")} to look at: ${[...new Set(flags)].join(", ")}. Read every line for spelling and timing.` : "Read every line for spelling, names and dates; check each shows long enough to read.", lines, action: { id: "tab:titles", label: "Titles" } }));
  } else story.push(item({ id: "titles", state: "info", title: "No titles", summary: "No title, lower third or caption on the timeline.", action: { id: "tab:titles", label: "Titles" } }));
  if (p.watermark.media) story.push(item({ id: "watermark", state: "info", title: "Logo watermark on", summary: `${CORNERS[p.watermark.corner] ?? p.watermark.corner}, ${Math.round(p.watermark.size * 100)}% of the width, ${Math.round(p.watermark.opacity * 100)}% opaque.`, action: { id: "tab:titles", label: "Watermark" } }));

  // --- sound
  const levels = soundLevels(p), st = soundState(p);
  const muted = p.clips.filter((c) => c.muted).length;
  const gains = new Map<number, number>();
  for (const c of p.clips) if (!c.muted) gains.set(c.gainDb, (gains.get(c.gainDb) ?? 0) + 1);
  const gainList = [...gains.entries()].sort((a, b) => b[1] - a[1]);
  const avg = p.clips.filter((c) => !c.muted).reduce((a, c) => a + c.gainDb, 0) / Math.max(1, p.clips.length - muted);
  sound.push(item({
    id: "camera",
    state: st.clipsOther > 0 ? "look" : muted === p.clips.length ? "info" : "ok",
    title: muted === p.clips.length ? "Camera sound muted on every clip" : muted ? `Camera sound on ${p.clips.length - muted} of ${p.clips.length} clips, ${muted} muted` : `Camera sound on every clip`,
    summary: muted === p.clips.length ? "Only the music will be heard." : `${gainList.length === 1 ? `All at ${fmtDb(gainList[0][0])}` : `${gainList.map(([g, n]) => `${n} at ${fmtDb(g)}`).join(", ")} (average ${fmtDb(avg)})`}. The ${SOUND_LABELS[p.sound ?? "footage"].toLowerCase()} mode puts the camera at ${fmtDb(levels.camera)}${st.clipsOther ? `; ${st.clipsOther} sit at another level — set every clip to the mode's level, or keep the difference if it is meant` : ""}.`,
    action: { id: "section:sound", label: "Sound" },
  }));
  const music = [...p.music].sort((a, b) => a.start - b.start);
  if (music.length) {
    const songs = new Set(music.map((m) => m.media)).size;
    const covered: { from: number; to: number }[] = [];
    for (const m of music) {
      const from = m.start, to = effectiveMusicEnd(m, duration);
      const last = covered[covered.length - 1];
      if (last && from <= last.to + 0.01) last.to = Math.max(last.to, to);
      else covered.push({ from, to });
    }
    const gaps: string[] = [];
    if (covered[0].from - exportFrom > 1) gaps.push(`no music for the first ${fmtTime(covered[0].from - exportFrom)}`);
    for (let i = 1; i < covered.length; i++) if (covered[i].from - covered[i - 1].to > 1) gaps.push(`silence from ${fmtTime(covered[i - 1].to)} to ${fmtTime(covered[i].from)}`);
    const end = covered[covered.length - 1].to;
    if (exportTo - end > 1) gaps.push(`no music for the last ${fmtTime(exportTo - end)}`);
    const mGains = new Map<number, number>();
    for (const m of music) if (!m.muted) mGains.set(m.gainDb, (mGains.get(m.gainDb) ?? 0) + 1);
    const keyframed = music.filter((m) => m.keyframes.length).length;
    const mutedM = music.filter((m) => m.muted).length;
    const xf = crossfades(music).length;
    const fades = music.filter((m) => m.fadeIn > 0 || m.fadeOut > 0).length;
    const lines = [
      `${plural(music.length, "placement")} of ${plural(songs, "song")} on ${new Set(music.map((m) => m.lane)).size} lane${new Set(music.map((m) => m.lane)).size === 1 ? "" : "s"}, from ${fmtTime(covered[0].from)} to ${fmtTime(end)}`,
      `Volume: ${[...mGains.entries()].map(([g, n]) => `${n} at ${fmtDb(g)}`).join(", ") || "all muted"}${keyframed ? `; ${keyframed} with volume keyframes` : ""}${mutedM ? `; ${mutedM} muted` : ""} — the mode puts music at ${fmtDb(levels.music)}`,
      `${xf ? `${plural(xf, "crossfade")} where tracks overlap` : "No overlaps, so no crossfades"}; ${fades} with a fade in or out${music[music.length - 1].fadeOut > 0 ? "; the last one fades out" : "; the last one ends without a fade"}`,
    ];
    if (gaps.length) lines.push(`Gaps: ${gaps.join("; ")}`);
    sound.push(item({ id: "music", state: gaps.length || st.musicOther || mGains.size > 1 ? "look" : "ok", title: gaps.length ? `Music with ${plural(gaps.length, "gap")}` : `Music covers the video, ${plural(songs, "song")}`, summary: gaps.length ? "A music video should not fall silent: slide a track over each gap, or Shuffle & fill lays the songs end to end." : st.musicOther ? `${st.musicOther} ${st.musicOther === 1 ? "track sits" : "tracks sit"} at another level than the mode's ${fmtDb(levels.music)}.` : "Every stretch of the video has music under it.", lines, action: { id: "tab:audio", label: "Music" } }));
  } else sound.push(item({ id: "music", state: p.export.tags.kind === "music-video" ? "look" : "info", title: "No music", summary: p.export.tags.kind === "music-video" ? "The file is tagged as a music video but carries no music track." : "Only the camera sound will be heard.", action: { id: "tab:audio", label: "Add music" } }));
  sound.push(item({ id: "mode", state: "info", title: `${SOUND_LABELS[p.sound ?? "footage"]}: camera ${fmtDb(levels.camera)}, music ${fmtDb(levels.music)}`, summary: p.sound === "music-video" ? "The music carries the video at full level; the camera sound sits well under it, there for texture." : "The camera sound stays in front with the music under it.", action: { id: "section:sound", label: "Sound mode" } }));
  const l = env.loudness;
  sound.push(item({
    id: "loudness",
    state: !l ? "look" : l.integrated === null ? "look" : l.stale ? "look" : Math.abs(l.integrated - YOUTUBE_LUFS) <= 3 ? "ok" : "look",
    title: !l ? "Loudness not measured" : l.integrated === null ? "The mix measures silent" : `${l.predicted ? "About " : ""}${l.integrated.toFixed(1)} LUFS${l.stale ? ", measured before the last change" : ""}`,
    summary: !l ? `Measure runs the export's mix and reports it against YouTube's ${YOUTUBE_LUFS} LUFS; a quiet upload is never turned up.` : l.integrated === null ? "Nothing rose above the gate: check the gains and the mutes." : Math.abs(l.integrated - YOUTUBE_LUFS) <= 3 ? `At YouTube's level (${YOUTUBE_LUFS} LUFS); peaks at ${l.peakDb.toFixed(1)} dBFS.` : l.integrated < YOUTUBE_LUFS ? `${(YOUTUBE_LUFS - l.integrated).toFixed(1)} dB quieter than YouTube's level — Match raises everything together as far as the peaks allow.` : `${(l.integrated - YOUTUBE_LUFS).toFixed(1)} dB louder than YouTube's level; it will be turned down on playback.`,
    action: { id: "measure", label: l ? "Measure again" : "Measure" },
  }));

  // --- delivery
  delivery.push(item({ id: "picture", state: "info", title: `${env.outWidth}×${env.outHeight} ${p.export.codec === "hevc" ? "HEVC" : "H.264"} at ${p.export.bitrateMbps} Mbps`, summary: `${cap(p.export.preset)} encoder · smart copy ${p.export.smartCopy ? "on" : "off"} · steady lights ${p.export.steadyLights && p.export.steadyLights !== "off" ? "on" : "off"} · AAC ${p.export.audioBitrateKbps} kbps.`, action: { id: "section:picture", label: "Picture" } }));
  const tg = p.export.tags;
  const missing = (["title", "artist", "album", "genre", "year"] as const).filter((k) => !tg[k].trim());
  delivery.push(item({
    id: "tags",
    state: missing.length || tg.title.length > 100 ? "look" : "ok",
    title: tg.title.trim() ? `Tagged “${tg.title}”${tg.artist ? ` by ${tg.artist}` : ""}` : "No title in the tags",
    summary: `${tg.kind === "music-video" ? "Music video" : "Plain video"}${tg.album ? ` · album ${tg.album}` : ""}${tg.genre ? ` · ${tg.genre}` : ""}${tg.year ? ` · ${tg.year}` : ""}.${missing.length ? ` Empty: ${missing.join(", ")}${!tg.title.trim() ? " — YouTube takes the upload's title from the file's title tag, else the file name" : ""}.` : ""}${tg.title.length > 100 ? ` The title is ${tg.title.length} characters; YouTube allows 100.` : ""}`,
    action: { id: "section:tags", label: "Tags" },
  }));
  delivery.push(item({ id: "file", state: "info", title: env.fileName, summary: `${env.folderName ? `Into ${env.folderName}` : "No folder yet"} · ${env.doctorDepth === "full" ? "the doctor scans the whole file afterwards" : env.doctorDepth === "quick" ? "the doctor checks the index afterwards" : "no check afterwards"}.`, action: { id: "section:options", label: "Options" } }));

  // --- youtube
  const chapters = youtubeChapters(p);
  youtube.push(item({ id: "chapters", state: chapters.ok ? "ok" : titles.length ? "look" : "info", title: chapters.ok ? `${plural(chapters.lines.length, "chapter")} for the description` : "Chapters", summary: chapters.ok ? "Paste these into the description and YouTube shows them on the seek bar." : chapters.problems.join(" "), lines: chapters.lines, action: titles.length ? undefined : { id: "tab:titles", label: "Add titles" } }));
  youtube.push(item({ id: "thumbnail", state: env.framesSaved === true ? "ok" : env.framesSaved === false ? "look" : "info", title: env.framesSaved === true ? "A thumbnail frame is saved" : "No thumbnail saved yet", summary: env.framesSaved === true ? "In the frames folder beside the export, 1280×720 JPEG, graded, with titles." : "Save frame (S) writes the frame under the playhead as a YouTube-ready 1280×720 JPEG; pick a bright, wide shot with little text on it.", action: { id: "save-frame", label: "Save this frame" } }));
  const lim = uploadLimits(env.estimateBytes, env.seconds, p.export.audioBitrateKbps);
  youtube.push(
    item({
      id: "limits",
      state: lim.overSize || lim.overLength ? "look" : "ok",
      title: lim.overSize ? `About ${fmtGb(env.estimateBytes)} — over YouTube's 256 GB` : lim.overLength ? `${fmtTime(env.seconds)} — over YouTube's 12 hours` : `Within YouTube's limits: about ${fmtGb(env.estimateBytes)}, ${fmtTime(env.seconds)}`,
      summary: lim.overSize
        ? `YouTube refuses files over 256 GB or 12 hours, whichever comes first. ${lim.fit > 0 ? `${lim.fit} Mbps would fit` : "No bitrate fits"}; or export in two ranges.`
        : lim.overLength
          ? "YouTube takes up to 12 hours; export in two ranges."
          : lim.needsVerified
            ? "Over 15 minutes: only a verified account can upload it (verifying by phone, once, lifts the limit to 256 GB or 12 hours)."
            : "Any account can take it.",
      action: lim.overSize ? { id: "section:picture", label: "Picture" } : lim.overLength ? { id: "section:range", label: "Range" } : undefined,
    }),
  );
  youtube.push(item({ id: "audio-rate", state: p.export.audioBitrateKbps < YOUTUBE_AUDIO_KBPS ? "look" : "ok", title: p.export.audioBitrateKbps < YOUTUBE_AUDIO_KBPS ? `AAC ${p.export.audioBitrateKbps} kbps — YouTube recommends ${YOUTUBE_AUDIO_KBPS} kbps stereo` : `AAC ${p.export.audioBitrateKbps} kbps, at YouTube's recommendation`, summary: p.export.audioBitrateKbps < YOUTUBE_AUDIO_KBPS ? "YouTube re-encodes the sound from what you give it; its guide asks for 384 kbps stereo, which costs little next to the picture." : "YouTube's encoding guide asks for 384 kbps stereo.", action: { id: "section:picture", label: "Picture" } }));
  youtube.push(item({ id: "upload", state: "info", title: "On the upload page", summary: `Set the category to Music and add the song credits (that is what YouTube Music lists by); the title comes from the tags; ${env.outHeight >= 2160 ? `${env.outHeight >= 4320 ? "8K" : "4K"} processing can take hours to a day — the SD version appears first` : "processing takes minutes"}.` }));

  const groups: ReviewGroup[] = [
    { id: "story", title: "Story and picture", items: story },
    { id: "sound", title: "Sound", items: sound },
    { id: "delivery", title: "Delivery", items: delivery },
    { id: "youtube", title: "For YouTube", items: youtube },
  ];
  return { groups, chapters, items: groups.flatMap((g) => g.items) };
}

/** True when every item carries its current key in the ticks. */
export const allTicked = (review: Review, ticked: Record<string, string>) => review.items.every((i) => ticked[i.id] === i.key);
export const tickedCount = (review: Review, ticked: Record<string, string>) => review.items.filter((i) => ticked[i.id] === i.key).length;
export type { Title };
