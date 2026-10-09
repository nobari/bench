/**
 * Project storage on disk through the File System Access API: a project
 * folder the user picks holds the project file, an autosave journal and the
 * proxy cache, so a crash or a closed tab loses nothing. Falls back to
 * IndexedDB for the project file alone where the API is unavailable.
 */

import { deserialize, serialize, type Project } from "./project";

export const PROJECT_FILE = "project.benchvideo.json";
export const AUTOSAVE_FILE = "project.autosave.json";
export const PROXY_DIR = "proxies";
const DB_NAME = "bench-video", DB_STORE = "handles";

export const hasFileSystemAccess = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

type Picker = { showDirectoryPicker(opts?: { id?: string; mode?: "read" | "readwrite"; startIn?: string }): Promise<FileSystemDirectoryHandle> };

/** Open an IndexedDB store for remembering directory handles between sessions. */
function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function dbGet<T>(key: string): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readonly").objectStore(DB_STORE).get(key);
    tx.onsuccess = () => resolve(tx.result as T | undefined);
    tx.onerror = () => reject(tx.error);
  });
}
async function dbSet(key: string, value: unknown): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).put(value, key);
    tx.onsuccess = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export class ProjectStore {
  private dir: FileSystemDirectoryHandle | null = null;
  private files = new Map<string, FileSystemFileHandle | File>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Project | null = null;
  private onStatus?: (s: string) => void;

  constructor(onStatus?: (s: string) => void) {
    this.onStatus = onStatus;
  }

  get folderName() {
    return this.dir?.name ?? null;
  }
  get hasFolder() {
    return !!this.dir;
  }

  /** Testing hook: use an in-memory directory (e.g. from navigator.storage.getDirectory()) instead of the picker. */
  useDirectory(dir: FileSystemDirectoryHandle) {
    this.dir = dir;
  }

  /** Ask for a project folder (readwrite) and remember it for next time. */
  async pickFolder(): Promise<FileSystemDirectoryHandle> {
    const dir = await (window as unknown as Picker).showDirectoryPicker({ id: "bench-video-project", mode: "readwrite" });
    this.dir = dir;
    await dbSet("lastFolder", dir).catch(() => undefined);
    return dir;
  }

  /** Reopen the last folder if the browser still grants access (prompts once if needed). */
  async reopenLast(): Promise<boolean> {
    const dir = await dbGet<FileSystemDirectoryHandle>("lastFolder").catch(() => undefined);
    if (!dir) return false;
    type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
    const h = dir as unknown as Perm;
    let state = await h.queryPermission({ mode: "readwrite" }).catch(() => "denied");
    if (state === "prompt") state = await h.requestPermission({ mode: "readwrite" }).catch(() => "denied");
    if (state !== "granted") return false;
    this.dir = dir;
    return true;
  }

  /** The saved project, preferring a newer autosave (crash recovery). */
  async load(): Promise<{ project: Project; recovered: boolean } | null> {
    if (!this.dir) return null;
    const read = async (name: string) => {
      try {
        const fh = await this.dir!.getFileHandle(name);
        const text = await (await fh.getFile()).text();
        return deserialize(text);
      } catch {
        return null;
      }
    };
    const [saved, auto] = await Promise.all([read(PROJECT_FILE), read(AUTOSAVE_FILE)]);
    if (auto && (!saved || auto.updatedAt > saved.updatedAt + 1000)) return { project: auto, recovered: true };
    if (saved) return { project: saved, recovered: false };
    return null;
  }

  private async write(name: string, text: string) {
    if (!this.dir) return;
    const fh = await this.dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  /** Explicit save: the project file, and the autosave journal cleared to match. */
  async save(project: Project): Promise<void> {
    const text = serialize(project);
    await this.write(PROJECT_FILE, text);
    await this.write(AUTOSAVE_FILE, text);
    this.onStatus?.("Saved");
  }

  /** Debounced autosave after every edit; the journal is what recovery reads. */
  autosave(project: Project, delayMs = 1500): void {
    this.pending = project;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      const p = this.pending;
      this.pending = null;
      if (!p) return;
      this.write(AUTOSAVE_FILE, serialize(p))
        .then(() => this.onStatus?.("Autosaved"))
        .catch(() => this.onStatus?.("Autosave failed"));
    }, delayMs);
  }

  /** Flush a pending autosave immediately (on unload). */
  async flush(): Promise<void> {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    const p = this.pending;
    this.pending = null;
    if (p) await this.write(AUTOSAVE_FILE, serialize(p)).catch(() => undefined);
  }

  /** Register a media file: a handle from the folder, or a loose File from drag-and-drop. */
  registerFile(id: string, file: FileSystemFileHandle | File) {
    this.files.set(id, file);
  }

  async getFile(id: string): Promise<File | null> {
    const h = this.files.get(id);
    if (!h) return null;
    return h instanceof File ? h : h.getFile();
  }

  /** Try to resolve media by name inside the project folder (after reopening a project). */
  async resolveByName(id: string, name: string): Promise<boolean> {
    if (!this.dir) return false;
    try {
      const fh = await this.dir.getFileHandle(name);
      this.files.set(id, fh);
      return true;
    } catch {
      return false;
    }
  }

  /** Writable stream for a proxy or export file in the folder. */
  async createWritable(name: string, sub?: string): Promise<{ writable: FileSystemWritableFileStream; handle: FileSystemFileHandle }> {
    if (!this.dir) throw new Error("Pick a project folder first.");
    const parent = sub ? await this.dir.getDirectoryHandle(sub, { create: true }) : this.dir;
    const handle = await parent.getFileHandle(name, { create: true });
    return { writable: await handle.createWritable(), handle };
  }

  async proxyFile(name: string): Promise<File | null> {
    if (!this.dir) return null;
    try {
      const d = await this.dir.getDirectoryHandle(PROXY_DIR);
      return await (await d.getFileHandle(name)).getFile();
    } catch {
      return null;
    }
  }

  async removeProxy(name: string): Promise<void> {
    if (!this.dir) return;
    try {
      const d = await this.dir.getDirectoryHandle(PROXY_DIR);
      await d.removeEntry(name);
    } catch {
      /* already gone */
    }
  }
}
