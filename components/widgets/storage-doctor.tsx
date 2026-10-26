"use client";

/**
 * Storage & Card Doctor: pick a memory card's folder, learn what is on it and how much room is left, time what it
 * really writes and reads, write it full to see where the speed falls, check the recordings for ones cut short, and
 * fix what can be fixed from here. Everything runs in the browser against the folder you pick; test files are
 * deleted when a test ends or is cancelled.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQueryState, parseAsString, parseAsInteger, parseAsFloat } from "nuqs";
import { Activity, AlertTriangle, Check, Copy, FolderOpen, Gauge, Info, Loader, Square, Trash2, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { GHOST, PRIMARY, SEL, INPUT } from "./video-styles";
import { SplitPane } from "@/components/ui/split-pane";
import { useUnsavedWork } from "@/lib/unsaved-work";
import { useKeepAwake } from "@/lib/keep-awake";
import { checkMp4 } from "@/lib/tools/video/check";
import { isSpaceError } from "@/lib/tools/video/space";
import { CAMERAS, CARD_SIZES_GB, CHUNK, DEFAULT_CAMERA, fillCurve, fillPattern, findings as judge, fmtDuration, fmtGb, inventory, layoutOf, needMBps, parseVolumeInfo, patternMatches, repairGuide, reportText, spaceView, speedStats, type FileEntry, type FillResult, type Finding, type Inventory, type Judged, type RecordingIssue, type Sample, type Severity, type SpeedStats } from "@/lib/tools/files/storage-doctor";

const TEST_DIR = "BENCH_CARD_DOCTOR";
type Picker = { showDirectoryPicker(opts?: { id?: string; mode?: "read" | "readwrite" }): Promise<FileSystemDirectoryHandle> };
const canPick = () => typeof window !== "undefined" && "showDirectoryPicker" in window;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const isAbort = (e: unknown) => e instanceof DOMException && e.name === "AbortError";
const abortError = () => new DOMException("Cancelled", "AbortError");

interface Job {
  kind: "scan" | "recordings" | "speed" | "fill" | "clean";
  label: string;
  fraction: number | null;
  detail: string;
}
interface Walked {
  entries: FileEntry[];
  files: Map<string, FileSystemFileHandle>;
  dirs: Map<string, FileSystemDirectoryHandle>;
}
/** Tests reach the widget through window.__benchStorage. */
const expose = (api: unknown) => {
  (window as unknown as { __benchStorage?: unknown }).__benchStorage = api;
};
/** Tests can shrink the tests. */
const testOptions: { speedBytes?: number; fillCapBytes?: number; fileBytes?: number; chunk?: number } = {};

const SEVERITY_ICON: Record<Severity, React.ReactNode> = { error: <XCircle size={14} className="shrink-0 text-danger" />, warn: <AlertTriangle size={14} className="shrink-0 text-warn" />, ok: <Check size={14} className="shrink-0 text-positive" />, info: <Info size={14} className="shrink-0 text-faint" /> };
const SEVERITY_LABEL: Record<Severity, string> = { error: "Problem", warn: "Warning", ok: "Fine", info: "Note" };

export function StorageDoctorWidget() {
  const [camId, setCamId] = useQueryState("cam", parseAsString.withDefault(DEFAULT_CAMERA.id).withOptions({ history: "replace" }));
  const [cardGb, setCardGb] = useQueryState("cap", parseAsInteger.withDefault(1000).withOptions({ history: "replace" }));
  const [bitrateParam, setBitrateParam] = useQueryState("mbps", parseAsInteger.withOptions({ history: "replace" }));
  const [speedGb, setSpeedGb] = useQueryState("size", parseAsFloat.withDefault(1).withOptions({ history: "replace" }));
  const [marginGb, setMarginGb] = useQueryState("margin", parseAsInteger.withDefault(20).withOptions({ history: "replace" }));
  const profile = CAMERAS.find((c) => c.id === camId) ?? DEFAULT_CAMERA;
  const bitrateMbps = bitrateParam ?? profile.bitrateMbps;

  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [walked, setWalked] = useState<Walked | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [recordings, setRecordings] = useState<{ checked: number; issues: RecordingIssue[] } | null>(null);
  const [speed, setSpeed] = useState<SpeedStats | null>(null);
  const [readSpeed, setReadSpeed] = useState<SpeedStats | null>(null);
  const [fill, setFill] = useState<FillResult | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [dragging, setDragging] = useState(false);
  // what the operating system says about the volume, pasted in: the file system, cluster size, exact space, TRIM
  const [volumeText, setVolumeText] = useState("");
  const volume = parseVolumeInfo(volumeText);
  const abortRef = useRef<AbortController | null>(null);
  const log = (text: string) => setEvents((l) => [...l.slice(-40), `${new Date().toLocaleTimeString()} ${text}`]);

  useUnsavedWork(job ? `A ${job.kind === "fill" ? "fill test" : job.kind === "speed" ? "speed test" : "scan"} is running in the Storage Doctor; leaving now would abandon it (test files are removed when it ends).` : null);
  useKeepAwake(!!job, "bench-storage-doctor");

  /* ------------------------------------------------------------ walking */
  const walk = useCallback(async (root: FileSystemDirectoryHandle, signal: AbortSignal, onCount: (n: number) => void): Promise<Walked> => {
    const entries: FileEntry[] = [];
    const files = new Map<string, FileSystemFileHandle>(), dirs = new Map<string, FileSystemDirectoryHandle>();
    dirs.set("", root);
    const visit = async (d: FileSystemDirectoryHandle, prefix: string) => {
      for await (const [name, h] of d as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (signal.aborted) throw abortError();
        const path = prefix ? `${prefix}/${name}` : name;
        if (h.kind === "directory") {
          if (!prefix && name === TEST_DIR) continue;
          dirs.set(path, h as FileSystemDirectoryHandle);
          await visit(h as FileSystemDirectoryHandle, path);
        } else {
          try {
            const f = await (h as FileSystemFileHandle).getFile();
            entries.push({ path, name, size: f.size, lastModified: f.lastModified });
            files.set(path, h as FileSystemFileHandle);
            if (entries.length % 50 === 0) onCount(entries.length);
          } catch {
            /* unreadable entry */
          }
        }
      }
    };
    await visit(root, "");
    return { entries, files, dirs };
  }, []);

  const scan = useCallback(
    async (root: FileSystemDirectoryHandle) => {
      const abort = new AbortController();
      abortRef.current = abort;
      setJob({ kind: "scan", label: "Reading the card", fraction: null, detail: "" });
      setError(null);
      try {
        const w = await walk(root, abort.signal, (n) => setJob((j) => (j ? { ...j, detail: `${n} files so far` } : j)));
        const i = inventory(w.entries);
        setWalked(w);
        setInv(i);
        log(`Scanned ${i.files} files, ${fmtGb(i.bytes)}`);
        // the recordings: each MP4's tail, for the index the camera writes when it closes a file
        const videos = i.videos.filter((e) => /\.(mp4|mov|m4v)$/i.test(e.name));
        const issues: RecordingIssue[] = [];
        let done = 0;
        setJob({ kind: "recordings", label: "Checking the recordings", fraction: 0, detail: `0 of ${videos.length}` });
        for (const e of videos) {
          if (abort.signal.aborted) throw abortError();
          try {
            const f = await w.files.get(e.path)!.getFile();
            const c = await checkMp4(f);
            const cut = c.problems.find((p) => /No index|cut short/.test(p));
            if (cut) issues.push({ entry: e, problem: cut.replace(/^No index \(moov\) found: /, "").replace(/^The index \(moov\) runs past the end of the file: /, "") });
          } catch (err) {
            issues.push({ entry: e, problem: `could not be read: ${message(err)}` });
          }
          done++;
          setJob({ kind: "recordings", label: "Checking the recordings", fraction: done / Math.max(1, videos.length), detail: `${done} of ${videos.length}` });
        }
        setRecordings({ checked: videos.length, issues });
        log(issues.length ? `${issues.length} of ${videos.length} recordings cut short` : `${videos.length} recordings, all closed properly`);
      } catch (e) {
        if (!isAbort(e)) setError(message(e));
      } finally {
        setJob(null);
        if (abortRef.current === abort) abortRef.current = null;
      }
    },
    [walk],
  );
  const open = useCallback(
    (root: FileSystemDirectoryHandle) => {
      setDir(root);
      setWalked(null);
      setInv(null);
      setRecordings(null);
      setSpeed(null);
      setReadSpeed(null);
      setFill(null);
      setEvents([]);
      void scan(root);
    },
    [scan],
  );
  const pick = async () => {
    if (!canPick()) return setError("This browser cannot open folders. Chrome or Edge can (the File System Access API).");
    try {
      const h = await (window as unknown as Picker).showDirectoryPicker({ id: "bench-storage-doctor", mode: "readwrite" });
      open(h);
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
    }
  };
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const item = e.dataTransfer.items?.[0] as (DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }) | undefined;
    try {
      const h = item?.getAsFileSystemHandle ? await item.getAsFileSystemHandle() : null;
      if (h && h.kind === "directory") open(h as FileSystemDirectoryHandle);
      else setError("Drop the card's folder (the card itself), not a file.");
    } catch (err) {
      setError(message(err));
    }
  };

  /* ------------------------------------------------------------ test files */
  const testDir = async (create: boolean) => dir!.getDirectoryHandle(TEST_DIR, { create });
  const removeTests = async () => {
    try {
      await dir!.removeEntry(TEST_DIR, { recursive: true });
    } catch {
      /* nothing there */
    }
  };
  const chunkBuf = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const chunk = () => {
    const size = testOptions.chunk ?? CHUNK;
    if (!chunkBuf.current || chunkBuf.current.byteLength !== size) chunkBuf.current = new Uint8Array(new ArrayBuffer(size));
    return chunkBuf.current;
  };
  /** Writes one test file of `bytes`, timing every chunk; returns the samples, or null when the card ran out of room. */
  const writeTestFile = async (folder: FileSystemDirectoryHandle, name: string, fileIndex: number, bytes: number, signal: AbortSignal, onChunk: (s: Sample, writtenSoFar: number) => void): Promise<{ samples: Sample[]; written: number; closeMs: number; full: boolean }> => {
    const handle = await folder.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const samples: Sample[] = [];
    let written = 0, full = false, closeMs = 0;
    try {
      const buf = chunk();
      for (let ci = 0; written < bytes; ci++) {
        if (signal.aborted) throw abortError();
        const n = Math.min(buf.byteLength, bytes - written);
        fillPattern(buf.subarray(0, n), fileIndex, ci);
        const t0 = performance.now();
        try {
          await writable.write(n === buf.byteLength ? buf : buf.slice(0, n));
        } catch (e) {
          if (isSpaceError(e)) {
            full = true;
            break;
          }
          throw e;
        }
        const ms = performance.now() - t0;
        written += n;
        samples.push({ bytes: n, ms });
        onChunk({ bytes: n, ms }, written);
      }
      const t1 = performance.now();
      try {
        await writable.close();
      } catch (e) {
        if (isSpaceError(e)) full = true;
        else throw e;
      }
      closeMs = performance.now() - t1;
    } catch (e) {
      try {
        await writable.abort();
      } catch {
        /* already closed */
      }
      throw e;
    }
    return { samples, written, closeMs, full };
  };
  /** Reads a test file back in chunks, timing each and checking the pattern; returns read samples and whether every chunk matched. */
  const readTestFile = async (folder: FileSystemDirectoryHandle, name: string, fileIndex: number, signal: AbortSignal, onChunk: (s: Sample) => void, every = 1): Promise<{ samples: Sample[]; ok: boolean; bytes: number }> => {
    const f = await (await folder.getFileHandle(name)).getFile();
    const size = testOptions.chunk ?? CHUNK;
    const samples: Sample[] = [];
    let ok = true;
    const chunks = Math.ceil(f.size / size);
    for (let ci = 0; ci < chunks; ci++) {
      if (signal.aborted) throw abortError();
      if (every > 1 && ci % every !== 0 && ci !== chunks - 1) continue;
      const t0 = performance.now();
      const buf = new Uint8Array(await f.slice(ci * size, Math.min(f.size, (ci + 1) * size)).arrayBuffer());
      const ms = performance.now() - t0;
      samples.push({ bytes: buf.byteLength, ms });
      onChunk({ bytes: buf.byteLength, ms });
      if (!patternMatches(buf, fileIndex, ci)) ok = false;
    }
    return { samples, ok, bytes: f.size };
  };

  /* ------------------------------------------------------------ speed test */
  const runSpeed = async () => {
    if (!dir || job) return;
    const total = testOptions.speedBytes ?? Math.round(speedGb * 1e9);
    const fileBytes = testOptions.fileBytes ?? Math.min(total, 1024 * 1024 * 1024);
    const abort = new AbortController();
    abortRef.current = abort;
    setJob({ kind: "speed", label: "Writing test files", fraction: 0, detail: "" });
    setError(null);
    setSpeed(null);
    setReadSpeed(null);
    const write: Sample[] = [], read: Sample[] = [];
    let writtenAll = 0;
    try {
      await removeTests();
      const folder = await testDir(true);
      const count = Math.ceil(total / fileBytes);
      for (let i = 0; i < count && writtenAll < total; i++) {
        const r = await writeTestFile(folder, `speed-${i + 1}.bin`, i, Math.min(fileBytes, total - writtenAll), abort.signal, (s, w) => {
          write.push(s);
          setSpeed(speedStats(write));
          setJob({ kind: "speed", label: "Writing test files", fraction: ((writtenAll + w) / total) * 0.7, detail: `${fmtGb(writtenAll + w)} of ${fmtGb(total)} · ${(s.bytes / 1e6 / (s.ms / 1000)).toFixed(0)} MB/s` });
        });
        writtenAll += r.written;
        if (r.closeMs > 500) log(`Closing ${fmtGb(r.written)} took ${fmtDuration(r.closeMs)} (the browser reads a file back to check it before moving it into place)`);
        if (r.full) {
          log(`The card ran out of room after ${fmtGb(writtenAll)}`);
          break;
        }
      }
      let ok = true, readBytes = 0;
      for (let i = 0; i < count; i++) {
        let exists = true;
        try {
          await folder.getFileHandle(`speed-${i + 1}.bin`);
        } catch {
          exists = false;
        }
        if (!exists) break;
        const r = await readTestFile(folder, `speed-${i + 1}.bin`, i, abort.signal, (s) => {
          read.push(s);
          setReadSpeed(speedStats(read));
          readBytes += s.bytes;
          setJob({ kind: "speed", label: "Reading them back and checking every byte", fraction: 0.7 + (readBytes / Math.max(1, writtenAll)) * 0.3, detail: `${fmtGb(readBytes)} of ${fmtGb(writtenAll)} · ${(s.bytes / 1e6 / (s.ms / 1000)).toFixed(0)} MB/s` });
        });
        if (!r.ok) ok = false;
      }
      const st = speedStats(write);
      setSpeed(st);
      log(`Write: burst ${st.burst.toFixed(0)}, sustained ${st.sustained.toFixed(0)}, low ${st.worst.toFixed(0)} MB/s${st.cliffAt !== null ? `, cache cliff after ${fmtGb(st.cliffAt)}` : ""}; read back ${ok ? "verified" : "WITH ERRORS"}`);
      if (!ok) setError("Some test data did not read back as written: the card is corrupting data. Copy off what you can and replace it.");
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
      else log("Speed test cancelled");
    } finally {
      setJob({ kind: "speed", label: "Removing the test files", fraction: 1, detail: "" });
      await removeTests();
      setJob(null);
      if (abortRef.current === abort) abortRef.current = null;
    }
  };

  /* ------------------------------------------------------------ fill test */
  // the pasted volume details give the exact size and use; otherwise the nominal size and the files found
  const capacity = volume?.totalBytes ?? cardGb * 1e9;
  const used = volume?.usedBytes ?? inv?.bytes ?? 0;
  const runFill = async () => {
    if (!dir || job || !inv) return;
    const need = needMBps(bitrateMbps);
    const margin = marginGb * 1e9;
    const free0 = Math.max(0, capacity - used);
    const cap = testOptions.fillCapBytes ?? Infinity;
    const est = Math.min(cap, Math.max(0, free0 - margin)) / (60e6) * 1000;
    if (!testOptions.fillCapBytes && !window.confirm(`Write the card full?\n\nTest files are written until ${fmtGb(margin)} remain (or the card refuses), about ${fmtGb(Math.max(0, free0 - margin))} at a guess, which takes roughly ${fmtDuration(est)} at 60 MB/s. The speed is charted against the space left, samples are read back and checked, and every test file is deleted at the end or on cancel. Keep the card plugged in and the window open.`)) return;
    const abort = new AbortController();
    abortRef.current = abort;
    setJob({ kind: "fill", label: "Writing the card full", fraction: 0, detail: "" });
    setError(null);
    setFill(null);
    const fileBytes = testOptions.fileBytes ?? 1024 * 1024 * 1024;
    const points: FillResult["points"] = [];
    let written = 0, full = false, files = 0;
    try {
      await removeTests();
      const folder = await testDir(true);
      while (!full && written < cap) {
        const free = free0 - written;
        if (free <= margin && !testOptions.fillCapBytes) break;
        const r = await writeTestFile(folder, `fill-${files + 1}.bin`, files, Math.min(fileBytes, cap - written), abort.signal, (s, w) => {
          setJob({ kind: "fill", label: "Writing the card full", fraction: Math.min(0.85, ((written + w) / Math.max(1, Math.min(cap, free0 - margin))) * 0.85), detail: `${fmtGb(free - w)} left · ${(s.bytes / 1e6 / (s.ms / 1000)).toFixed(0)} MB/s · file ${files + 1}` });
        });
        files++;
        written += r.written;
        if (r.samples.length) {
          const st = speedStats(r.samples);
          points.push({ free: free - r.written, mbps: st.average });
          setFill({ points: [...points], trueFree: null, fallsAtFree: fillCurve(points, need).fallsAtFree, verified: 0, corrupt: 0 });
        }
        full = r.full;
      }
      // read back a sample of the files: the first, the last, and every eighth, two chunks each
      let verified = 0, corrupt = 0;
      const picks = new Set<number>([1, files]);
      for (let i = 1; i <= files; i += 8) picks.add(i);
      for (const i of [...picks].sort((a, b) => a - b)) {
        setJob({ kind: "fill", label: "Reading samples back", fraction: 0.85 + (0.1 * verified) / picks.size, detail: `file ${i} of ${files}` });
        try {
          const r = await readTestFile(folder, `fill-${i}.bin`, i - 1, abort.signal, () => undefined, 8);
          verified++;
          if (!r.ok) corrupt++;
        } catch (e) {
          if (isAbort(e)) throw e;
          verified++;
          corrupt++;
        }
      }
      const result: FillResult = { points, trueFree: full ? written + Math.max(0, free0 - written > 0 ? 0 : 0) : null, fallsAtFree: fillCurve(points, need).fallsAtFree, verified, corrupt };
      if (full) result.trueFree = written;
      setFill(result);
      log(`Fill: ${files} files, ${fmtGb(written)} written${full ? " until the card was full" : ""}; ${result.fallsAtFree !== null ? `speed fell under ${need.toFixed(0)} MB/s below ${fmtGb(result.fallsAtFree)} free` : "no cliff"}; ${corrupt} of ${verified} samples corrupt`);
    } catch (e) {
      if (!isAbort(e)) setError(message(e));
      else log("Fill test cancelled");
    } finally {
      setJob({ kind: "fill", label: "Removing the test files", fraction: 1, detail: "" });
      await removeTests();
      setJob(null);
      if (abortRef.current === abort) abortRef.current = null;
    }
  };

  /* ------------------------------------------------------------ fixes */
  // what the folders say about the card's history
  const layout = walked && dir ? layoutOf(walked.entries, [...walked.dirs.keys()], dir.name, profile) : null;
  /** Removes whole top-level folders — a renamed DCIM, a repair folder — after a confirmation, and the typed word for recordings. */
  const deleteFolders = async (names: string[], what: string, bytes: number, typed: boolean) => {
    if (!dir || job || !names.length) return;
    const listing = names.join(", ");
    if (!window.confirm(`Delete ${what} from ${dir.name}: ${listing} (${fmtGb(bytes)})?\n\nEverything inside goes and cannot be brought back.`)) return;
    if (typed && window.prompt(`This removes ${fmtGb(bytes)} of recordings for good. Have they been copied off? Type delete to go on.`) !== "delete") return;
    setJob({ kind: "clean", label: `Deleting ${what}`, fraction: 0, detail: "" });
    try {
      let n = 0;
      for (const name of names) {
        await dir.removeEntry(name, { recursive: true });
        n++;
        setJob({ kind: "clean", label: `Deleting ${what}`, fraction: n / names.length, detail: `${n} of ${names.length}` });
      }
      log(`Deleted ${n} folder${n === 1 ? "" : "s"}: ${listing}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setJob(null);
      void scan(dir);
    }
  };
  const deleteEntries = async (list: FileEntry[], what: string) => {
    if (!dir || !walked || job) return;
    if (!window.confirm(`Delete ${list.length} ${what} from ${dir.name}?\n\n${list.slice(0, 8).map((e) => e.path).join("\n")}${list.length > 8 ? `\n… and ${list.length - 8} more` : ""}\n\nNothing else is touched. This cannot be undone.`)) return;
    setJob({ kind: "clean", label: `Deleting ${what}`, fraction: 0, detail: "" });
    let n = 0;
    try {
      // whole clutter folders go in one piece; single files one by one
      const roots = new Set<string>();
      for (const e of list) {
        const top = e.path.split("/")[0];
        const h = walked.dirs.get(top);
        if (h && e.path.includes("/") && [".Spotlight-V100", ".fseventsd", ".Trashes", ".TemporaryItems", "System Volume Information", "$RECYCLE.BIN", ".Trash-1000", "__MACOSX"].includes(top)) roots.add(top);
      }
      for (const top of roots) {
        await dir.removeEntry(top, { recursive: true });
        n += list.filter((e) => e.path.split("/")[0] === top).length;
      }
      for (const e of list) {
        if (roots.has(e.path.split("/")[0])) continue;
        const parentPath = e.path.includes("/") ? e.path.slice(0, e.path.lastIndexOf("/")) : "";
        const parent = walked.dirs.get(parentPath);
        if (parent) await parent.removeEntry(e.name);
        n++;
        setJob({ kind: "clean", label: `Deleting ${what}`, fraction: n / list.length, detail: `${n} of ${list.length}` });
      }
      log(`Deleted ${n} ${what}`);
    } catch (e) {
      setError(message(e));
    } finally {
      setJob(null);
      void scan(dir);
    }
  };
  const onFix = (f: Finding) => {
    if (!f.fix || !inv) return;
    if (f.fix.id === "clean") void deleteEntries(inv.clutter, "computer-made files");
    else if (f.fix.id === "delete-empty") void deleteEntries(inv.zeroBytes, "empty files");
    else if (f.fix.id === "delete-orphans") void deleteEntries(inv.orphans, "orphaned proxies");
    else if (f.fix.id === "empty-trash") void deleteEntries(inv.trash, "files in the card's Trash");
    else if (f.fix.id === "delete-repair" && layout) void deleteFolders(layout.repairs.map((r) => r.folder), "repair leftovers", layout.repairs.reduce((a, r) => a + r.bytes, 0), false);
    else if (f.fix.id === "delete-stray" && layout) void deleteFolders(layout.stray.filter((f) => f.folder).map((f) => f.folder), "recordings the camera does not see", layout.strayBytes, true);
  };
  const cancel = () => abortRef.current?.abort();

  /* ------------------------------------------------------------ judging */
  const space = inv ? spaceView(capacity, used, fill?.trueFree ?? volume?.freeBytes ?? null) : null;
  const judged: Judged | null = inv ? { inventory: inv, layout, volume, space, speed, fill, recordings, profile, bitrateMbps, cardGb: capacity / 1e9 } : null;
  const list = judged ? judge(judged) : [];
  const guide = judged ? repairGuide(judged, list) : [];
  // Tests hand a directory handle over and shrink the tests.
  useEffect(() => {
    expose({
      open: (h: FileSystemDirectoryHandle) => open(h),
      options: (o: typeof testOptions) => Object.assign(testOptions, o),
      setVolumeText: (t: string) => setVolumeText(t),
      getState: () => ({ dir: dir?.name ?? null, files: inv?.files ?? null, bytes: inv?.bytes ?? null, job: job?.kind ?? null, recordings, speed, readSpeed, fill, events, error, volume, layout: layout ? { stray: layout.stray, repairs: layout.repairs, named: layout.namedOnComputer, isRoot: layout.isRoot } : null, findings: list.map((f) => f.id), guide: guide.map((g) => g.id) }),
    });
  });
  const need = needMBps(bitrateMbps);
  const copy = async () => {
    if (!judged) return;
    try {
      await navigator.clipboard.writeText(reportText(judged, list));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* refused */
    }
  };

  /* ------------------------------------------------------------ view */
  const controls = (
    <div className="space-y-3">
      <div className={cn("panel registered space-y-3 p-4", dragging && "border-accent")} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => void onDrop(e)} data-storage-drop>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void pick()} disabled={!!job} className={cn(PRIMARY, "h-9")} data-storage-pick>
            <FolderOpen size={14} /> {dir ? "Open another card" : "Open the card"}
          </button>
          {dir ? (
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink" data-storage-dir>
              {dir.name}
            </span>
          ) : (
            <span className="text-[12.5px] text-muted">Pick the card (its root folder) or drop it here · nothing is uploaded</span>
          )}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-[12.5px] text-muted">
            Camera
            <select value={profile.id} onChange={(e) => { void setCamId(e.target.value); void setBitrateParam(null); }} className={cn(SEL, "mt-1 w-full")} data-storage-camera>
              {CAMERAS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[12.5px] text-muted">
            Card size
            <select value={CARD_SIZES_GB.includes(cardGb) ? cardGb : "custom"} onChange={(e) => e.target.value !== "custom" && void setCardGb(Number(e.target.value))} className={cn(SEL, "mt-1 w-full")} data-storage-capacity>
              {CARD_SIZES_GB.map((g) => (
                <option key={g} value={g}>
                  {g >= 1000 ? `${g / 1000} TB` : `${g} GB`}
                </option>
              ))}
              {!CARD_SIZES_GB.includes(cardGb) && <option value="custom">{cardGb} GB</option>}
            </select>
          </label>
          <label className="text-[12.5px] text-muted">
            Bitrate of the heaviest mode
            <span className="mt-1 flex items-center gap-1.5">
              <input type="number" min={1} max={2000} value={bitrateMbps} onChange={(e) => void setBitrateParam(Number(e.target.value) || null)} className={cn(INPUT, "w-24 font-mono")} aria-label="Bitrate, Mbps" data-storage-bitrate />
              <span>Mbps → needs {(bitrateMbps / 8).toFixed(1)} MB/s, {need.toFixed(0)} with headroom</span>
            </span>
          </label>
          <div className="text-[12px] text-faint sm:pt-5">{profile.mode}. {profile.notes}</div>
        </div>
      </div>

      <div className="panel space-y-3 p-4" data-storage-tests>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium text-ink">Tests</span>
          <span className="text-[12px] text-faint">write into a BENCH_CARD_DOCTOR folder on the card, read back, verify, delete</span>
          {job && (
            <button type="button" onClick={cancel} className={cn(GHOST, "ml-auto h-8")} data-storage-cancel>
              <Square size={13} /> Cancel
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <button type="button" onClick={() => void runSpeed()} disabled={!dir || !!job} className={cn(GHOST, "h-8")} data-storage-speed>
            <Gauge size={13} /> Speed test
          </button>
          <label className="flex items-center gap-1">
            of
            <select value={speedGb} onChange={(e) => void setSpeedGb(Number(e.target.value))} className={cn(SEL, "h-7 text-[12px]")} aria-label="Speed test size" data-storage-speed-size>
              {[1, 4, 8, 32].map((g) => (
                <option key={g} value={g}>
                  {g} GB
                </option>
              ))}
            </select>
          </label>
          <span className="text-faint">· burst, sustained, the cache cliff, read-back</span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
          <button type="button" onClick={() => void runFill()} disabled={!dir || !inv || !!job} className={cn(GHOST, "h-8")} data-storage-fill>
            <Activity size={13} /> Fill test
          </button>
          <label className="flex items-center gap-1">
            until
            <input type="number" min={0} max={cardGb} value={marginGb} onChange={(e) => void setMarginGb(Math.max(0, Number(e.target.value) || 0))} className={cn(INPUT, "w-20 font-mono")} aria-label="Stop with this many GB free" data-storage-margin />
            GB remain
          </label>
          <span className="text-faint">· speed against the space left, true free space, fake-capacity check{inv ? ` · about ${fmtDuration((Math.max(0, capacity - used - marginGb * 1e9) / 60e6) * 1000)}` : ""}</span>
        </div>
        {job && (
          <div className="space-y-1 text-[12.5px]" data-storage-job={job.kind}>
            <div className="flex items-center gap-2 text-muted">
              <Loader size={13} className="animate-spin text-accent" />
              <span className="text-ink">{job.label}</span>
              <span className="font-mono tabular" data-storage-job-detail>
                {job.detail}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-raised">{job.fraction !== null ? <div className="h-full bg-accent transition-[width]" style={{ width: `${Math.min(100, job.fraction * 100)}%` }} /> : <div className="h-full w-1/3 animate-pulse bg-accent" />}</div>
          </div>
        )}
        {error && (
          <p className="flex items-center gap-1.5 text-[12.5px] text-danger" data-storage-error>
            <AlertTriangle size={13} /> {error}
          </p>
        )}
      </div>

      <div className="panel space-y-2 p-4" data-storage-volume>
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-medium text-ink">Volume details</span>
          <span className="text-[12px] text-faint">what a browser cannot see: the file system, cluster size, exact space, TRIM</span>
        </div>
        <div className="grid gap-1 text-[12px] text-muted sm:grid-cols-2">
          <div>
            macOS Terminal: <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11.5px] text-ink">diskutil info /Volumes/{dir?.name || "CARD"}</code>
          </div>
          <div>
            Windows Command Prompt: <code className="rounded bg-raised px-1 py-0.5 font-mono text-[11.5px] text-ink">fsutil fsinfo ntfsinfo E: &amp; fsutil fsinfo volumeinfo E:</code>
          </div>
        </div>
        <textarea value={volumeText} onChange={(e) => setVolumeText(e.target.value)} rows={3} placeholder="Paste the output here" className={cn(INPUT, "w-full resize-y font-mono text-[11.5px]")} aria-label="Volume details" data-storage-volume-text />
        {volumeText.trim() &&
          (volume ? (
            <p className="font-mono text-[12px] text-ink" data-storage-volume-parsed data-state="read">
              {[volume.fileSystem, volume.clusterBytes ? `${volume.clusterBytes / 1024} KB clusters` : null, volume.totalBytes ? `${fmtGb(volume.totalBytes)} total` : null, volume.freeBytes !== undefined ? `${fmtGb(volume.freeBytes)} free` : null, volume.name ? `“${volume.name}”` : null, volume.solidState ? "SSD" : volume.removable ? "removable" : null, volume.trim === undefined ? null : volume.trim ? "TRIM on" : "TRIM off"].filter(Boolean).join(" · ")}
            </p>
          ) : (
            <p className="text-[12px] text-warn" data-storage-volume-parsed data-state="unknown">
              Nothing recognised in that text — paste the whole output of the command.
            </p>
          ))}
      </div>

      {inv && (
        <div className="panel space-y-2 p-4 text-[12.5px]" data-storage-inventory>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-ink">On the card</span>
            <span className="font-mono text-ink" data-storage-used>
              {inv.files.toLocaleString()} files · {fmtGb(inv.bytes)}
            </span>
            {space && (
              <span className={cn("font-mono", space.state === "ok" ? "text-positive" : space.state === "warn" ? "text-warn" : "text-danger")} data-storage-free data-state={space.state}>
                {fmtGb(space.free)} free ({(space.freeShare * 100).toFixed(1)}%)
              </span>
            )}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-raised" title="Used against the card's size">
            <div className={cn("h-full", space && space.state !== "ok" ? "bg-warn" : "bg-accent")} style={{ width: `${Math.min(100, (inv.bytes / Math.max(1, capacity)) * 100)}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted">
            {(["video", "proxy", "image", "audio", "sidecar", "other", "clutter", "trash", "repair"] as const).filter((k) => inv.byKind[k].files).map((k) => (
              <span key={k}>
                {inv.byKind[k].files} {k === "proxy" ? "proxies" : k === "clutter" ? "computer files" : k === "trash" ? "in the card's Trash" : k === "repair" ? "repair fragments" : k === "sidecar" ? "sidecars" : `${k}s`} · {fmtGb(inv.byKind[k].bytes)}
              </span>
            ))}
          </div>
          <div className="text-muted">
            {inv.folders.slice(0, 4).map((f) => `${f.path || "root"}: ${f.files} files, ${fmtGb(f.bytes)}`).join(" · ")}
            {inv.folders.length > 4 ? ` · ${inv.folders.length - 4} more folders` : ""}
          </div>
          {inv.newest && inv.oldest && <div className="text-faint">Recordings from {new Date(inv.oldest.lastModified).toLocaleDateString()} to {new Date(inv.newest.lastModified).toLocaleDateString()} · largest {fmtGb(inv.largest[0]?.size ?? 0)} ({inv.largest[0]?.name})</div>}
        </div>
      )}
    </div>
  );

  const results = (
    <div className="space-y-3">
      {!inv && !job && (
        <div className="panel p-4 text-[13px] text-muted">
          <p>Open the card and the doctor reads what is on it, how much room is left and whether every recording was closed properly. Then time it: the speed test shows the burst, the sustained rate and where the cache runs out; the fill test writes the card full to find where the speed falls under what the camera needs, which is where a card that works when empty stops recording when it is nearly full.</p>
        </div>
      )}
      {(speed || readSpeed) && (
        <div className="panel space-y-2 p-4" data-storage-speed-result>
          <div className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
            <span className="font-medium text-ink">Write</span>
            {speed && (
              <span className="font-mono text-ink" data-storage-write-stats>
                burst {speed.burst.toFixed(0)} · sustained {speed.sustained.toFixed(0)} · low {speed.worst.toFixed(0)} MB/s{speed.cliffAt !== null ? ` · cache ${fmtGb(speed.cliffAt)}` : ""}
              </span>
            )}
            {readSpeed && (
              <span className="font-mono text-muted" data-storage-read-stats>
                read {readSpeed.average.toFixed(0)} MB/s
              </span>
            )}
          </div>
          {speed && <SpeedChart series={speed.series} need={need} cliffAt={speed.cliffAt} />}
        </div>
      )}
      {fill && fill.points.length > 0 && (
        <div className="panel space-y-2 p-4" data-storage-fill-result>
          <div className="flex flex-wrap items-baseline gap-x-3 text-[12.5px]">
            <span className="font-medium text-ink">Speed against the space left</span>
            <span className="font-mono text-ink" data-storage-fill-stats>
              {fill.points.length} files · slowest {Math.min(...fill.points.map((p) => p.mbps)).toFixed(0)} MB/s{fill.fallsAtFree !== null ? ` · falls under ${need.toFixed(0)} MB/s below ${fmtGb(fill.fallsAtFree)} free` : ""}{fill.trueFree !== null ? ` · ${fmtGb(fill.trueFree)} truly free` : ""}
            </span>
          </div>
          <FillChart points={fill.points} need={need} />
        </div>
      )}
      {list.length > 0 && (
        <div className="panel space-y-2 p-4" data-storage-findings>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-ink">Findings</span>
            <span className="text-[12px] text-faint" data-storage-verdict>
              {list.filter((f) => f.severity === "error").length ? `${list.filter((f) => f.severity === "error").length} problem${list.filter((f) => f.severity === "error").length === 1 ? "" : "s"}` : list.filter((f) => f.severity === "warn").length ? `${list.filter((f) => f.severity === "warn").length} warning${list.filter((f) => f.severity === "warn").length === 1 ? "" : "s"}` : "nothing wrong found"}
            </span>
            <button type="button" onClick={() => void copy()} className={cn(GHOST, "ml-auto h-7 px-2 text-[12px]")} data-storage-copy>
              <Copy size={12} /> {copied ? "Copied" : "Copy the report"}
            </button>
          </div>
          <ul className="space-y-2.5 text-[12.5px]">
            {list.map((f) => (
              <li key={f.id} className="space-y-0.5" data-finding={f.id} data-severity={f.severity}>
                <div className="flex flex-wrap items-center gap-2">
                  {SEVERITY_ICON[f.severity]}
                  <span className="font-medium text-ink">{f.title}</span>
                  <span className="text-[11px] uppercase tracking-wide text-faint">{SEVERITY_LABEL[f.severity]}</span>
                  {f.fix && (
                    <span className="ml-auto">
                      {f.fix.href ? (
                        <Link href={f.fix.href} className={cn(GHOST, "h-7 px-2 text-[12px] no-underline")} title={f.fix.detail} data-fix={f.fix.id}>
                          {f.fix.label}
                        </Link>
                      ) : ["clean", "delete-empty", "delete-orphans", "empty-trash", "delete-repair", "delete-stray"].includes(f.fix.id) ? (
                        <button type="button" onClick={() => onFix(f)} disabled={!!job} className={cn(GHOST, "h-7 border-accent px-2 text-[12px] text-accent")} title={f.fix.detail} data-fix={f.fix.id}>
                          <Trash2 size={12} /> {f.fix.label}
                        </button>
                      ) : (
                        <span className="text-[12px] text-muted" title={f.fix.detail} data-fix={f.fix.id}>
                          {f.fix.label}
                        </span>
                      )}
                    </span>
                  )}
                </div>
                <p className="pl-[22px] text-ink">{f.what}</p>
                <p className="pl-[22px] text-[12px] text-muted">
                  {f.why}
                  {f.fix ? ` ${f.fix.detail}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
      {guide.length > 0 && (
        <div className="panel space-y-2 p-4" data-storage-guide>
          <div className="flex flex-wrap items-center gap-2">
            <Wrench size={14} className="text-accent" />
            <span className="font-medium text-ink">Repair and refresh</span>
            <span className="text-[12px] text-faint">what to do about it, in order — the part a browser cannot do itself</span>
          </div>
          <ol className="space-y-2 text-[12.5px]">
            {guide.map((s, i) => (
              <li key={s.id} className="space-y-0.5" data-guide-step={s.id}>
                <div className="font-medium text-ink">
                  {i + 1}. {s.title}
                </div>
                <p className="text-muted">{s.detail}</p>
                {s.command && <code className="block w-fit max-w-full overflow-x-auto rounded bg-raised px-2 py-1 font-mono text-[11.5px] text-ink">{s.command}</code>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {events.length > 0 && (
        <div className="panel p-3 font-mono text-[11.5px] text-muted" data-storage-events>
          {events.slice(-8).map((e, i) => (
            <div key={i}>{e}</div>
          ))}
        </div>
      )}
    </div>
  );

  return <SplitPane id="storage-doctor" defaultRatio={0.46} minFirst={300} minSecond={300} collapsible="both" firstLabel="card and tests" secondLabel="results" first={controls} second={results} />;
}

/* ------------------------------------------------------------------ charts */

function SpeedChart({ series, need, cliffAt }: { series: { at: number; mbps: number }[]; need: number; cliffAt: number | null }) {
  const W = 600, H = 140, P = 28;
  const maxX = Math.max(1, series[series.length - 1]?.at ?? 1), maxY = Math.max(need * 1.2, ...series.map((p) => p.mbps)) || 1;
  const x = (v: number) => P + (v / maxX) * (W - P - 8), y = (v: number) => H - P + 4 - (v / maxY) * (H - P - 10);
  const path = series.map((p, i) => `${i ? "L" : "M"}${x(p.at).toFixed(1)},${y(p.mbps).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label="Write speed over the test" data-storage-chart="speed">
      <line x1={P} x2={W - 8} y1={y(need)} y2={y(need)} stroke="currentColor" strokeDasharray="4 3" className="text-warn" />
      <text x={W - 8} y={y(need) - 3} textAnchor="end" className="fill-current text-[10px] text-warn">need {need.toFixed(0)} MB/s</text>
      {cliffAt !== null && <line x1={x(cliffAt)} x2={x(cliffAt)} y1={6} y2={H - P + 4} stroke="currentColor" strokeDasharray="2 3" className="text-faint" />}
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
      <text x={P} y={H - 6} className="fill-current text-[10px] text-faint">0</text>
      <text x={W - 8} y={H - 6} textAnchor="end" className="fill-current text-[10px] text-faint">{fmtGb(maxX)}</text>
      <text x={4} y={12} className="fill-current text-[10px] text-faint">{maxY.toFixed(0)} MB/s</text>
    </svg>
  );
}
function FillChart({ points, need }: { points: { free: number; mbps: number }[]; need: number }) {
  const W = 600, H = 140, P = 28;
  const sorted = [...points].sort((a, b) => b.free - a.free);
  const maxX = Math.max(1, sorted[0]?.free ?? 1), maxY = Math.max(need * 1.2, ...points.map((p) => p.mbps)) || 1;
  const x = (free: number) => P + ((maxX - free) / maxX) * (W - P - 8), y = (v: number) => H - P + 4 - (v / maxY) * (H - P - 10);
  const path = sorted.map((p, i) => `${i ? "L" : "M"}${x(p.free).toFixed(1)},${y(p.mbps).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full" role="img" aria-label="Write speed against free space" data-storage-chart="fill">
      <line x1={P} x2={W - 8} y1={y(need)} y2={y(need)} stroke="currentColor" strokeDasharray="4 3" className="text-warn" />
      <path d={path} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
      <text x={P} y={H - 6} className="fill-current text-[10px] text-faint">{fmtGb(maxX)} free</text>
      <text x={W - 8} y={H - 6} textAnchor="end" className="fill-current text-[10px] text-faint">{fmtGb(sorted[sorted.length - 1]?.free ?? 0)} free</text>
      <text x={4} y={12} className="fill-current text-[10px] text-faint">{maxY.toFixed(0)} MB/s</text>
    </svg>
  );
}
