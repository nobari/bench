/**
 * Storage & Card Doctor: what a browser can learn about a memory card or drive from the files on it and from
 * writing, timing, reading back and verifying test files — and what that means for a camera. Pure: the widget
 * walks the folder, runs the tests and hands the numbers in; this module classifies, judges and explains.
 */

export type Severity = "error" | "warn" | "info" | "ok";

export interface CameraProfile {
  id: string;
  name: string;
  /** The heaviest video mode's bitrate, Mbps, and what it is. */
  bitrateMbps: number;
  mode: string;
  /** The largest card the maker lists as supported, GB (decimal), or null when unknown. */
  maxCardGb: number | null;
  /** The speed class the maker asks for. */
  classNeeded: "V30" | "V60" | "V90" | "V10";
  /** Recordings are recognised by their file names. */
  namePattern: RegExp;
  notes: string;
}

export const CAMERAS: CameraProfile[] = [
  { id: "dji-action-6", name: "DJI Osmo Action 6", bitrateMbps: 132, mode: "8K/30 as the camera records it (DJI lists 120 Mbps as the maximum)", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB and recommends U3 A2 V30 cards (Lexar SILVER PLUS, Kingston CANVAS Go! Plus); the camera stops recording with a slow-card warning when its write buffer runs over." },
  { id: "dji-action-5", name: "DJI Osmo Action 5 Pro / 4", bitrateMbps: 130, mode: "4K/120", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB (512 GB on the Action 4) and recommends U3 A2 V30 cards." },
  { id: "dji-osmo-360", name: "DJI Osmo 360 / Pocket 3", bitrateMbps: 200, mode: "8K/30 360°", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB and recommends V30 cards." },
  { id: "gopro-hero-13", name: "GoPro HERO13 / 12", bitrateMbps: 120, mode: "5.3K/60 at the high bitrate", maxCardGb: 1000, classNeeded: "V30", namePattern: /^G[HXL]\d{6}\.(MP4|LRV|THM|JPG)$/i, notes: "GoPro asks for V30 cards and keeps a list of tested ones; the high-bitrate setting is 120 Mbps." },
  { id: "insta360", name: "Insta360 X4 / X5", bitrateMbps: 200, mode: "8K/30 360°", maxCardGb: 1000, classNeeded: "V30", namePattern: /^(VID|IMG|LRV)_\d{8}_\d{6}/i, notes: "Insta360 asks for V30 or better, exFAT, and warns that 32 and 64 GB cards trigger speed warnings more often." },
  { id: "custom", name: "Another camera or drive", bitrateMbps: 100, mode: "set the bitrate", maxCardGb: null, classNeeded: "V30", namePattern: /$^/, notes: "Set the bitrate of the heaviest mode you record; the verdicts follow from it." },
];
export const DEFAULT_CAMERA = CAMERAS[0];

/** Cards as sold: decimal gigabytes. exFAT leaves a little less. */
export const CARD_SIZES_GB = [32, 64, 128, 256, 512, 1000, 1500, 2000, 4000];

/** Video speed classes: the sustained write each guarantees, MB/s. */
export const SPEED_CLASSES: { id: string; mbps: number }[] = [
  { id: "V90", mbps: 90 },
  { id: "V60", mbps: 60 },
  { id: "V30", mbps: 30 },
  { id: "V10", mbps: 10 },
  { id: "V6", mbps: 6 },
];
/** Sustained writing a camera needs against its bitrate: the bitrate in MB/s with half again as headroom. */
export const HEADROOM = 1.5;
export const needMBps = (bitrateMbps: number) => (bitrateMbps / 8) * HEADROOM;
export const classFor = (sustainedMBps: number) => SPEED_CLASSES.find((c) => sustainedMBps >= c.mbps)?.id ?? "below V6";

/** Keep this share of the card free: the controller's cache and garbage collection live on spare blocks. */
export const FREE_SHARE_SAFE = 0.1;
export const FREE_SHARE_LOW = 0.05;
/** Camera folders (DCIM) hold at most this many files. */
export const DCIM_LIMIT = 999;

/* ------------------------------------------------------------------ inventory */

export interface FileEntry {
  /** Path inside the picked folder, "/" separated, no leading slash. */
  path: string;
  name: string;
  size: number;
  lastModified: number;
}
export type Kind = "video" | "proxy" | "sidecar" | "image" | "audio" | "clutter" | "other";

const CLUTTER_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".apdisk", ".VolumeIcon.icns", ".metadata_never_index", "ehthumbs.db", ".directory"]);
const CLUTTER_DIRS = [".Spotlight-V100", ".fseventsd", ".Trashes", ".TemporaryItems", "System Volume Information", "$RECYCLE.BIN", ".Trash-1000", "__MACOSX"];
const VIDEO = /\.(mp4|mov|m4v|mkv|avi|mts|m2ts|insv|360)$/i, PROXY = /\.(lrf|lrv|thm)$/i, SIDECAR = /\.(srt|xml|txt|log|json|gpx|bin|dat)$/i, IMAGE = /\.(jpe?g|dng|raw|png|heic|heif|tif|tiff|cr3|arw|insp)$/i, AUDIO = /\.(wav|mp3|aac|m4a|flac)$/i;

export function isClutter(e: Pick<FileEntry, "path" | "name">): boolean {
  if (e.name.startsWith("._") || CLUTTER_NAMES.has(e.name)) return true;
  const parts = e.path.split("/");
  return parts.slice(0, -1).some((d) => CLUTTER_DIRS.includes(d));
}
export function kindOf(e: Pick<FileEntry, "path" | "name">): Kind {
  if (isClutter(e)) return "clutter";
  if (VIDEO.test(e.name)) return "video";
  if (PROXY.test(e.name)) return "proxy";
  if (IMAGE.test(e.name)) return "image";
  if (AUDIO.test(e.name)) return "audio";
  if (SIDECAR.test(e.name)) return "sidecar";
  return "other";
}
export function cameraOf(name: string): CameraProfile | null {
  return CAMERAS.find((c) => c.id !== "custom" && c.namePattern.test(name)) ?? null;
}

export interface FolderStat {
  path: string;
  files: number;
  bytes: number;
}
export interface Inventory {
  files: number;
  bytes: number;
  byKind: Record<Kind, { files: number; bytes: number }>;
  folders: FolderStat[];
  /** DCIM-style folders at or over nine tenths of the limit. */
  crowded: FolderStat[];
  largest: FileEntry[];
  newest: FileEntry | null;
  oldest: FileEntry | null;
  clutter: FileEntry[];
  clutterBytes: number;
  /** Proxies (LRF/LRV) whose recording is missing. */
  orphans: FileEntry[];
  zeroBytes: FileEntry[];
  /** Recordings by the camera recognised from their names. */
  cameras: { camera: CameraProfile; files: number; bytes: number }[];
  videos: FileEntry[];
}

export function inventory(entries: FileEntry[]): Inventory {
  const byKind = Object.fromEntries((["video", "proxy", "sidecar", "image", "audio", "clutter", "other"] as Kind[]).map((k) => [k, { files: 0, bytes: 0 }])) as Inventory["byKind"];
  const folders = new Map<string, FolderStat>();
  const clutter: FileEntry[] = [], zeroBytes: FileEntry[] = [], videos: FileEntry[] = [];
  const stems = new Set<string>();
  const cams = new Map<string, { camera: CameraProfile; files: number; bytes: number }>();
  let bytes = 0, newest: FileEntry | null = null, oldest: FileEntry | null = null;
  for (const e of entries) {
    const k = kindOf(e);
    byKind[k].files++;
    byKind[k].bytes += e.size;
    bytes += e.size;
    const dir = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
    const f = folders.get(dir) ?? { path: dir, files: 0, bytes: 0 };
    f.files++;
    f.bytes += e.size;
    folders.set(dir, f);
    if (k === "clutter") clutter.push(e);
    else {
      if (e.size === 0) zeroBytes.push(e);
      if (!newest || e.lastModified > newest.lastModified) newest = e;
      if (!oldest || e.lastModified < oldest.lastModified) oldest = e;
      if (k === "video") {
        videos.push(e);
        stems.add(e.path.replace(/\.[^.]+$/, "").toLowerCase());
      }
      const cam = cameraOf(e.name);
      if (cam && (k === "video" || k === "image")) {
        const c = cams.get(cam.id) ?? { camera: cam, files: 0, bytes: 0 };
        c.files++;
        c.bytes += e.size;
        cams.set(cam.id, c);
      }
    }
  }
  const orphans = entries.filter((e) => kindOf(e) === "proxy" && !stems.has(e.path.replace(/\.[^.]+$/, "").toLowerCase()));
  const folderList = [...folders.values()].sort((a, b) => b.bytes - a.bytes);
  return {
    files: entries.length,
    bytes,
    byKind,
    folders: folderList,
    crowded: folderList.filter((f) => f.files >= DCIM_LIMIT * 0.9),
    largest: [...entries].filter((e) => kindOf(e) !== "clutter").sort((a, b) => b.size - a.size).slice(0, 5),
    newest,
    oldest,
    clutter,
    clutterBytes: clutter.reduce((a, e) => a + e.size, 0),
    orphans,
    zeroBytes,
    cameras: [...cams.values()].sort((a, b) => b.bytes - a.bytes),
    videos,
  };
}

/* ------------------------------------------------------------------ space */

export interface SpaceView {
  capacity: number;
  used: number;
  free: number;
  freeShare: number;
  /** Bytes that must stay free to keep the card at the safe share, and how far it is from that. */
  safeFree: number;
  state: Severity;
  text: string;
}
export function spaceView(capacity: number, used: number, exactFree: number | null): SpaceView {
  const free = exactFree ?? Math.max(0, capacity - used);
  const share = capacity > 0 ? free / capacity : 0;
  const safeFree = capacity * FREE_SHARE_SAFE;
  const state: Severity = share < FREE_SHARE_LOW ? "error" : share < FREE_SHARE_SAFE ? "warn" : "ok";
  const text = state === "ok" ? `${fmtGb(free)} free (${(share * 100).toFixed(1)}%): room for the controller's cache and clean-up.` : state === "warn" ? `${fmtGb(free)} free (${(share * 100).toFixed(1)}%): under the 10% a card needs to keep its write speed up; offload ${fmtGb(safeFree - free)} or more.` : `${fmtGb(free)} free (${(share * 100).toFixed(1)}%): with almost no spare blocks the card writes straight to its slow flash while it cleans up — this is where cameras report a slow card. Offload ${fmtGb(safeFree - free)} or more, then format in the camera.`;
  return { capacity, used, free, freeShare: share, safeFree, state, text };
}

/* ------------------------------------------------------------------ speed */

export interface Sample {
  /** Bytes in this chunk and how long its write (or read) took. */
  bytes: number;
  ms: number;
}
export interface SpeedStats {
  totalBytes: number;
  totalMs: number;
  /** Over the whole run, MB/s. */
  average: number;
  /** The first quarter gigabyte. */
  burst: number;
  /** Median chunk speed after the first gigabyte (or the second half of a shorter run). */
  sustained: number;
  /** The slowest 1 s window. */
  worst: number;
  /** Where the speed first fell to under 60% of the burst and stayed, bytes into the run; null when it never did. */
  cliffAt: number | null;
  /** MB/s per chunk, for the chart. */
  series: { at: number; mbps: number }[];
}
const MB = 1e6;
const mbps = (s: Sample) => (s.ms > 0 ? s.bytes / MB / (s.ms / 1000) : 0);
const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export function speedStats(samples: Sample[]): SpeedStats {
  const totalBytes = samples.reduce((a, s) => a + s.bytes, 0), totalMs = samples.reduce((a, s) => a + s.ms, 0);
  const series: { at: number; mbps: number }[] = [];
  let at = 0;
  for (const s of samples) {
    at += s.bytes;
    series.push({ at, mbps: mbps(s) });
  }
  const burstEnd = Math.min(256 * MB, totalBytes);
  const burstSamples = samples.filter((_, i) => series[i].at - samples[i].bytes < burstEnd);
  const burst = burstSamples.length ? burstSamples.reduce((a, s) => a + s.bytes, 0) / MB / (burstSamples.reduce((a, s) => a + s.ms, 0) / 1000 || 1e-9) : 0;
  const after = totalBytes > 2e9 ? 1e9 : totalBytes / 2;
  const tail = samples.filter((_, i) => series[i].at > after);
  const sustained = tail.length ? median(tail.map(mbps)) : burst;
  // the slowest second: a sliding window of consecutive chunks adding up to about a second
  let worst = Infinity;
  for (let i = 0; i < samples.length; i++) {
    let b = 0, t = 0, j = i;
    while (j < samples.length && t < 1000) {
      b += samples[j].bytes;
      t += samples[j].ms;
      j++;
    }
    if (t > 0 && (t >= 1000 || j === samples.length)) worst = Math.min(worst, b / MB / (t / 1000));
  }
  if (!Number.isFinite(worst)) worst = sustained;
  // the cliff: the first chunk under 60% of the burst after which the rest of the run averages under 70% of it —
  // the write cache ran out there and what follows is the card's native speed
  let cliffAt: number | null = null;
  if (burst > 0 && totalBytes > 768 * MB) {
    for (let i = 0; i < samples.length; i++) {
      if (mbps(samples[i]) >= burst * 0.6) continue;
      const rest = samples.slice(i);
      const rb = rest.reduce((a, s) => a + s.bytes, 0), rt = rest.reduce((a, s) => a + s.ms, 0);
      if (rb >= 256 * MB && rb / MB / (rt / 1000) < burst * 0.7) {
        cliffAt = series[i].at - samples[i].bytes;
        break;
      }
    }
  }
  return { totalBytes, totalMs, average: totalMs > 0 ? totalBytes / MB / (totalMs / 1000) : 0, burst, sustained, worst, cliffAt, series };
}

export interface SpeedVerdict {
  state: Severity;
  classAttained: string;
  need: number;
  text: string;
}
export function speedVerdict(stats: SpeedStats, profile: CameraProfile, bitrateMbps = profile.bitrateMbps): SpeedVerdict {
  const need = needMBps(bitrateMbps);
  const cls = classFor(stats.worst);
  const classNeed = SPEED_CLASSES.find((c) => c.id === profile.classNeeded)!.mbps;
  const state: Severity = stats.worst < bitrateMbps / 8 ? "error" : stats.worst < need || stats.sustained < classNeed ? "warn" : "ok";
  const text = state === "ok" ? `Sustained ${stats.sustained.toFixed(0)} MB/s, never under ${stats.worst.toFixed(0)} MB/s: ${profile.classNeeded}-class and ${(stats.worst / (bitrateMbps / 8)).toFixed(1)}× what ${bitrateMbps} Mbps needs.` : state === "warn" ? `Sustained ${stats.sustained.toFixed(0)} MB/s with a low of ${stats.worst.toFixed(0)} MB/s: ${bitrateMbps} Mbps needs ${(bitrateMbps / 8).toFixed(0)} MB/s and ${need.toFixed(0)} MB/s with headroom; the margin is thin where the card is slowest.` : `A low of ${stats.worst.toFixed(0)} MB/s is under the ${(bitrateMbps / 8).toFixed(0)} MB/s that ${bitrateMbps} Mbps needs: the camera's buffer would overflow here.`;
  return { state, classAttained: cls, need, text };
}

/* ------------------------------------------------------------------ fill */

export interface FillPoint {
  /** Free space when this file was written, bytes, and the write speed, MB/s. */
  free: number;
  mbps: number;
}
export interface FillResult {
  points: FillPoint[];
  /** The free space the card really has (what the test could write plus the margin it stopped at). */
  trueFree: number | null;
  /** Free space under which the speed fell below what the camera needs; null when it never did. */
  fallsAtFree: number | null;
  /** Read-back verification: files checked and files that came back wrong (a fake-capacity card fails here). */
  verified: number;
  corrupt: number;
}
export function fillCurve(points: FillPoint[], need: number): { fallsAtFree: number | null } {
  // the first point, going down in free space, under which every later point is under the need
  const sorted = [...points].sort((a, b) => b.free - a.free);
  let fallsAtFree: number | null = null;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].mbps < need && sorted.slice(i).every((p) => p.mbps < need * 1.1)) {
      fallsAtFree = sorted[i].free;
      break;
    }
  }
  return { fallsAtFree };
}

/* ------------------------------------------------------------------ findings */

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  what: string;
  why: string;
  fix?: { id: string; label: string; detail: string; href?: string };
}
export interface RecordingIssue {
  entry: FileEntry;
  problem: string;
}
export interface Judged {
  inventory: Inventory;
  space: SpaceView | null;
  speed: SpeedStats | null;
  fill: FillResult | null;
  recordings: { checked: number; issues: RecordingIssue[] } | null;
  profile: CameraProfile;
  bitrateMbps: number;
  cardGb: number;
}
export function findings(j: Judged): Finding[] {
  const out: Finding[] = [];
  const { inventory: inv, profile } = j;
  const need = needMBps(j.bitrateMbps);
  // the card against the camera
  if (profile.maxCardGb !== null && j.cardGb > profile.maxCardGb) out.push({ id: "card-too-big", severity: "warn", title: `${fmtGb(j.cardGb * 1e9)} is larger than the ${fmtGb(profile.maxCardGb * 1e9)} ${profile.name} lists as supported`, what: `${profile.notes}`, why: "A card beyond the maker's tested range usually works, but its behaviour when nearly full and the camera's handling of it are untested by them; a slow-card stop near the end of such a card is the kind of fault that would show up there. A card from the maker's list, at the supported size, takes that unknown out.", fix: { id: "card-list", label: "Supported cards", detail: `Use a ${profile.classNeeded} A2 card of ${fmtGb(profile.maxCardGb * 1e9)} or less from the maker's list, and offload more often.` } });
  // space
  if (j.space) {
    if (j.space.state !== "ok") out.push({ id: "space", severity: j.space.state, title: j.space.state === "error" ? `Only ${fmtGb(j.space.free)} free: the card is where it writes slowest` : `${fmtGb(j.space.free)} free is under the 10% a card needs`, what: j.space.text, why: "Large cards write quickly into a pseudo-SLC cache and move the data to the slow native flash later; the cache and the controller's garbage collection both live on free blocks. With a few percent free there are none to spare: writes go straight to native flash while the controller cleans blocks at the same time, and the sustained rate can fall under what the camera needs — the camera then stops with a slow-card warning. Deleting single files on a computer makes it worse, since the free space becomes fragmented and the camera's writes stop being sequential.", fix: { id: "offload", label: "Offload and format in the camera", detail: `Copy everything off, format the card in the camera (not on the computer: the camera lays out exFAT the way it wants and the free space is one sequential run again), and keep at least ${fmtGb(j.space.safeFree)} free — for ${j.bitrateMbps} Mbps the card must still sustain ${need.toFixed(0)} MB/s at the end of the card, not only when empty.` } });
    else out.push({ id: "space-ok", severity: "ok", title: `${fmtGb(j.space.free)} free (${(j.space.freeShare * 100).toFixed(0)}%)`, what: j.space.text, why: "Enough spare blocks for the controller's cache and clean-up." });
  }
  // speed
  if (j.speed) {
    const v = speedVerdict(j.speed, profile, j.bitrateMbps);
    out.push({ id: "speed", severity: v.state, title: v.state === "ok" ? `Writes at ${j.speed.sustained.toFixed(0)} MB/s sustained — ${v.classAttained} class` : v.state === "warn" ? `Writes at ${j.speed.sustained.toFixed(0)} MB/s sustained, dipping to ${j.speed.worst.toFixed(0)} — thin for ${j.bitrateMbps} Mbps` : `Dips to ${j.speed.worst.toFixed(0)} MB/s — under what ${j.bitrateMbps} Mbps needs`, what: `${v.text} Burst ${j.speed.burst.toFixed(0)} MB/s over the first quarter gigabyte, ${fmtGb(j.speed.totalBytes)} written in ${(j.speed.totalMs / 1000).toFixed(0)} s.${j.speed.cliffAt !== null ? ` The speed fell off after ${fmtGb(j.speed.cliffAt)}: that is the cache, and the rate after it is the card's true sustained speed.` : ""}`, why: `Measured by writing test files in 64 MB pieces and timing each, then reading them back and checking every byte. The ${profile.classNeeded} class promises ${SPEED_CLASSES.find((c) => c.id === profile.classNeeded)!.mbps} MB/s sustained; a camera needs the bitrate in bytes with headroom for its own bursts (${(j.bitrateMbps / 8).toFixed(1)} MB/s, ${need.toFixed(0)} with headroom). The operating system caches the first writes, so the first quarter gigabyte reads high; the sustained figure is what counts.`, fix: v.state === "ok" ? undefined : { id: "replace-card", label: "A faster card", detail: `A ${profile.classNeeded === "V30" ? "V60" : "V90"} card from the maker's list, or a lower bitrate mode; and run the fill test to see whether the dip comes with a full card.` } });
  }
  // fill
  if (j.fill) {
    if (j.fill.corrupt > 0) out.push({ id: "fake", severity: "error", title: `${j.fill.corrupt} of ${j.fill.verified} test files came back wrong`, what: "Data written near the end of the card did not read back as written.", why: "A counterfeit card reports a capacity it does not have: writes past the real flash wrap around or vanish, and files there are silently destroyed. A genuine card with failing flash shows the same. Detected by writing a known pattern into each test file and reading it back.", fix: { id: "replace-card", label: "Replace the card", detail: "Copy off what still reads, and buy from a reputable seller; check the new card with this test before trusting it." } });
    if (j.fill.fallsAtFree !== null) out.push({ id: "fill-cliff", severity: "error", title: `Under ${fmtGb(j.fill.fallsAtFree)} free the card writes slower than ${j.bitrateMbps} Mbps needs`, what: `The write speed fell under ${need.toFixed(0)} MB/s once less than ${fmtGb(j.fill.fallsAtFree)} remained and stayed there.`, why: "This is the slowdown of a nearly full card: no spare blocks for the cache, garbage collection competing with the recording, and fragmented free space. The camera's write buffer overflows there and it stops with a slow-card warning.", fix: { id: "margin", label: "Keep that much free", detail: `Stop recording with ${fmtGb(Math.max(j.fill.fallsAtFree * 1.5, j.cardGb * 1e9 * FREE_SHARE_SAFE))} still free, offload, and format in the camera before the next session.` } });
    else if (j.fill.points.length) out.push({ id: "fill-ok", severity: "ok", title: `The speed held to ${fmtGb(Math.min(...j.fill.points.map((p) => p.free)))} free`, what: `${j.fill.points.length} test files written down to that point, the slowest at ${Math.min(...j.fill.points.map((p) => p.mbps)).toFixed(0)} MB/s; ${j.fill.verified} read back and verified.`, why: "No fullness cliff above that point: the card keeps up with the camera at least this far." });
    if (j.fill.trueFree !== null) out.push({ id: "true-free", severity: "info", title: `${fmtGb(j.fill.trueFree)} truly free`, what: "What the test could write before the card refused, plus the margin it stopped at.", why: "Exact, unlike the capacity minus the files, which depends on the card's formatted size." });
  }
  // the files
  if (inv.clutter.length) out.push({ id: "clutter", severity: "warn", title: `${inv.clutter.length} computer-made files on the card (${fmtGb(inv.clutterBytes)})`, what: `${summarise(inv.clutter.map((e) => e.name))}`, why: "macOS writes ._ resource forks, .DS_Store, Spotlight and fseventsd folders onto any exFAT card it touches; Windows adds Thumbs.db and System Volume Information. Cameras do not expect them: they count against folder limits, confuse some firmwares' file scans, and the hidden folders keep growing. Detected by name.", fix: { id: "clean", label: "Clean them off", detail: "Deletes exactly these files and folders; the recordings are not touched. Eject the card properly afterwards so the computer does not write them back." } });
  if (inv.crowded.length) out.push({ id: "crowded", severity: "warn", title: `${inv.crowded.map((f) => `${f.path || "root"} holds ${f.files} files`).join(", ")}`, what: `Camera folders hold at most ${DCIM_LIMIT} files; the camera rolls to a new folder or refuses to record when one fills.`, why: "DCIM numbering runs 100MEDIA to 999MEDIA with 999 files each; a camera that cannot make the next folder stops. Detected by counting files per folder.", fix: { id: "offload", label: "Offload and format", detail: "Copy everything off and format in the camera; the numbering starts again." } });
  if (inv.zeroBytes.length) out.push({ id: "zero", severity: "warn", title: `${inv.zeroBytes.length} empty file${inv.zeroBytes.length === 1 ? "" : "s"}`, what: summarise(inv.zeroBytes.map((e) => e.path)), why: "A recording the camera opened and never wrote — the card stopped taking data, or power was lost — or a copy that failed. Detected by size.", fix: { id: "delete-empty", label: "Delete them", detail: "Empty files hold nothing to recover." } });
  if (inv.orphans.length) out.push({ id: "orphans", severity: "info", title: `${inv.orphans.length} proxy file${inv.orphans.length === 1 ? "" : "s"} without a recording`, what: summarise(inv.orphans.map((e) => e.path)), why: "DJI and GoPro write a small LRF/LRV preview next to each recording; one left alone means the recording was deleted or lost. Detected by matching names.", fix: { id: "delete-orphans", label: "Delete them", detail: "The previews are of no use without their recordings." } });
  if (j.recordings) {
    if (j.recordings.issues.length) out.push({ id: "truncated", severity: "error", title: `${j.recordings.issues.length} of ${j.recordings.checked} recordings cut short`, what: j.recordings.issues.slice(0, 6).map((i) => `${i.entry.path} (${fmtGb(i.entry.size)}): ${i.problem}`).join("; ") + (j.recordings.issues.length > 6 ? "; …" : ""), why: "When a camera stops because the card cannot keep up, the file it was writing is left without its index (the moov box the camera writes at the end): players refuse it although the picture data is there. Detected by reading the end of each MP4 for its index. DJI cameras offer to repair such a file at the next power-on; failing that, an MP4 repair tool that rebuilds the index from a healthy recording of the same settings can recover it.", fix: { id: "video-doctor", label: "Video Doctor", detail: "Check the recordings that did close properly, and read what the index check says about each.", href: "/media/video-doctor" } });
    else if (j.recordings.checked) out.push({ id: "recordings-ok", severity: "ok", title: `${j.recordings.checked} recordings, every one with its index`, what: "Each MP4 ends with the index the camera writes when it closes a file.", why: "No recording was cut short on this card." });
  }
  if (inv.cameras.length) out.push({ id: "camera", severity: "info", title: `${inv.cameras.map((c) => `${c.files} ${c.camera.name} files`).join(", ")}`, what: `${fmtGb(inv.cameras.reduce((a, c) => a + c.bytes, 0))} of recordings and stills recognised by their names.`, why: "The profile above sets the bitrate the verdicts are judged against; change it if the camera is another." });
  const order: Record<Severity, number> = { error: 0, warn: 1, ok: 2, info: 3 };
  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function summarise(names: string[], max = 6): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const key = n.includes("/") ? n.slice(0, n.lastIndexOf("/")) + "/…" : n.startsWith("._") ? "._* files" : n;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const parts = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => (c > 1 ? `${c}× ${k}` : k));
  return parts.slice(0, max).join(", ") + (parts.length > max ? `, … (${parts.length - max} more)` : "");
}

/* ------------------------------------------------------------------ words and bytes */

export const fmtGb = (bytes: number) => (bytes >= 1e12 ? `${(bytes / 1e12).toFixed(2)} TB` : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(bytes >= 100e9 ? 0 : 1)} GB` : bytes >= 1e6 ? `${(bytes / 1e6).toFixed(0)} MB` : `${(bytes / 1e3).toFixed(0)} kB`);
export const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min`;
  return `${(m / 60).toFixed(1)} h`;
};

/** A deterministic 64 MB pattern per file and chunk, so a read-back can be checked byte for byte. */
export const CHUNK = 64 * 1024 * 1024;
export function fillPattern(buf: Uint8Array, fileIndex: number, chunkIndex: number): void {
  const u32 = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >>> 2);
  let x = ((fileIndex + 1) * 2654435761 + (chunkIndex + 1) * 40503) >>> 0;
  for (let i = 0; i < u32.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    u32[i] = x;
  }
}
export function patternMatches(buf: Uint8Array, fileIndex: number, chunkIndex: number): boolean {
  const u32 = new Uint32Array(buf.buffer, buf.byteOffset, buf.byteLength >>> 2);
  let x = ((fileIndex + 1) * 2654435761 + (chunkIndex + 1) * 40503) >>> 0;
  for (let i = 0; i < u32.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    if (u32[i] !== x) return false;
  }
  return true;
}

/** The written report, for the clipboard. */
export function reportText(j: Judged, list: Finding[]): string {
  const lines = [`Storage & Card Doctor — ${new Date().toISOString().slice(0, 10)}`, `${j.profile.name} · ${j.bitrateMbps} Mbps · card ${fmtGb(j.cardGb * 1e9)}`, `${j.inventory.files} files, ${fmtGb(j.inventory.bytes)} used${j.space ? `, ${fmtGb(j.space.free)} free (${(j.space.freeShare * 100).toFixed(1)}%)` : ""}`];
  if (j.speed) lines.push(`Write: burst ${j.speed.burst.toFixed(0)}, sustained ${j.speed.sustained.toFixed(0)}, low ${j.speed.worst.toFixed(0)} MB/s${j.speed.cliffAt !== null ? `, cache ${fmtGb(j.speed.cliffAt)}` : ""}`);
  if (j.fill) lines.push(`Fill: ${j.fill.points.length} files, ${j.fill.fallsAtFree !== null ? `falls under the need below ${fmtGb(j.fill.fallsAtFree)} free` : "no cliff"}${j.fill.trueFree !== null ? `, ${fmtGb(j.fill.trueFree)} truly free` : ""}, ${j.fill.corrupt} of ${j.fill.verified} corrupt`);
  for (const f of list) lines.push(`[${f.severity}] ${f.title} — ${f.what}`);
  return lines.join("\n");
}
