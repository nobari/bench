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
  /** The top-level folders the camera makes; recordings anywhere else are ones a computer moved. */
  folders: string[];
  /** Where the camera's own format lives in its menus. */
  formatPath: string;
}

/** Folders cameras of every make write into; recordings anywhere else were moved by a computer. */
export const GENERIC_CAMERA_FOLDERS = ["DCIM", "MISC", "PRIVATE", "MP_ROOT", "AVCHD", "BDMV", "MOVIE", "CLIP", "XDROOT", "M4ROOT"];

export const CAMERAS: CameraProfile[] = [
  { id: "dji-action-6", name: "DJI Osmo Action 6", bitrateMbps: 132, mode: "8K/30 as the camera records it (DJI lists 120 Mbps as the maximum)", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB and recommends U3 A2 V30 cards (Lexar SILVER PLUS, Kingston CANVAS Go! Plus); the camera stops recording with a slow-card warning when its write buffer runs over.", folders: ["DCIM", "MISC"], formatPath: "Swipe down on the touchscreen → Settings → Format → microSD card" },
  { id: "dji-action-5", name: "DJI Osmo Action 5 Pro / 4", bitrateMbps: 130, mode: "4K/120", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB (512 GB on the Action 4) and recommends U3 A2 V30 cards.", folders: ["DCIM", "MISC"], formatPath: "Swipe down on the touchscreen → Settings → Format → microSD card" },
  { id: "dji-osmo-360", name: "DJI Osmo 360 / Pocket 3", bitrateMbps: 200, mode: "8K/30 360°", maxCardGb: 1000, classNeeded: "V30", namePattern: /^DJI_\d{14}_\d{4}_[A-Z]\.(MP4|LRF|SRT|JPG|DNG|WAV)$/i, notes: "DJI lists microSD support up to 1 TB and recommends V30 cards.", folders: ["DCIM", "MISC"], formatPath: "Swipe down on the touchscreen → Settings → Format → microSD card" },
  { id: "gopro-hero-13", name: "GoPro HERO13 / 12", bitrateMbps: 120, mode: "5.3K/60 at the high bitrate", maxCardGb: 1000, classNeeded: "V30", namePattern: /^G[HXL]\d{6}\.(MP4|LRV|THM|JPG)$/i, notes: "GoPro asks for V30 cards and keeps a list of tested ones; the high-bitrate setting is 120 Mbps.", folders: ["DCIM", "MISC"], formatPath: "Swipe down → Preferences → Reset → Format SD Card" },
  { id: "insta360", name: "Insta360 X4 / X5", bitrateMbps: 200, mode: "8K/30 360°", maxCardGb: 1000, classNeeded: "V30", namePattern: /^(VID|IMG|LRV)_\d{8}_\d{6}/i, notes: "Insta360 asks for V30 or better, exFAT, and warns that 32 and 64 GB cards trigger speed warnings more often.", folders: ["DCIM", "MISC"], formatPath: "Swipe down → Settings → Storage → Format" },
  { id: "custom", name: "Another camera or drive", bitrateMbps: 100, mode: "set the bitrate", maxCardGb: null, classNeeded: "V30", namePattern: /$^/, notes: "Set the bitrate of the heaviest mode you record; the verdicts follow from it.", folders: GENERIC_CAMERA_FOLDERS, formatPath: "the device's own menu (Settings → Storage → Format), not a computer" },
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
export type Kind = "video" | "proxy" | "sidecar" | "image" | "audio" | "clutter" | "trash" | "repair" | "other";

const CLUTTER_NAMES = new Set([".DS_Store", "Thumbs.db", "desktop.ini", ".apdisk", ".VolumeIcon.icns", ".metadata_never_index", "ehthumbs.db", ".directory"]);
const CLUTTER_DIRS = [".Spotlight-V100", ".fseventsd", ".TemporaryItems", "System Volume Information", "__MACOSX"];
/** Where computers park what you delete from a card: the files are still there, still taking room. */
export const TRASH_DIRS = [".Trashes", "$RECYCLE.BIN", ".Trash-1000"];
/** Where a file-system repair leaves the pieces it could not place: fsck.exfat's LOST+FOUND, Windows' FOUND.000. */
export const REPAIR_DIR = /^(LOST\+FOUND|FOUND\.\d{3})$/i;
const topOf = (path: string) => (path.includes("/") ? path.slice(0, path.indexOf("/")) : null);
export const isTrash = (e: Pick<FileEntry, "path">) => TRASH_DIRS.includes(topOf(e.path) ?? "");
export const isRepair = (e: Pick<FileEntry, "path">) => REPAIR_DIR.test(topOf(e.path) ?? "");
const VIDEO = /\.(mp4|mov|m4v|mkv|avi|mts|m2ts|insv|360)$/i, PROXY = /\.(lrf|lrv|thm)$/i, SIDECAR = /\.(srt|xml|txt|log|json|gpx|bin|dat)$/i, IMAGE = /\.(jpe?g|dng|raw|png|heic|heif|tif|tiff|cr3|arw|insp)$/i, AUDIO = /\.(wav|mp3|aac|m4a|flac)$/i;

export function isClutter(e: Pick<FileEntry, "path" | "name">): boolean {
  if (e.name.startsWith("._") || CLUTTER_NAMES.has(e.name)) return true;
  const parts = e.path.split("/");
  return parts.slice(0, -1).some((d) => CLUTTER_DIRS.includes(d));
}
export function kindOf(e: Pick<FileEntry, "path" | "name">): Kind {
  if (isTrash(e)) return "trash";
  if (isRepair(e)) return "repair";
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
  /** Deleted on a computer and parked in the card's Trash or Recycle Bin: still on the card. */
  trash: FileEntry[];
  trashBytes: number;
  /** Fragments a file-system repair left in LOST+FOUND or FOUND.000. */
  repairs: FileEntry[];
  repairBytes: number;
  /** Proxies (LRF/LRV) whose recording is missing. */
  orphans: FileEntry[];
  zeroBytes: FileEntry[];
  /** Recordings by the camera recognised from their names. */
  cameras: { camera: CameraProfile; files: number; bytes: number }[];
  videos: FileEntry[];
}

export function inventory(entries: FileEntry[]): Inventory {
  const byKind = Object.fromEntries((["video", "proxy", "sidecar", "image", "audio", "clutter", "trash", "repair", "other"] as Kind[]).map((k) => [k, { files: 0, bytes: 0 }])) as Inventory["byKind"];
  const folders = new Map<string, FolderStat>();
  const clutter: FileEntry[] = [], trash: FileEntry[] = [], repairs: FileEntry[] = [], zeroBytes: FileEntry[] = [], videos: FileEntry[] = [];
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
    else if (k === "trash") trash.push(e);
    else if (k === "repair") repairs.push(e);
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
    largest: [...entries].filter((e) => !["clutter", "trash", "repair"].includes(kindOf(e))).sort((a, b) => b.size - a.size).slice(0, 5),
    newest,
    oldest,
    clutter,
    clutterBytes: clutter.reduce((a, e) => a + e.size, 0),
    trash,
    trashBytes: trash.reduce((a, e) => a + e.size, 0),
    repairs,
    repairBytes: repairs.reduce((a, e) => a + e.size, 0),
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
  /** What the folders say about the card's history; null until a folder is open. */
  layout: Layout | null;
  /** Pasted from the operating system: what a browser cannot see. */
  volume: VolumeInfo | null;
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
  // the card's history: what the folders and the volume details say
  out.push(...layoutFindings(j));
  out.push(...volumeFindings(j));
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
  if (j.volume) lines.push(`Volume: ${[j.volume.fileSystem, j.volume.clusterBytes ? `${j.volume.clusterBytes / 1024} KB clusters` : null, j.volume.totalBytes ? `${fmtGb(j.volume.totalBytes)} total` : null, j.volume.freeBytes !== undefined ? `${fmtGb(j.volume.freeBytes)} free` : null].filter(Boolean).join(", ")}`);
  if (j.layout?.stray.length) lines.push(`Outside the camera's folders: ${j.layout.stray.map((f) => `${f.folder || "root"} ${f.files} files ${fmtGb(f.bytes)}`).join("; ")}`);
  if (j.fill) lines.push(`Fill: ${j.fill.points.length} files, ${j.fill.fallsAtFree !== null ? `falls under the need below ${fmtGb(j.fill.fallsAtFree)} free` : "no cliff"}${j.fill.trueFree !== null ? `, ${fmtGb(j.fill.trueFree)} truly free` : ""}, ${j.fill.corrupt} of ${j.fill.verified} corrupt`);
  for (const f of list) lines.push(`[${f.severity}] ${f.title} — ${f.what}`);
  return lines.join("\n");
}

/* ------------------------------------------------------------------ layout: what the folders say about the card's history */

export interface StrayFolder {
  /** Top-level folder, "" for the root. */
  folder: string;
  files: number;
  bytes: number;
  from: number;
  to: number;
}
export interface RepairFolder {
  folder: string;
  files: number;
  bytes: number;
  /** When the repair ran, from the newest fragment; null when the folder is empty. */
  at: number | null;
}
export interface Layout {
  /** The name of the folder opened: the volume's name when it is the card itself. */
  rootName: string;
  /** Whether the opened folder looks like a card's root: a camera's folders, computer residue or nothing at all. */
  isRoot: boolean;
  /** The camera's own folders found at the top level. */
  cameraFolders: string[];
  /** Recordings in folders the camera never looks in — renamed or moved on a computer — by top-level folder. */
  stray: StrayFolder[];
  strayBytes: number;
  /** Repair folders at the root, with what they hold. */
  repairs: RepairFolder[];
  /** The volume carries a name no camera gives. */
  namedOnComputer: boolean;
  /** Folders on the card, for the space each one's directory takes. */
  dirs: number;
}
/** Names cameras and factories give a card, or none at all; anything else was typed on a computer. */
const CAMERA_LABELS = /^(|NO NAME|NONAME|UNTITLED|OsmoAction|DJI[\w -]*|GOPRO[\w -]*|Insta360[\w -]*|EOS_DIGITAL|NIKON[\w -]*|LUMIX|CANON[\w -]*|SONY[\w -]*|SDXC|SDHC|SD CARD|disk\d*)$/i;

export function layoutOf(entries: FileEntry[], dirPaths: string[], rootName: string, profile: CameraProfile): Layout {
  const top = new Set<string>();
  for (const d of dirPaths) if (d && !d.includes("/")) top.add(d);
  for (const e of entries) {
    const t = topOf(e.path);
    if (t) top.add(t);
  }
  const allowed = new Set([...profile.folders, ...(profile.id === "custom" ? [] : GENERIC_CAMERA_FOLDERS)].map((f) => f.toLowerCase()));
  const cameraFolders = [...top].filter((d) => allowed.has(d.toLowerCase()));
  const residue = [...top].some((d) => CLUTTER_DIRS.includes(d) || TRASH_DIRS.includes(d) || REPAIR_DIR.test(d));
  const isRoot = cameraFolders.length > 0 || residue || (entries.length === 0 && top.size === 0);
  // recordings outside the camera's folders, grouped by their top-level folder
  const strays = new Map<string, StrayFolder>();
  for (const e of entries) {
    const k = kindOf(e);
    if (k !== "video" && k !== "image" && k !== "proxy") continue;
    const t = topOf(e.path) ?? "";
    if (t && allowed.has(t.toLowerCase())) continue;
    const g = strays.get(t) ?? { folder: t, files: 0, bytes: 0, from: e.lastModified, to: e.lastModified };
    g.files++;
    g.bytes += e.size;
    g.from = Math.min(g.from, e.lastModified);
    g.to = Math.max(g.to, e.lastModified);
    strays.set(t, g);
  }
  const stray = [...strays.values()].sort((a, b) => b.bytes - a.bytes);
  const repairs: RepairFolder[] = [...top]
    .filter((d) => REPAIR_DIR.test(d))
    .map((folder) => {
      const inside = entries.filter((e) => topOf(e.path) === folder);
      return { folder, files: inside.length, bytes: inside.reduce((a, e) => a + e.size, 0), at: inside.length ? Math.max(...inside.map((e) => e.lastModified)) : null };
    });
  return { rootName, isRoot, cameraFolders, stray, strayBytes: stray.reduce((a, f) => a + f.bytes, 0), repairs, namedOnComputer: isRoot && !CAMERA_LABELS.test(rootName.trim()), dirs: dirPaths.filter(Boolean).length };
}

const when = (ms: number) => new Date(ms).toLocaleDateString();
const span = (from: number, to: number) => (when(from) === when(to) ? when(from) : `${when(from)} – ${when(to)}`);

function layoutFindings(j: Judged): Finding[] {
  const out: Finding[] = [];
  const L = j.layout, inv = j.inventory, profile = j.profile;
  if (!L) return out;
  if (inv.trash.length)
    out.push({ id: "trash", severity: "warn", title: `${fmtGb(inv.trashBytes)} deleted on a computer is still on the card`, what: `${inv.trash.length} file${inv.trash.length === 1 ? "" : "s"} in ${summarise(inv.trash.map((e) => topOf(e.path) ?? e.name))}: ${summarise(inv.trash.map((e) => e.name), 4)}.`, why: "Deleting from a card on a Mac (or a PC with the bin enabled for removable drives) moves the files into a hidden Trash folder on the card itself; the room comes back only when that Trash is emptied — with the card connected — or the folder is removed.", fix: { id: "empty-trash", label: "Empty the card's Trash", detail: "Removes the Trash folders on the card and the deleted files in them; nothing else is touched." } });
  for (const r of L.repairs) {
    if (r.files)
      out.push({ id: `repaired-${r.folder}`, severity: "warn", title: `A file-system repair left ${r.files} fragment${r.files === 1 ? "" : "s"} (${fmtGb(r.bytes)}) in ${r.folder}`, what: `${r.folder} was made by a check of the card's file system${r.at ? ` around ${when(r.at)}` : ""}: pieces of files that no folder pointed to any more, after a recording was cut off, the card was pulled while writing, or the file system was damaged.`, why: "Each fragment is a run of clusters the repair could not place; the camera ignores the folder but the room is used. The fragments may hold a recording's data without its index — rarely worth keeping.", fix: { id: "delete-repair", label: "Delete the fragments", detail: "Removes the repair folder and what it holds. Copy anything you want to try to recover first." } });
    else out.push({ id: `repaired-${r.folder}`, severity: "info", title: `The card's file system was checked and found nothing to rescue (${r.folder} is empty)`, what: `${r.folder} is left by the file-system check cameras and computers run when a card is mounted; an empty one means no stray clusters were found.`, why: "Harmless. The camera will make it again; deleting it changes nothing." });
  }
  if (L.stray.length) {
    const inFolders = L.stray.filter((f) => f.folder);
    out.push({ id: "stray", severity: "warn", title: `${fmtGb(L.strayBytes)} of recordings in folders the camera does not look in`, what: L.stray.map((f) => `${f.folder || "the root"}: ${f.files} file${f.files === 1 ? "" : "s"}, ${fmtGb(f.bytes)}, ${span(f.from, f.to)}`).join("; ") + ".", why: `The camera records and counts only inside ${profile.folders.join(" and ")}; a folder renamed or moved on a computer (DCIM-0, "old", a copy) keeps its files on the card, invisible to the camera and still taking the room it needs.`, fix: inFolders.length ? { id: "delete-stray", label: "Delete these folders", detail: "Only after the recordings are copied off: the whole folder goes, and nothing can bring it back. Move the files back under DCIM on the computer instead if the camera should still play them." } : undefined });
  }
  if (L.namedOnComputer) out.push({ id: "named", severity: "info", title: `The card is named "${L.rootName}"`, what: "Cameras do not let you name a card and label one they format with their own name or none; this one was named by a computer's disk tools or a rename in Finder or Explorer.", why: "A sign the card has been through a computer's formatting at least once. Harmless in itself; the volume details below tell whether the layout is the camera's." });
  if (L.isRoot && !L.cameraFolders.length && !inv.files) out.push({ id: "wiped", severity: "info", title: "Empty card: the camera's folders are not there yet", what: `The camera makes ${profile.folders.join(" and ")} when it starts with the card in.`, why: "A card formatted or wiped on a computer looks like this. Formatting it once more in the camera gives it the layout the camera expects before the first recording." });
  return out;
}

/* ------------------------------------------------------------------ volume details, pasted from the operating system */

export interface VolumeInfo {
  source: "diskutil" | "fsutil" | "chkdsk" | "powershell" | "other";
  fileSystem?: string;
  clusterBytes?: number;
  totalBytes?: number;
  usedBytes?: number;
  freeBytes?: number;
  name?: string;
  partitionOffsetBytes?: number;
  deviceBlockBytes?: number;
  protocol?: string;
  removable?: boolean;
  solidState?: boolean;
  /** TRIM on (true), off (false), or not stated. */
  trim?: boolean;
  scheme?: string;
}
const num = (s: string) => Number(s.replace(/[,\s_]/g, ""));
const normaliseFs = (s: string) => {
  const t = s.trim();
  if (/exfat/i.test(t)) return "exFAT";
  if (/fat32|MS-DOS/i.test(t)) return "FAT32";
  if (/\bfat\b|fat16|vfat/i.test(t)) return "FAT";
  if (/ntfs/i.test(t)) return "NTFS";
  if (/apfs/i.test(t)) return "APFS";
  if (/hfs|Mac OS Extended/i.test(t)) return "HFS+";
  if (/ext[234]/i.test(t)) return t.toLowerCase();
  return t;
};
/**
 * Reads what `diskutil info /Volumes/NAME` (macOS), `fsutil fsinfo ntfsinfo X:` and `fsutil fsinfo volumeinfo X:`,
 * `chkdsk X:` or PowerShell's Get-Volume / Get-Partition (Windows) print: the file system, cluster size, exact space,
 * name, partition offset, TRIM. Null when nothing in the text is recognised.
 */
export function parseVolumeInfo(text: string): VolumeInfo | null {
  const t = text.replace(/\r/g, "");
  if (!t.trim()) return null;
  const info: VolumeInfo = { source: "other" };
  const grab = (re: RegExp) => {
    const m = t.match(re);
    return m ? m[1].trim() : undefined;
  };
  const bytesIn = (re: RegExp) => {
    const m = t.match(re);
    return m ? num(m[1]) : undefined;
  };
  if (/File System Personality:|Volume Total Space:|Allocation Block Size:/.test(t)) {
    info.source = "diskutil";
    info.fileSystem = grab(/File System Personality:[ \t]*(.+)/);
    info.name = grab(/Volume Name:[ \t]*(.+)/);
    info.clusterBytes = bytesIn(/Allocation Block Size:[ \t]*([\d,]+) Bytes/);
    info.totalBytes = bytesIn(/Volume Total Space:.*?\(([\d,]+) Bytes\)/) ?? bytesIn(/(?:Disk|Total) Size:.*?\(([\d,]+) Bytes\)/);
    info.usedBytes = bytesIn(/Volume Used Space:.*?\(([\d,]+) Bytes\)/);
    info.freeBytes = bytesIn(/Volume (?:Free|Available) Space:.*?\(([\d,]+) Bytes\)/);
    info.partitionOffsetBytes = bytesIn(/Partition Offset:[ \t]*([\d,]+) Bytes/);
    info.deviceBlockBytes = bytesIn(/Device Block Size:[ \t]*([\d,]+) Bytes/);
    info.protocol = grab(/Protocol:[ \t]*(.+)/);
    const ss = grab(/Solid State:[ \t]*(\w+)/), tr = grab(/TRIM Support:[ \t]*(\w+)/), rm = grab(/Removable Media:[ \t]*(\w+)/);
    if (ss) info.solidState = /yes/i.test(ss);
    if (tr) info.trim = /yes/i.test(tr);
    if (rm) info.removable = /removable/i.test(rm);
    info.scheme = grab(/Partition Type:[ \t]*(.+)/) ?? grab(/Content \(IOContent\):[ \t]*(.+)/);
  } else if (/Bytes Per Cluster|File System Name|bytes in each allocation unit|FileSystemType|AllocationUnitSize|DisableDeleteNotify|The type of the file system is/.test(t)) {
    info.source = /FileSystemType|AllocationUnitSize|SizeRemaining/.test(t) ? "powershell" : /bytes in each allocation unit/.test(t) ? "chkdsk" : "fsutil";
    info.fileSystem = grab(/File System Name[ \t]*:[ \t]*(\S+)/) ?? grab(/The type of the file system is (\w+)\./) ?? grab(/FileSystemType[ \t]*:[ \t]*(\S+)/);
    info.name = grab(/Volume Name[ \t]*:[ \t]*(.*)/) ?? grab(/FileSystemLabel[ \t]*:[ \t]*(.*)/) ?? grab(/Volume label is (.+)\./);
    info.clusterBytes = bytesIn(/Bytes Per Cluster[ \t]*:[ \t]*(?:0x[0-9a-f]+\s*\()?([\d,]+)/i) ?? bytesIn(/([\d,]+) bytes in each allocation unit/) ?? bytesIn(/AllocationUnitSize[ \t]*:[ \t]*([\d,]+)/);
    const totalKb = bytesIn(/([\d,]+) KB total disk space/), freeKb = bytesIn(/([\d,]+) KB available on disk/);
    if (totalKb) {
      info.totalBytes = totalKb * 1024;
      if (freeKb !== undefined) info.freeBytes = freeKb * 1024;
    }
    const totalCl = bytesIn(/Total Clusters[ \t]*:[ \t]*(?:0x[0-9a-f]+\s*\()?([\d,]+)/i), freeCl = bytesIn(/Free Clusters[ \t]*:[ \t]*(?:0x[0-9a-f]+\s*\()?([\d,]+)/i);
    if (info.clusterBytes && totalCl) {
      info.totalBytes ??= totalCl * info.clusterBytes;
      if (freeCl !== undefined) info.freeBytes ??= freeCl * info.clusterBytes;
    }
    const size = bytesIn(/\bSize[ \t]*:[ \t]*([\d,]+)/), rem = bytesIn(/SizeRemaining[ \t]*:[ \t]*([\d,]+)/);
    if (size) {
      info.totalBytes ??= size;
      if (rem !== undefined) info.freeBytes ??= rem;
    }
    info.partitionOffsetBytes = bytesIn(/\bOffset[ \t]*:[ \t]*([\d,]+)/) ?? bytesIn(/StartingOffset\s*[:=]?\s*([\d,]+)/);
    const ddn = grab(/DisableDeleteNotify[ \t]*=[ \t]*(\d)/);
    if (ddn) info.trim = ddn === "0";
    const dt = grab(/MediaType[ \t]*:[ \t]*(\w+)/);
    if (dt) info.solidState = /ssd/i.test(dt);
  } else {
    info.clusterBytes = bytesIn(/(?:Cluster size|Bytes per cluster)\s*[:=]\s*([\d,]+)/i);
    info.fileSystem = grab(/\b(exfat|vfat|fat32|ntfs|ext[234]|apfs|hfs\+?)\b/i);
    if (!info.clusterBytes && !info.fileSystem) return null;
  }
  if (info.fileSystem) info.fileSystem = normaliseFs(info.fileSystem);
  if (info.name !== undefined && !info.name) delete info.name;
  if (info.usedBytes === undefined && info.totalBytes !== undefined && info.freeBytes !== undefined) info.usedBytes = info.totalBytes - info.freeBytes;
  if (info.freeBytes === undefined && info.totalBytes !== undefined && info.usedBytes !== undefined) info.freeBytes = info.totalBytes - info.usedBytes;
  if (!info.fileSystem && !info.clusterBytes && !info.totalBytes && info.trim === undefined) return null;
  return info;
}

/** The cluster size a camera's own format (and the SD specification) gives a card of this size: 128 KB past 32 GB. */
export const cameraCluster = (totalBytes: number) => (totalBytes > 32 * 2 ** 30 ? 131072 : totalBytes > 256 * 2 ** 20 ? 32768 : 4096);
/** A partition that starts on a 4 MB boundary sits on the flash's own block boundaries. */
export const ALIGN = 4 * 2 ** 20;

/**
 * Room the volume says is used beyond what the files account for, after the slack each file wastes in its last
 * cluster, a cluster per folder and the file system's own tables. Clusters nothing points to any more — after a
 * pull mid-write or a crash — show up here. Null without exact used space.
 */
export function unaccounted(info: VolumeInfo, inv: Inventory, dirs: number): number | null {
  if (info.usedBytes === undefined) return null;
  const cluster = info.clusterBytes ?? 131072;
  const expected = inv.bytes + (inv.files * cluster) / 2 + (dirs + 1) * cluster + 64 * 2 ** 20;
  return Math.max(0, info.usedBytes - expected);
}

function volumeFindings(j: Judged): Finding[] {
  const out: Finding[] = [];
  const v = j.volume, L = j.layout, inv = j.inventory, profile = j.profile;
  if (!v) return out;
  const isCard = v.removable !== false && !v.solidState;
  if (v.fileSystem) {
    if (v.fileSystem === "exFAT") out.push({ id: "fs", severity: "ok", title: "exFAT, as cameras expect", what: "The file system cameras format cards with: no 4 GB file limit, readable by every camera and computer.", why: "FAT32 would split recordings at 4 GB; NTFS, APFS or ext would not mount in the camera at all." });
    else if (v.fileSystem === "FAT32" || v.fileSystem === "FAT") out.push({ id: "fs", severity: isCard ? "warn" : "info", title: `${v.fileSystem}: files stop at 4 GB`, what: "A recording longer than 4 GB has to be split or ends there; cameras format cards above 32 GB as exFAT for that reason.", why: "A computer's quick format of a big card sometimes picks FAT32. Format the card in the camera and it becomes exFAT.", fix: { id: "format", label: "Format in the camera", detail: profile.formatPath } });
    else out.push({ id: "fs", severity: isCard ? "error" : "info", title: `${v.fileSystem}: a camera cannot use this file system`, what: `${v.fileSystem} is for computers; a camera mounts exFAT (and FAT32 on small cards) only.`, why: "This card or drive was formatted for a computer. If it is meant for the camera, format it there after copying everything off.", fix: isCard ? { id: "format", label: "Format in the camera", detail: profile.formatPath } : undefined });
  }
  if (v.clusterBytes && v.totalBytes) {
    const want = cameraCluster(v.totalBytes);
    if (v.clusterBytes === want) out.push({ id: "cluster", severity: "ok", title: `${v.clusterBytes / 1024} KB clusters: the layout a camera's format makes`, what: `A camera (and the SD specification) formats a card of this size with ${want / 1024} KB clusters; this one has them.`, why: "The cluster size is the clearest trace of who formatted the card." });
    else out.push({ id: "cluster", severity: isCard ? "warn" : "info", title: `${v.clusterBytes / 1024} KB clusters: not the layout the camera makes`, what: `A camera's format gives a card of this size ${want / 1024} KB clusters, aligned to the flash's own blocks; ${v.clusterBytes / 1024} KB is what a computer's or the factory's format chose, so the camera has not formatted this card.`, why: "Cards formatted by an operating system are laid out without regard to the flash underneath; the SD Association measured such cards at about 60% slower random writes than its aligned layout. The camera's own format puts the tables and clusters where the controller wants them and erases the flash, which also resets a card that has slowed.", fix: isCard ? { id: "format", label: "Format in the camera", detail: `Copy everything off first. ${profile.formatPath}.` } : undefined });
  }
  if (v.partitionOffsetBytes !== undefined && v.partitionOffsetBytes > 0 && v.partitionOffsetBytes % ALIGN !== 0) out.push({ id: "aligned", severity: "warn", title: `The partition starts at ${fmtGb(v.partitionOffsetBytes)}, off the flash's block boundary`, what: `An offset that is not a multiple of 4 MB puts every cluster across two flash blocks; the controller writes both for each one.`, why: "Old partitioning tools and some computer formats start the partition at 31.5 KB or 1 MB. The camera's format and the SD Memory Card Formatter align it.", fix: isCard ? { id: "format", label: "Format in the camera", detail: profile.formatPath } : undefined });
  if (v.totalBytes && v.freeBytes !== undefined) out.push({ id: "exact-space", severity: "info", title: `${fmtGb(v.freeBytes)} free of ${fmtGb(v.totalBytes)}, from the volume details`, what: `Exact figures from the operating system replace the estimate from the card's nominal size and the files found.`, why: "A card's formatted size is a little under what the label says, and hidden folders a browser cannot list still take room." });
  if (L?.isRoot && (!v.name || v.name.toLowerCase() === L.rootName.toLowerCase())) {
    const lost = unaccounted(v, inv, L.dirs);
    if (lost !== null && v.totalBytes && lost > Math.max(2e9, v.totalBytes * 0.01)) out.push({ id: "lost", severity: lost > v.totalBytes * 0.1 ? "error" : "warn", title: `${fmtGb(lost)} used by nothing that can be seen`, what: `The volume reports ${fmtGb(v.usedBytes ?? 0)} used, the files on it add up to ${fmtGb(inv.bytes)} and slack and folders explain only part of the rest.`, why: "Clusters marked used that no file points to any more: a card pulled while writing, a camera that lost power mid-recording, a copy interrupted. Only a repair of the file system (First Aid on macOS, chkdsk /f on Windows, which may leave the pieces in a repair folder) or a format in the camera gives the room back.", fix: { id: "repair", label: "Repair or format", detail: "Copy everything off, then run the repair or format the card in the camera." } });
  }
  if (v.solidState || (v.removable === false && v.protocol && /USB|Thunderbolt/i.test(v.protocol))) {
    if (v.fileSystem === "exFAT") out.push({ id: "trim", severity: "info", title: "An SSD on exFAT gets no TRIM", what: "Neither macOS nor Windows sends TRIM to an exFAT volume, so the drive learns of deleted data only when the blocks are rewritten and slows as it fills.", why: "For a drive that stays with a computer, APFS (macOS) or NTFS (Windows) brings TRIM back; a drive that must stay exFAT for a camera recovers its speed with a full erase (not a quick format) every so often, and by keeping a tenth free." });
    else if (v.trim === false) out.push({ id: "trim", severity: "warn", title: "TRIM is off for this drive", what: "The operating system is not telling the SSD which blocks are free; writes slow as the drive fills with data it believes is still in use.", why: "On macOS `sudo trimforce enable` turns TRIM on for third-party SATA SSDs (external USB drives need an enclosure that passes it on); on Windows `fsutil behavior set DisableDeleteNotify 0` and Optimize Drives." });
    else if (v.trim === true) out.push({ id: "trim", severity: "ok", title: "TRIM is on", what: "The operating system tells the SSD which blocks are free as files are deleted.", why: "Nothing to do: the drive keeps its write speed on its own. Defragmenting it would only add wear." });
  }
  return out;
}

/* ------------------------------------------------------------------ the repair guide */

export interface GuideStep {
  id: string;
  title: string;
  detail: string;
  /** Something to type, when a step has one. */
  command?: string;
}
/** The steps that fit what was found, in the order to take them; the guide is the part the browser cannot do itself. */
export function repairGuide(j: Judged, list: Finding[]): GuideStep[] {
  const ids = new Set(list.map((f) => f.id));
  const sev = (id: string) => list.find((f) => f.id === id)?.severity;
  const steps: GuideStep[] = [];
  const v = j.volume, profile = j.profile, inv = j.inventory;
  const isCard = !v?.solidState && v?.removable !== false;
  const repaired = list.some((f) => f.id.startsWith("repaired-") && f.severity === "warn");
  const needsFormat = sev("cluster") === "warn" || sev("fs") === "warn" || sev("fs") === "error" || ids.has("aligned") || ids.has("lost") || repaired || ids.has("fill-cliff") || sev("speed") === "error" || sev("speed") === "warn" || ids.has("stray") || ids.has("truncated");
  if (!v) steps.push({ id: "details", title: "Read the volume details", detail: "The browser sees the files, not the file system. One command shows the cluster size, exact free space and (for an SSD) TRIM; paste its output into the Volume details box.", command: `macOS: diskutil info /Volumes/${j.layout?.rootName || "CARD"}    Windows: fsutil fsinfo ntfsinfo E: & fsutil fsinfo volumeinfo E:` });
  if (inv.trash.length) steps.push({ id: "trash", title: "Empty the card's Trash", detail: `${fmtGb(inv.trashBytes)} you deleted on a computer is still on the card. The button above removes it here; on a Mac, emptying the Trash while the card is connected does the same.` });
  if (ids.has("stray")) steps.push({ id: "stray", title: "Put the moved recordings back or take them off", detail: `${fmtGb(j.layout?.strayBytes ?? 0)} sits in folders the camera does not look in. Copy them to the computer (or move them back under DCIM there) and delete the folders from the card.` });
  if (needsFormat && inv.files) steps.push({ id: "offload", title: "Copy everything off the card", detail: "A format erases the card. Copy the recordings to the computer or a drive first and check that they open." });
  if (needsFormat || ids.has("wiped") || ids.has("named")) steps.push({ id: "format-camera", title: isCard ? "Format the card in the camera" : "Format the drive where it will be used", detail: isCard ? `${profile.formatPath}. The camera lays out exFAT with the cluster size and alignment its firmware expects, writes its own folders and erases the flash — which is also what brings a slowed card back; a computer's format does none of that.` : "The device that records onto the drive should format it: it chooses the file system and layout it expects." });
  if (needsFormat && isCard) steps.push({ id: "format-computer", title: "If a computer has to format it, use the SD Memory Card Formatter", detail: "The SD Association's free formatter (sdcard.org) aligns the tables and clusters to the flash like a camera does; Disk Utility and Explorer do not. Choose Overwrite format when the card has slowed: it erases every block, not just the directory. Never pick FAT32 for a card above 32 GB." });
  if (ids.has("lost") || ids.has("truncated") || repaired) steps.push({ id: "repair-fs", title: "Repair the file system before trusting the card again", detail: "macOS: Disk Utility → the card → First Aid. Windows: chkdsk with /f (the pieces it rescues land in FOUND.000). A repair reclaims lost clusters and closes damaged folders; a format in the camera does the same more thoroughly.", command: "chkdsk E: /f" });
  if (isCard) steps.push({ id: "no-defrag", title: "Do not defragment a card or SSD", detail: "Flash has no moving head: fragments cost nothing to read, and a defragmenter's rewrites only use up the flash's write cycles. The fragmentation that slows a card lives inside its controller — blocks half full of stale data — and only an erase clears it: the camera's format, or the formatter's overwrite. Deleting files does not, because card readers pass no TRIM." });
  else steps.push({ id: "ssd", title: "Keep TRIM on and skip defragmenting", detail: "An SSD defragments itself inside its controller when the operating system tells it which blocks are free. Check TRIM (macOS: System Information → NVMExpress or SATA → TRIM Support; Windows: fsutil behavior query DisableDeleteNotify, 0 means on) and let Optimize Drives (Windows) retrim on schedule. exFAT gets no TRIM on either system: a full erase restores a drive that stays exFAT.", command: "fsutil behavior query DisableDeleteNotify" });
  steps.push({ id: "keep-free", title: "Keep a tenth of the card free", detail: `${fmtGb((j.space?.capacity ?? j.cardGb * 1e9) * FREE_SHARE_SAFE)} on this card. The controller's fast cache and its clean-up need spare blocks; near full, writes go straight to the slow native flash and the camera stops with a speed warning. Offload and format in the camera rather than deleting single recordings.` });
  return steps;
}
