/**
 * What the browser remembers for PDF Studio: the working bytes (so a reload offers the document back), the files
 * opened lately with their handles where the File System Access API gave one, and the author's name for comments.
 * Browser-only.
 */

const DB_NAME = "bench-pdf";
const DB_STORE = "kv";
export const AUTOSAVE_KEY = "autosave";
const RECENT_KEY = "recent";
export const AUTHOR_KEY = "bench:pdf:author";
/** Beyond this the working copy is not kept between reloads (it would be slow to write on every change). */
export const AUTOSAVE_LIMIT = 200 * 1024 * 1024;

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function get<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    tx.onsuccess = () => resolve(tx.result as T | undefined);
    tx.onerror = () => reject(tx.error);
  });
}
async function set(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(value, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function del(key: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete(key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export interface Autosave {
  name: string;
  bytes: ArrayBuffer;
  savedAt: number;
  /** True when the working copy differs from the file it came from. */
  dirty: boolean;
  handle: FileSystemFileHandle | null;
}

export const saveAutosave = (a: Autosave) => set(AUTOSAVE_KEY, a).catch(() => undefined);
export const loadAutosave = () => get<Autosave>(AUTOSAVE_KEY).catch(() => undefined);
export const clearAutosave = () => del(AUTOSAVE_KEY).catch(() => undefined);

export interface RecentEntry {
  name: string;
  size: number;
  openedAt: number;
  handle: FileSystemFileHandle | null;
}

const RECENT_MAX = 8;

export async function rememberRecent(entry: RecentEntry): Promise<void> {
  try {
    const list = (await get<RecentEntry[]>(RECENT_KEY)) ?? [];
    const kept: RecentEntry[] = [];
    for (const e of list) {
      if (e.name === entry.name && e.size === entry.size) continue;
      if (entry.handle && e.handle && (await entry.handle.isSameEntry(e.handle).catch(() => false))) continue;
      kept.push(e);
    }
    await set(RECENT_KEY, [entry, ...kept].slice(0, RECENT_MAX));
  } catch {
    /* no storage */
  }
}

export const recentFiles = () => get<RecentEntry[]>(RECENT_KEY).then((l) => l ?? []).catch(() => [] as RecentEntry[]);
export const forgetRecent = () => del(RECENT_KEY).catch(() => undefined);

export function readAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_KEY) ?? "";
  } catch {
    return "";
  }
}
export function writeAuthor(name: string) {
  try {
    if (name.trim()) localStorage.setItem(AUTHOR_KEY, name.trim());
    else localStorage.removeItem(AUTHOR_KEY);
  } catch {
    /* no storage */
  }
}

/* ----------------------------------------------------------- file handles */

type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
type Pickers = {
  showOpenFilePicker(opts?: object): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(opts?: object): Promise<FileSystemFileHandle>;
};

export const hasFilePicker = () => typeof window !== "undefined" && typeof (window as unknown as Partial<Pickers>).showOpenFilePicker === "function";
export const hasSavePicker = () => typeof window !== "undefined" && typeof (window as unknown as Partial<Pickers>).showSaveFilePicker === "function";

const PDF_TYPES = [{ description: "PDF document", accept: { "application/pdf": [".pdf"] } }];

/** Asks the user for a PDF through the native picker; null when they cancel. */
export async function pickPdf(multiple = false): Promise<FileSystemFileHandle[] | null> {
  try {
    return await (window as unknown as Pickers).showOpenFilePicker({ id: "bench-pdf", types: PDF_TYPES, multiple, excludeAcceptAllOption: false });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** A place to save under a suggested name; null when the user cancels. */
export async function pickSaveTarget(suggestedName: string): Promise<FileSystemFileHandle | null> {
  try {
    return await (window as unknown as Pickers).showSaveFilePicker({ id: "bench-pdf", suggestedName, types: PDF_TYPES });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    throw e;
  }
}

/** True once the handle may be used in that mode, asking the user when the browser needs it. */
export async function ensurePermission(handle: FileSystemHandle, mode: "read" | "readwrite"): Promise<boolean> {
  const h = handle as unknown as Perm;
  let state = await h.queryPermission({ mode }).catch(() => "denied");
  if (state === "prompt") state = await h.requestPermission({ mode }).catch(() => "denied");
  return state === "granted";
}

export async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> {
  const w = await handle.createWritable();
  await w.write(bytes as unknown as BufferSource);
  await w.close();
}

export function downloadBytes(bytes: Uint8Array, name: string, type = "application/pdf"): void {
  const url = URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** "report.pdf" → "report-edited.pdf"; a suffix once, never twice. */
export function derivedName(name: string, suffix: string): string {
  const base = name.replace(/\.pdf$/i, "");
  return base.endsWith(`-${suffix}`) ? `${base}.pdf` : `${base}-${suffix}.pdf`;
}
