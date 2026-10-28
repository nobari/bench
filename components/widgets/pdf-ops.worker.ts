/**
 * pdf-lib in a worker: parses the document once per version, applies operations (lib/tools/files/pdf/ops.ts) and
 * hands the new bytes back, so a 200 MB file never freezes the page. The parsed document is kept under a token the
 * client sends back; bytes travel only when the client holds a version the worker has not seen.
 */
import { applyOp, type OpApplied, type PdfOp } from "@/lib/tools/files/pdf/ops";
import { loadPdf } from "@/lib/tools/files/pdf/pages";
import { buildSamplePdf } from "@/lib/tools/files/pdf/sample";
import type { PDFDocument } from "@cantoo/pdf-lib";

export type OpsRequest =
  | { id: number; kind: "sample" }
  | { id: number; kind: "op"; ops: PdfOp[]; token: string | null; bytes?: ArrayBuffer; password?: string };

export type OpsResponse =
  | { id: number; ok: true; changed: boolean; bytes?: ArrayBuffer; token?: string; annotId?: string; files?: { name: string; bytes: ArrayBuffer }[]; count?: number; ms: number }
  | { id: number; ok: false; error: string; needsBytes?: boolean };

let cache: { token: string; doc: PDFDocument; password?: string } | null = null;
let tokens = 0;
const newToken = () => `t${Date.now().toString(36)}-${++tokens}`;

function friendly(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (/encrypted/i.test(m) && /password/i.test(m)) return "This PDF is protected — open it with its password first.";
  if (/Failed to parse PDF document/i.test(m) || /No PDF header/i.test(m)) return "This file could not be parsed as a PDF.";
  if (/Expected instance of PDFDict/i.test(m) || /Trying to parse invalid object/i.test(m)) return "The document's structure is damaged in a way pdf-lib cannot read.";
  return m;
}

self.onmessage = async (e: MessageEvent<OpsRequest>) => {
  const req = e.data;
  const started = performance.now();
  const reply = (r: OpsResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(r, transfer);
  if (req.kind === "sample") {
    try {
      const bytes = await buildSamplePdf();
      reply({ id: req.id, ok: true, changed: true, bytes: bytes.buffer as ArrayBuffer, ms: performance.now() - started }, [bytes.buffer as ArrayBuffer]);
    } catch (err) {
      reply({ id: req.id, ok: false, error: friendly(err) });
    }
    return;
  }
  try {
    let doc: PDFDocument;
    if (req.bytes) {
      doc = await loadPdf(new Uint8Array(req.bytes), { password: req.password });
      cache = null;
    } else if (cache && req.token && cache.token === req.token) {
      doc = cache.doc;
    } else {
      reply({ id: req.id, ok: false, error: "The document is not loaded in the worker", needsBytes: true });
      return;
    }
    const applied: OpApplied = { changed: false };
    for (const op of req.ops) {
      const a = await applyOp(doc, op);
      applied.changed = applied.changed || a.changed;
      if (a.id) applied.id = a.id;
      if (a.files) applied.files = [...(applied.files ?? []), ...a.files];
      if (a.count !== undefined) applied.count = (applied.count ?? 0) + a.count;
    }
    const last = req.ops[req.ops.length - 1];
    const transfer: Transferable[] = [];
    const files = applied.files?.map((f) => {
      const buf = f.bytes.buffer as ArrayBuffer;
      transfer.push(buf);
      return { name: f.name, bytes: buf };
    });
    if (!applied.changed) {
      // Nothing to save; keep the parsed document for the next operation on these same bytes.
      cache = req.password === undefined ? { token: req.token ?? (cache?.token ?? newToken()), doc } : null;
      reply({ id: req.id, ok: true, changed: false, token: cache?.token, annotId: applied.id, files, count: applied.count, ms: performance.now() - started }, transfer);
      return;
    }
    const keepPassword = req.password !== undefined && !req.ops.some((o) => o.type === "decrypt");
    if (keepPassword) doc.encrypt({ userPassword: req.password!, ownerPassword: req.password! });
    const out = await doc.save();
    const buf = out.buffer as ArrayBuffer;
    transfer.push(buf);
    // An encrypted document is re-parsed next time (encryption cannot be applied twice to one document object).
    const token = newToken();
    cache = keepPassword || last.type === "encrypt" ? null : { token, doc };
    reply({ id: req.id, ok: true, changed: true, bytes: buf, token: cache ? token : undefined, annotId: applied.id, files, count: applied.count, ms: performance.now() - started }, transfer);
  } catch (err) {
    cache = null;
    reply({ id: req.id, ok: false, error: friendly(err) });
  }
};
