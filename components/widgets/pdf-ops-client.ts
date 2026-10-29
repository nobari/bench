"use client";

/**
 * The main-thread side of pdf-ops.worker.ts: one worker, requests answered in order of arrival, the parsed document
 * kept in the worker under a token so the bytes are sent only when they changed on this side.
 */
import type { PdfOp } from "@/lib/tools/files/pdf/ops";
import type { CompressReport } from "@/lib/tools/files/pdf/compress";
import type { OpsRequest, OpsResponse } from "./pdf-ops.worker";

export interface OpResult {
  /** The document after the operation: new bytes when it changed, the same object otherwise. */
  bytes: Uint8Array;
  changed: boolean;
  annotId?: string;
  files?: { name: string; bytes: Uint8Array }[];
  count?: number;
  warnings?: string[];
  report?: CompressReport;
  ms: number;
}

/** Copies every byte array inside an operation (so the caller keeps its own) and lists the copies for transfer. */
function detachBytes<T>(value: T, transfer: Transferable[]): T {
  if (value instanceof Uint8Array) {
    const copy = value.slice();
    transfer.push(copy.buffer as ArrayBuffer);
    return copy as unknown as T;
  }
  if (Array.isArray(value)) return value.map((v) => detachBytes(v, transfer)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = detachBytes(v, transfer);
    return out as T;
  }
  return value;
}

export class PdfOpsClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (r: OpsResponse) => void; reject: (e: Error) => void }>();
  /** The token of the document the worker holds, and the bytes object it was parsed from. */
  private token: string | null = null;
  private tokenFor: Uint8Array | null = null;

  private ensure(): Worker {
    if (!this.worker) {
      // Classic worker — Turbopack's worker bootstrap uses importScripts, which `type: "module"` forbids.
      this.worker = new Worker(new URL("./pdf-ops.worker.ts", import.meta.url));
      this.worker.onmessage = (e: MessageEvent<OpsResponse>) => {
        const p = this.pending.get(e.data.id);
        if (!p) return;
        this.pending.delete(e.data.id);
        p.resolve(e.data);
      };
      this.worker.onerror = (e) => {
        const err = new Error(e.message || "The PDF worker failed");
        for (const p of this.pending.values()) p.reject(err);
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
        this.token = null;
        this.tokenFor = null;
      };
    }
    return this.worker;
  }

  private send(req: OpsRequest, transfer: Transferable[] = []): Promise<OpsResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      this.ensure().postMessage(req, transfer);
    });
  }

  /** The bundled sample document, built in the worker. */
  async sample(): Promise<Uint8Array> {
    const r = await this.send({ id: ++this.seq, kind: "sample" });
    if (!r.ok || !r.bytes) throw new Error(r.ok ? "No sample" : r.error);
    return new Uint8Array(r.bytes);
  }

  /** Runs operations on the bytes, in order, saving once; a password keeps the document protected through them. */
  async run(bytes: Uint8Array, op: PdfOp | PdfOp[], password?: string): Promise<OpResult> {
    const id = ++this.seq;
    const known = this.tokenFor === bytes && this.token;
    const transfer: Transferable[] = [];
    let payload: ArrayBuffer | undefined;
    if (!known) {
      payload = bytes.slice().buffer as ArrayBuffer;
      transfer.push(payload);
    }
    // Bytes inside operations (another PDF, images, attachments) go along as copies, so the caller keeps its own.
    const ops = detachBytes(Array.isArray(op) ? op : [op], transfer);
    let r = await this.send({ id, kind: "op", ops, token: known ? this.token : null, bytes: payload, password }, transfer);
    if (!r.ok && r.needsBytes) {
      const again = bytes.slice().buffer as ArrayBuffer;
      const retryTransfer: Transferable[] = [again];
      const opsAgain = detachBytes(Array.isArray(op) ? op : [op], retryTransfer);
      r = await this.send({ id: ++this.seq, kind: "op", ops: opsAgain, token: null, bytes: again, password }, retryTransfer);
    }
    if (!r.ok) throw new Error(r.error);
    const out = r.changed && r.bytes ? new Uint8Array(r.bytes) : bytes;
    this.token = r.token ?? null;
    this.tokenFor = r.token ? out : null;
    return {
      bytes: out,
      changed: r.changed,
      annotId: r.annotId,
      files: r.files?.map((f) => ({ name: f.name, bytes: new Uint8Array(f.bytes) })),
      count: r.count,
      warnings: r.warnings,
      report: r.report,
      ms: r.ms,
    };
  }

  /** Operations on a new, empty document (pages from images): the bytes of the result. */
  async runFresh(op: PdfOp | PdfOp[]): Promise<OpResult> {
    const transfer: Transferable[] = [];
    const ops = detachBytes(Array.isArray(op) ? op : [op], transfer);
    const r = await this.send({ id: ++this.seq, kind: "op", ops, token: null, fresh: true }, transfer);
    if (!r.ok) throw new Error(r.error);
    if (!r.bytes) throw new Error("Nothing was produced");
    const out = new Uint8Array(r.bytes);
    this.token = r.token ?? null;
    this.tokenFor = r.token ? out : null;
    return { bytes: out, changed: true, count: r.count, warnings: r.warnings, ms: r.ms };
  }

  /** Forget the worker's copy (after the bytes changed elsewhere, say). */
  invalidate() {
    this.token = null;
    this.tokenFor = null;
  }

  dispose() {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
    this.invalidate();
  }
}
