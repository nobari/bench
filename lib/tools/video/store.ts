/**
 * Project storage on disk through the File System Access API: a project
 * folder the user picks holds the project file, an autosave journal and the
 * proxy cache, so a crash or a closed tab loses nothing. Falls back to
 * IndexedDB for the project file alone where the API is unavailable.
 */

import { deserialize, serialize, type Project, type MediaWhere } from "./project";

export const PROJECT_FILE = "project.benchvideo.json";
export const AUTOSAVE_FILE = "project.autosave.json";
export const PROXY_DIR = "proxies";
/** Full-resolution stills saved from the preview live here, inside the project folder. */
export const FRAMES_DIR = "frames";
const DB_NAME = "bench-video", DB_STORE = "handles";

export const hasFileSystemAccess = () => typeof window !== "undefined" && "showDirectoryPicker" in window;

type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
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
async function dbDelete(key: string): Promise<void> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(DB_STORE, "readwrite").objectStore(DB_STORE).delete(key);
    tx.onsuccess = () => resolve();
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

/** Remember a folder under a key another tool reads — the Shorts Maker hands a short's folder to the editor this way. */
export const rememberFolder = (key: string, dir: FileSystemDirectoryHandle) => dbSet(key, dir).catch(() => undefined);
/** The folder remembered under a key, if the browser still has it (permission may still need asking). */
export const rememberedFolder = (key: string) => dbGet<FileSystemDirectoryHandle>(key).catch(() => undefined);

export class ProjectStore {
  private dir: FileSystemDirectoryHandle | null = null;
  /** Folders outside the project the user asked to remember, by key (persisted per project). */
  private extra = new Map<string, FileSystemDirectoryHandle>();
  private files = new Map<string, FileSystemFileHandle | File>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private pending: Project | null = null;
  private onStatus?: (s: string) => void;

  /** The IndexedDB key the last folder is remembered under, and the picker's id (its own starting place) — each tool its own. */
  private readonly lastKey: string;
  private readonly pickerId: string;

  constructor(onStatus?: (s: string) => void, opts: { lastKey?: string; pickerId?: string } = {}) {
    this.onStatus = onStatus;
    this.lastKey = opts.lastKey ?? "lastFolder";
    this.pickerId = opts.pickerId ?? "bench-video-project";
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
    const dir = await (window as unknown as Picker).showDirectoryPicker({ id: this.pickerId, mode: "readwrite" });
    this.dir = dir;
    await dbSet(this.lastKey, dir).catch(() => undefined);
    return dir;
  }

  /** Point the store at a folder already in hand (a sub-folder of another store's, say) and remember it as the last one. */
  async adopt(dir: FileSystemDirectoryHandle, remember = true): Promise<void> {
    this.dir = dir;
    this.files.clear();
    this.extra.clear();
    if (remember) await dbSet(this.lastKey, dir).catch(() => undefined);
  }

  /** The folder handle itself, for another store to open a sub-folder of it. */
  get directory(): FileSystemDirectoryHandle | null {
    return this.dir;
  }

  /** Every file handle registered here, to hand to another store that shares the files. */
  handles(): [string, FileSystemFileHandle | File][] {
    return [...this.files.entries()];
  }

  /** Reopen the last folder if the browser still grants access (prompts once if needed). */
  async reopenLast(): Promise<boolean> {
    const dir = await dbGet<FileSystemDirectoryHandle>(this.lastKey).catch(() => undefined);
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

  /** Explicit save: the project file, the autosave journal cleared to match, and every file handle remembered. */
  async save(project: Project): Promise<void> {
    const text = serialize(project);
    await this.write(PROJECT_FILE, text);
    await this.write(AUTOSAVE_FILE, text);
    await this.persistHandles(project.id);
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

  /** Drop a pending autosave without writing it. */
  cancelAutosave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = null;
    this.pending = null;
  }

  /**
   * Forget the project in this browser: the remembered folder handle and
   * anything pending. Nothing on disk changes.
   */
  async forget(projectId?: string): Promise<void> {
    this.cancelAutosave();
    this.dir = null;
    this.files.clear();
    await dbDelete(this.lastKey).catch(() => undefined);
    if (projectId) await dbDelete(`files:${projectId}`).catch(() => undefined);
  }

  /** Delete the project file and autosave from the folder — only the two files this tool writes; recordings are never touched. */
  async removeProjectFiles(): Promise<string[]> {
    if (!this.dir) return [];
    const removed: string[] = [];
    for (const name of [PROJECT_FILE, AUTOSAVE_FILE]) {
      try {
        await this.dir.removeEntry(name);
        removed.push(name);
      } catch {
        /* not there */
      }
    }
    return removed;
  }

  /** Delete the rendered proxies folder; it can be rebuilt any time. */
  async removeProxies(): Promise<boolean> {
    if (!this.dir) return false;
    try {
      await this.dir.removeEntry(PROXY_DIR, { recursive: true });
      return true;
    } catch {
      return false;
    }
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

  hasFile(id: string): boolean {
    return this.files.has(id);
  }

  handleOf(id: string): FileSystemFileHandle | File | null {
    return this.files.get(id) ?? null;
  }

  /** Media ids with no file behind them (after a reload, say). */
  missing(ids: string[]): string[] {
    return ids.filter((id) => !this.files.has(id));
  }

  /**
   * Remember the file handles (not plain Files) in the browser, keyed by
   * project, so recordings that live outside the project folder come back
   * after a reload.
   */
  async persistHandles(projectId: string): Promise<void> {
    const entries = [...this.files.entries()].filter(([, h]) => !(h instanceof File));
    await dbSet(`files:${projectId}`, entries).catch(() => undefined);
  }

  /** Restore remembered handles; permission can only be asked for during a user gesture (interactive). Returns the ids restored. */
  async restoreHandles(projectId: string, interactive: boolean): Promise<string[]> {
    const entries = await dbGet<[string, FileSystemFileHandle][]>(`files:${projectId}`).catch(() => undefined);
    if (!entries) return [];
    type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
    const restored: string[] = [];
    for (const [id, handle] of entries) {
      if (this.files.has(id)) continue;
      const h = handle as unknown as Perm;
      let state = await h.queryPermission({ mode: "read" }).catch(() => "denied");
      if (state === "prompt" && interactive) state = await h.requestPermission({ mode: "read" }).catch(() => "denied");
      if (state === "granted") {
        this.files.set(id, handle);
        restored.push(id);
      }
    }
    return restored;
  }

  /**
   * Remembered files and folders the browser will hand back only after a click (their permission reads "prompt"),
   * not yet restored: what one Reconnect would bring back.
   */
  async pendingHandles(projectId: string): Promise<number> {
    let n = 0;
    const files = await dbGet<[string, FileSystemFileHandle][]>(`files:${projectId}`).catch(() => undefined);
    for (const [id, handle] of files ?? []) {
      if (this.files.has(id)) continue;
      if ((await (handle as unknown as Perm).queryPermission({ mode: "read" }).catch(() => "denied")) === "prompt") n++;
    }
    const folders = await dbGet<[string, FileSystemDirectoryHandle][]>(`folders:${projectId}`).catch(() => undefined);
    for (const [key, dir] of folders ?? []) {
      if (this.extra.has(key)) continue;
      if ((await (dir as unknown as Perm).queryPermission({ mode: "read" }).catch(() => "denied")) === "prompt") n++;
    }
    return n;
  }

  /** Where a handle lives relative to the project folder or a remembered folder, or null when it is in neither. */
  async whereIs(h: FileSystemFileHandle | File): Promise<MediaWhere | null> {
    if (h instanceof File) return null;
    const inside = async (dir: FileSystemDirectoryHandle) => {
      try {
        return await dir.resolve(h);
      } catch {
        return null;
      }
    };
    if (this.dir) {
      const rel = await inside(this.dir);
      if (rel) return { folder: "project", path: rel.join("/") };
    }
    for (const [key, dir] of this.extra) {
      const rel = await inside(dir);
      if (rel) return { folder: key, path: rel.join("/") };
    }
    return null;
  }

  /** Remember a folder for this project; returns its key. */
  async addFolder(projectId: string, dir: FileSystemDirectoryHandle): Promise<string> {
    for (const [key, d] of this.extra) if (await d.isSameEntry(dir).catch(() => false)) return key;
    const key = `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    this.extra.set(key, dir);
    await dbSet(`folders:${projectId}`, [...this.extra.entries()]).catch(() => undefined);
    return key;
  }

  /** Bring back the remembered folders (asking for permission only during a user gesture). */
  async loadFolders(projectId: string, interactive: boolean): Promise<string[]> {
    const entries = await dbGet<[string, FileSystemDirectoryHandle][]>(`folders:${projectId}`).catch(() => undefined);
    if (!entries) return [];
    type Perm = { queryPermission(o: { mode: string }): Promise<string>; requestPermission(o: { mode: string }): Promise<string> };
    const ok: string[] = [];
    for (const [key, dir] of entries) {
      if (this.extra.has(key)) {
        ok.push(key);
        continue;
      }
      const h = dir as unknown as Perm;
      let state = await h.queryPermission({ mode: "read" }).catch(() => "denied");
      if (state === "prompt" && interactive) state = await h.requestPermission({ mode: "read" }).catch(() => "denied");
      if (state === "granted") {
        this.extra.set(key, dir);
        ok.push(key);
      }
    }
    return ok;
  }

  folderKeys(): string[] {
    return [...this.extra.keys()];
  }

  /** Find a media file again from its recorded place; true when it is back. */
  async locateByPath(id: string, where: MediaWhere): Promise<boolean> {
    const root = where.folder === "project" ? this.dir : this.extra.get(where.folder);
    if (!root) return false;
    try {
      const parts = where.path.split("/").filter(Boolean);
      let dir = root;
      for (const seg of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(seg);
      const fh = await dir.getFileHandle(parts[parts.length - 1]);
      this.files.set(id, fh);
      return true;
    } catch {
      return false;
    }
  }

  /** Look for a file by name in a remembered folder, one level deep; returns where it was found. */
  async findInFolder(key: string, name: string, id: string): Promise<MediaWhere | null> {
    const root = key === "project" ? this.dir : this.extra.get(key);
    if (!root) return null;
    type Listable = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };
    const scan = async (dir: FileSystemDirectoryHandle, prefix: string, depth: number): Promise<MediaWhere | null> => {
      for await (const [entryName, h] of (dir as Listable).entries()) {
        if (h.kind === "file" && entryName === name) {
          this.files.set(id, h as FileSystemFileHandle);
          return { folder: key, path: prefix + entryName };
        }
      }
      if (depth > 0) {
        for await (const [entryName, h] of (dir as Listable).entries()) {
          if (h.kind === "directory") {
            const found = await scan(h as FileSystemDirectoryHandle, `${prefix}${entryName}/`, depth - 1);
            if (found) return found;
          }
        }
      }
      return null;
    };
    try {
      return await scan(root, "", 1);
    } catch {
      return null;
    }
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
  /**
   * Where a name points: "shorts/01 Drive.mp4" names a file in a sub-folder, so the folder part joins `sub`; every
   * file method below takes names of that shape, which lets a list of files span the folder and its sub-folders.
   */
  private place(name: string, sub?: string): { name: string; sub?: string } {
    const i = name.lastIndexOf("/");
    if (i < 0) return { name, sub };
    const folder = name.slice(0, i), base = name.slice(i + 1);
    return { name: base, sub: sub ? `${sub}/${folder}` : folder };
  }
  private async folderFor(sub: string | undefined, create: boolean): Promise<FileSystemDirectoryHandle> {
    if (!this.dir) throw new Error("Pick a project folder first.");
    let dir = this.dir;
    for (const part of (sub ?? "").split("/").filter(Boolean)) dir = await dir.getDirectoryHandle(part, { create });
    return dir;
  }

  async createWritable(name: string, sub?: string): Promise<{ writable: FileSystemWritableFileStream; handle: FileSystemFileHandle }> {
    const at = this.place(name, sub);
    const parent = await this.folderFor(at.sub, true);
    const handle = await parent.getFileHandle(at.name, { create: true });
    return { writable: await handle.createWritable(), handle };
  }

  /** A file in the folder (or a sub-folder), or null when it is not there. */
  async fileIn(name: string, sub?: string): Promise<File | null> {
    if (!this.dir) return null;
    try {
      const at = this.place(name, sub);
      const parent = await this.folderFor(at.sub, false);
      return await (await parent.getFileHandle(at.name)).getFile();
    } catch {
      return null;
    }
  }

  async writeText(name: string, text: string, sub?: string): Promise<void> {
    const at = this.place(name, sub);
    const parent = await this.folderFor(at.sub, true);
    const fh = await parent.getFileHandle(at.name, { create: true });
    const w = await fh.createWritable();
    await w.write(text);
    await w.close();
  }

  async readText(name: string, sub?: string): Promise<string | null> {
    const f = await this.fileIn(name, sub);
    return f ? f.text() : null;
  }

  /** Removes a file (or, with no name, a whole sub-folder); nothing happens when it is already gone. */
  async remove(name: string | null, sub?: string): Promise<void> {
    if (!this.dir) return;
    try {
      if (name === null) {
        if (sub) {
          const parts = sub.split("/").filter(Boolean);
          const parent = await this.folderFor(parts.slice(0, -1).join("/"), false);
          await parent.removeEntry(parts[parts.length - 1], { recursive: true });
        }
        return;
      }
      const at = this.place(name, sub);
      const parent = await this.folderFor(at.sub, false);
      await parent.removeEntry(at.name);
    } catch {
      /* already gone */
    }
  }

  /** Files at the top of the project folder (or of one sub-folder, named "sub/file"), newest first; sub-folders excluded. */
  async listFiles(sub?: string): Promise<{ name: string; size: number; lastModified: number }[]> {
    if (!this.dir) return [];
    const out: { name: string; size: number; lastModified: number }[] = [];
    try {
      const dir = await this.folderFor(sub, false);
      for await (const [name, h] of dir as unknown as AsyncIterable<[string, FileSystemHandle]>) {
        if (h.kind !== "file") continue;
        try {
          const f = await (h as FileSystemFileHandle).getFile();
          out.push({ name: sub ? `${sub}/${name}` : name, size: f.size, lastModified: f.lastModified });
        } catch {
          /* unreadable entry */
        }
      }
    } catch {
      /* not iterable */
    }
    return out.sort((a, b) => b.lastModified - a.lastModified);
  }

  /** The handle of a file in the folder (or a sub-folder), for writing to it in place; null when it is not there. */
  async fileHandle(name: string, sub?: string): Promise<FileSystemFileHandle | null> {
    if (!this.dir) return null;
    try {
      const at = this.place(name, sub);
      const parent = await this.folderFor(at.sub, false);
      return await parent.getFileHandle(at.name);
    } catch {
      return null;
    }
  }

  /** Names of the sub-folders of the project folder. */
  async subFolders(): Promise<string[]> {
    if (!this.dir) return [];
    const out: string[] = [];
    try {
      for await (const [name, h] of this.dir as unknown as AsyncIterable<[string, FileSystemHandle]>) if (h.kind === "directory") out.push(name);
    } catch {
      /* not iterable */
    }
    return out;
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
