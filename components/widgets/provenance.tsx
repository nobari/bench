"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryState, parseAsString } from "nuqs";
import { AlertTriangle, Camera, Download, ExternalLink, Info, Loader, ShieldAlert, ShieldCheck, ShieldOff, ShieldQuestion, Sparkles, Trash2, Upload } from "lucide-react";
import type { C2pa, Context, Ingredient, Manifest, ManifestStore, ValidationStatus } from "@contentauth/c2pa-web";
import {
  scanFile,
  parseJumbf,
  decodeCbor,
  cborToJson,
  parseCoseSign1,
  parseCertificate,
  parseExif,
  summarizeXmp,
  parseIptc,
  deriveSignals,
  digitalSourceType,
  assertionLabel,
  statusLabel,
  formatBytes,
  sha256Hex,
  derToPem,
  pemToDer,
  importEs256PrivateKey,
  reserveSizeFor,
  coseSignEs256,
  hex,
  ACTION_LABELS,
  DIGITAL_SOURCE_TYPES,
  type Located,
  type JumbfBox,
  type CoseSign1,
  type CertificateInfo,
  type SignalReport,
  type ManifestFacts,
  type TextEntry,
} from "@/lib/tools/image/provenance";
import { DEMO_CERT_CHAIN_PEM, DEMO_PRIVATE_KEY_PEM } from "@/lib/tools/image/demo-cert";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ data */

const SAMPLES = [
  { id: "signed", file: "signed.jpg", label: "Signed JPEG (test certificate)" },
  { id: "ai", file: "ai-generated.png", label: "AI-generated PNG, declared via C2PA" },
  { id: "ai-edited", file: "ai-edited.webp", label: "WebP edited with generative AI" },
  { id: "tampered", file: "tampered.jpg", label: "Edited after signing (hash mismatch)" },
  { id: "expired", file: "expired.jpg", label: "Expired signing certificate" },
  { id: "identity", file: "identity.jpg", label: "Creator identity (CAWG) assertion" },
  { id: "chain", file: "chain.jpg", label: "Two generations of edits (ingredient chain)" },
  { id: "video", file: "video.mp4", label: "MP4 video with credentials" },
  { id: "camera", file: "camera.jpg", label: "Camera JPEG without credentials" },
];

const TRUST = {
  trustAnchors: "https://verify.contentauthenticity.org/trust/anchors.pem",
  allowedList: "https://verify.contentauthenticity.org/trust/allowed.sha256.txt",
  trustConfig: "https://verify.contentauthenticity.org/trust/store.cfg",
};

const TABS = [
  ["summary", "Summary"],
  ["credentials", "Content Credentials"],
  ["signals", "Metadata & AI signals"],
  ["raw", "Raw structure"],
  ["sign", "Add credentials (demo)"],
  ["compare", "C2PA vs SynthID"],
] as const;
type Tab = (typeof TABS)[number][0];

const COMPARE: { row: string; c2pa: string; synthid: string; iptc: string; visible: string }[] = [
  { row: "What it is", c2pa: "A signed manifest embedded in the file: who made it, with what, from which ingredients, plus a hash that binds it to the pixels.", synthid: "An imperceptible statistical watermark woven into pixels, audio samples, video frames or text tokens by Google's models.", iptc: "Plain metadata fields (XMP/IPTC/EXIF) such as DigitalSourceType or Credit, written by any software.", visible: "A visible mark or label drawn onto the media (logo, sparkle, 'AI-generated' badge)." },
  { row: "Who adds it", c2pa: "Cameras (Leica, Nikon, Sony, Pixel 10…), Adobe, OpenAI, Microsoft, Google, Meta and others.", synthid: "Only Google (Imagen, Gemini image generation, Veo, Lyria, Gemini text).", iptc: "Anyone — cameras, editors, AI services (Google, Meta, Adobe, Microsoft).", visible: "Anyone." },
  { row: "Survives re-encoding, crop, screenshot?", c2pa: "No. Any re-save without C2PA support, a crop, or a screenshot drops it (an optional soft-binding watermark can help recover the manifest).", synthid: "Designed to survive crops, resizes, compression, filters and screenshots to a large degree.", iptc: "No — stripped by most social platforms and any metadata cleaner.", visible: "Survives unless cropped or inpainted away." },
  { row: "Who can verify", c2pa: "Anyone, with open tools (this page, contentcredentials.org/verify, c2pa-rs).", synthid: "Only Google's keyed detector (SynthID Detector portal, Gemini app).", iptc: "Anyone can read it — but nothing proves it's true.", visible: "Anyone can see it." },
  { row: "Can it be faked?", c2pa: "A manifest can be forged, but it will not validate against a trusted certificate — the trust list is the whole point.", synthid: "Detection can't be spoofed without the secret keys; removal is hard but not impossible.", iptc: "Trivially — it's just text.", visible: "Trivially." },
  { row: "What it tells you", c2pa: "Origin, edit history, AI involvement (digitalSourceType), ingredients, signer identity, timestamp.", synthid: "Only 'this was produced or edited by a Google AI model'.", iptc: "Whatever the writer declared.", visible: "Whatever the mark says." },
];

/* --------------------------------------------------------------- SDK glue */

type SdkModule = typeof import("@contentauth/c2pa-web");
let sdkPromise: Promise<{ mod: SdkModule; c2pa: C2pa }> | null = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = (async () => {
      const mod = await import("@contentauth/c2pa-web");
      const c2pa = await mod.createC2pa({ wasmSrc: "/vendor/c2pa/c2pa_bg.wasm" });
      return { mod, c2pa };
    })().catch((e: unknown) => {
      sdkPromise = null;
      throw e;
    });
  }
  return sdkPromise;
}

let contextPromise: Promise<{ context: Context; trusted: boolean }> | null = null;
function getContext(mod: SdkModule) {
  if (!contextPromise) {
    contextPromise = (async () => {
      try {
        const context = new mod.Context({ verify: { verifyTrust: true, ocspFetch: false, remoteManifestFetch: true }, trust: TRUST });
        await context.toJson();
        return { context, trusted: true };
      } catch {
        return { context: new mod.Context({ verify: { verifyTrust: false, remoteManifestFetch: true } }), trusted: false };
      }
    })();
  }
  return contextPromise;
}

interface SdkResult {
  store: ManifestStore | null;
  trusted: boolean;
  thumbs: Record<string, string>;
}

async function readWithSdk(blob: Blob, mime: string): Promise<SdkResult> {
  const { mod, c2pa } = await loadSdk();
  const { context, trusted } = await getContext(mod);
  const reader = await mod.Reader.fromBlob(c2pa, mime, blob, context);
  if (!reader) return { store: null, trusted, thumbs: {} };
  try {
    const store = (await reader.manifestStore()) as ManifestStore;
    const thumbs: Record<string, string> = {};
    const grab = async (key: string, id: string | undefined, format: string | undefined) => {
      if (!id || thumbs[key]) return;
      try {
        const bytes = await reader.resourceToBytes(id);
        thumbs[key] = URL.createObjectURL(new Blob([bytes as BlobPart], { type: format || "image/jpeg" }));
      } catch {
        /* resource not embedded */
      }
    };
    for (const [label, m] of Object.entries(store.manifests ?? {})) {
      await grab(label, m.thumbnail?.identifier ?? undefined, m.thumbnail?.format);
      for (const ing of m.ingredients ?? []) await grab(`${label}/${ing.instance_id ?? ing.title ?? ""}`, ing.thumbnail?.identifier ?? undefined, ing.thumbnail?.format);
    }
    return { store, trusted, thumbs };
  } finally {
    await reader.free();
  }
}

interface ActionLike {
  action: string;
  when?: string | null;
  digitalSourceType?: string | null;
  softwareAgent?: string | { name?: string; version?: string } | null;
  parameters?: Record<string, unknown> | null;
  description?: string | null;
  reason?: string | null;
}

function agentName(a: ActionLike["softwareAgent"]): string {
  if (!a) return "";
  return typeof a === "string" ? a : [a.name, a.version].filter(Boolean).join(" ");
}

function factsFromAssertions(list: { label: string; data: unknown }[], generators: string[]): ManifestFacts {
  const facts: ManifestFacts = { claimGenerators: [...new Set(generators.filter(Boolean))], softwareAgents: [], digitalSourceTypes: [], actions: [], hasCredentials: true, trainingMining: {} };
  for (const a of list) {
    if (a.label.startsWith("c2pa.actions")) {
      for (const act of ((a.data as { actions?: ActionLike[] })?.actions ?? []) as ActionLike[]) {
        facts.actions.push(act.action);
        if (act.digitalSourceType) facts.digitalSourceTypes.push(act.digitalSourceType);
        const n = agentName(act.softwareAgent);
        if (n) facts.softwareAgents.push(n);
      }
    } else if (/training-mining/.test(a.label)) {
      const entries = ((a.data as { entries?: Record<string, { use?: string }> })?.entries ?? {}) as Record<string, { use?: string }>;
      for (const [k, v] of Object.entries(entries)) facts.trainingMining![k.replace(/^c2pa\./, "")] = v?.use ?? JSON.stringify(v);
    }
  }
  facts.softwareAgents = [...new Set(facts.softwareAgents)];
  facts.digitalSourceTypes = [...new Set(facts.digitalSourceTypes)];
  return facts;
}

function factsFromStore(store: ManifestStore): ManifestFacts {
  const assertions: { label: string; data: unknown }[] = [];
  const generators: string[] = [];
  for (const m of Object.values(store.manifests ?? {})) {
    if (m.claim_generator) generators.push(m.claim_generator);
    for (const g of m.claim_generator_info ?? []) generators.push([g.name, g.version].filter(Boolean).join(" "));
    for (const a of m.assertions ?? []) assertions.push({ label: a.label, data: a.data });
  }
  return factsFromAssertions(assertions, generators);
}

/* ------------------------------------------------------------- raw view */

interface RawManifest {
  label: string;
  claim: unknown;
  assertions: { label: string; kind: string; data: unknown }[];
  cose: CoseSign1 | null;
  coseError?: string;
  certs: CertificateInfo[];
}

function buildRaw(tree: JumbfBox[]): RawManifest[] {
  const root = tree[0];
  if (!root?.children) return [];
  const out: RawManifest[] = [];
  for (const m of root.children) {
    if (m.type !== "jumb") continue;
    const claimBox = m.children?.find((c) => c.label?.startsWith("c2pa.claim"));
    const claimCbor = claimBox?.children?.find((c) => c.type === "cbor")?.data;
    let claim: unknown = null;
    try {
      claim = claimCbor ? cborToJson(decodeCbor(claimCbor).value) : null;
    } catch (e) {
      claim = { error: String(e) };
    }
    const assertions: RawManifest["assertions"] = [];
    for (const a of m.children?.find((c) => c.label === "c2pa.assertions")?.children ?? []) {
      const content = a.children?.[0];
      let data: unknown = null;
      const kind = content?.type ?? "?";
      try {
        if (content?.type === "cbor" && content.data) data = cborToJson(decodeCbor(content.data).value);
        else if (content?.type === "json" && content.data) data = JSON.parse(new TextDecoder().decode(content.data));
        else if (content?.data) data = `embedded ${content.type} box, ${formatBytes(content.data.length)}`;
      } catch (e) {
        data = { error: String(e) };
      }
      assertions.push({ label: a.label ?? "?", kind, data });
    }
    let cose: CoseSign1 | null = null, coseError: string | undefined;
    const certs: CertificateInfo[] = [];
    const sigData = m.children?.find((c) => c.label === "c2pa.signature")?.children?.find((c) => c.type === "cbor")?.data;
    if (sigData) {
      try {
        cose = parseCoseSign1(sigData);
        for (const der of cose.certificates) {
          try {
            certs.push(parseCertificate(der));
          } catch {
            /* unparseable cert */
          }
        }
      } catch (e) {
        coseError = e instanceof Error ? e.message : String(e);
      }
    }
    out.push({ label: m.label ?? "?", claim, assertions, cose, coseError, certs });
  }
  return out;
}

/* ---------------------------------------------------------------- state */

interface Analysis {
  name: string;
  size: number;
  mime: string;
  sha256: string;
  scan: Located;
  tree: JumbfBox[] | null;
  raw: RawManifest[];
  exif: Record<string, string>;
  xmp: Record<string, string>;
  iptc: Record<string, string>;
  text: TextEntry[];
}

type SdkState = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; result: SdkResult } | { kind: "error"; message: string };

const MAX_BYTES = 300 * 1024 * 1024;
const GHOST = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge px-3 text-[13px] text-muted transition-colors hover:border-accent hover:text-accent disabled:opacity-40";
const SEL = "h-8 rounded-[var(--radius-sm)] border border-edge bg-base px-2 pr-7 text-[13px] text-ink outline-none focus:border-accent";

function download(bytes: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function ProvenanceWidget() {
  const [tab, setTab] = useQueryState("t", parseAsString.withDefault("summary").withOptions({ history: "replace" }));
  const [sample, setSample] = useQueryState("s", parseAsString.withDefault("").withOptions({ history: "replace" }));
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [sdk, setSdk] = useState<SdkState>({ kind: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const runRef = useRef(0);
  const thumbsRef = useRef<Record<string, string>>({});

  const analyze = useCallback(async (f: File) => {
    const run = ++runRef.current;
    setFile(f);
    setError(null);
    setAnalysis(null);
    setSdk({ kind: "idle" });
    for (const url of Object.values(thumbsRef.current)) URL.revokeObjectURL(url);
    thumbsRef.current = {};
    if (f.size > MAX_BYTES) {
      setError(`That file is ${formatBytes(f.size)}; the inspector reads files up to ${formatBytes(MAX_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const [scan, sha256] = await Promise.all([scanFile(bytes), sha256Hex(bytes)]);
      const tree = scan.jumbf ? parseJumbf(scan.jumbf) : null;
      const a: Analysis = {
        name: f.name,
        size: f.size,
        mime: f.type || scan.mime,
        sha256,
        scan,
        tree,
        raw: tree ? buildRaw(tree) : [],
        exif: scan.metadata.exif ? parseExif(scan.metadata.exif) : {},
        xmp: scan.metadata.xmp ? summarizeXmp(scan.metadata.xmp) : {},
        iptc: scan.metadata.iptc ? parseIptc(scan.metadata.iptc) : {},
        text: scan.metadata.text,
      };
      if (run !== runRef.current) return;
      setAnalysis(a);
      setBusy(false);
      if (scan.container === "unknown") return;
      setSdk({ kind: "loading" });
      try {
        const result = await readWithSdk(f, scan.mime);
        if (run !== runRef.current) return;
        thumbsRef.current = result.thumbs;
        setSdk({ kind: "ready", result });
      } catch (e) {
        if (run !== runRef.current) return;
        setSdk({ kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      if (run !== runRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }, []);

  // Load a sample from the URL (?s=) once on mount or when it changes.
  useEffect(() => {
    const s = SAMPLES.find((x) => x.id === sample);
    if (!s) return;
    let active = true;
    fetch(`/samples/c2pa/${s.file}`)
      .then((r) => r.blob())
      .then((b) => {
        if (active) void analyze(new File([b], s.file, { type: b.type }));
      })
      .catch(() => active && setError("Couldn't load the sample file."));
    return () => {
      active = false;
    };
  }, [sample, analyze]);

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = Array.from(e.clipboardData?.files ?? [])[0];
      if (f) {
        e.preventDefault();
        setSample(null);
        void analyze(f);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [analyze, setSample]);

  const take = (f: File | null | undefined) => {
    if (!f) return;
    setSample(null);
    void analyze(f);
  };

  const store = sdk.kind === "ready" ? sdk.result.store : null;
  const facts: ManifestFacts | null = store ? factsFromStore(store) : analysis?.raw.length ? factsFromAssertions(analysis.raw.flatMap((m) => m.assertions), analysis.raw.map((m) => String((m.claim as { claim_generator?: string })?.claim_generator ?? ""))) : null;
  const signals: SignalReport | null = analysis ? deriveSignals({ exif: analysis.exif, xmp: analysis.xmp, iptc: analysis.iptc, text: analysis.text, manifest: facts }) : null;
  const current = tab as Tab;

  return (
    <div className="space-y-3">
      {/* file bar */}
      <div className="panel p-3">
        <input ref={inputRef} type="file" hidden onChange={(e) => take(e.target.files?.[0])} />
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              take(e.dataTransfer.files?.[0]);
            }}
            className={cn("flex min-h-[44px] min-w-0 flex-1 items-center gap-3 overflow-hidden rounded-[var(--radius)] border border-dashed border-edge bg-base px-3 py-2 text-left", dragOver && "border-accent")}
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-edge text-accent">
              <Upload size={15} />
            </span>
            {file ? (
              <span className="min-w-0 text-[13.5px] text-ink">
                <span className="block truncate font-medium">{file.name}</span>
                <span className="block truncate font-mono text-[12px] text-faint">
                  {analysis?.mime ?? file.type} · {formatBytes(file.size)}
                  {analysis ? ` · sha256 ${analysis.sha256.slice(0, 16)}…` : ""}
                </span>
              </span>
            ) : (
              <span className="text-[13.5px] text-muted">Drop any image, video, audio or PDF here — or click, or paste. Nothing is uploaded.</span>
            )}
          </button>
          <select aria-label="Load a sample" value={sample} onChange={(e) => setSample(e.target.value || null)} className={cn(SEL, "max-w-[240px]")}>
            <option value="">Try a sample…</option>
            {SAMPLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {file && (
            <button
              type="button"
              onClick={() => {
                runRef.current++;
                setFile(null);
                setAnalysis(null);
                setSdk({ kind: "idle" });
                setSample(null);
                setError(null);
              }}
              className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger"
            >
              <Trash2 size={12} /> Clear
            </button>
          )}
        </div>
        {error && (
          <p className="mt-2 flex items-center gap-1.5 text-[13px] text-danger">
            <AlertTriangle size={14} /> {error}
          </p>
        )}
      </div>

      {/* tabs */}
      <div className="flex flex-wrap gap-1 border-b border-edge pb-2">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id === "summary" ? null : id)}
            className={cn("h-8 rounded-[var(--radius-sm)] px-3 text-[13px] transition-colors", current === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:bg-raised hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {current === "summary" && <Summary analysis={analysis} sdk={sdk} signals={signals} busy={busy} />}
      {current === "credentials" && <Credentials analysis={analysis} sdk={sdk} thumbs={sdk.kind === "ready" ? sdk.result.thumbs : {}} />}
      {current === "signals" && <Signals analysis={analysis} signals={signals} />}
      {current === "raw" && <Raw analysis={analysis} />}
      {current === "sign" && <SignDemo file={file} analysis={analysis} hasManifest={!!analysis?.tree} onSigned={(f) => take(f)} />}
      {current === "compare" && <Compare />}
    </div>
  );
}

/* --------------------------------------------------------------- summary */

function credentialVerdict(analysis: Analysis | null, sdk: SdkState): { tone: "good" | "warn" | "bad" | "none" | "pending"; title: string; detail: string } {
  if (!analysis) return { tone: "none", title: "No file yet", detail: "Load a file to inspect its Content Credentials." };
  if (sdk.kind === "loading") return { tone: "pending", title: "Validating…", detail: "Loading the C2PA verifier (8 MB, once) and checking signatures and hashes." };
  if (sdk.kind === "ready" && sdk.result.store) {
    const st = sdk.result.store;
    const active = st.active_manifest ? st.manifests?.[st.active_manifest] : undefined;
    const failures = st.validation_results?.activeManifest?.failure ?? st.validation_status?.filter((s) => s.success === false) ?? [];
    const signer = active?.signature_info?.common_name || active?.signature_info?.issuer || "unknown signer";
    if (st.validation_state === "Trusted") return { tone: "good", title: "Valid and trusted Content Credentials", detail: `Signed by ${signer}; the certificate chains to a trust-list anchor and the content hash matches.` };
    if (st.validation_state === "Valid") return { tone: "warn", title: "Valid signature, signer not on the trust list", detail: `Signed by ${signer}. The manifest is intact and correctly signed, but the certificate isn't on the C2PA trust list${sdk.result.trusted ? "" : " (trust list unavailable)"} — treat the claims as unverified.` };
    const top = failures[0] ? statusLabel(failures[0].code) : "validation failed";
    return { tone: "bad", title: "Invalid Content Credentials", detail: `${top}. Signed by ${signer}.` };
  }
  if (analysis.scan.remoteUrl && !analysis.tree) return { tone: "warn", title: "Remote manifest reference", detail: `The file points to a manifest at ${analysis.scan.remoteUrl} rather than embedding one.` };
  if (analysis.tree) return { tone: sdk.kind === "error" ? "warn" : "pending", title: "Manifest found (not validated)", detail: sdk.kind === "error" ? `The verifier couldn't run: ${sdk.message}` : "Structural parse only." };
  if (sdk.kind === "error") return { tone: "none", title: "No Content Credentials found", detail: `No manifest in the container; the verifier also reported: ${sdk.message}` };
  return { tone: "none", title: "No Content Credentials", detail: `No C2PA manifest in this ${analysis.scan.label.split(" · ")[0]} file. That is the norm today — most files never had one, and most platforms strip them.` };
}

function Summary({ analysis, sdk, signals, busy }: { analysis: Analysis | null; sdk: SdkState; signals: SignalReport | null; busy: boolean }) {
  const cred = credentialVerdict(analysis, sdk);
  const tone = { good: "text-positive", warn: "text-warn", bad: "text-danger", none: "text-muted", pending: "text-muted" }[cred.tone];
  const Icon = { good: ShieldCheck, warn: ShieldAlert, bad: ShieldOff, none: ShieldQuestion, pending: Loader }[cred.tone];
  const ai = signals?.ai ?? "none";
  const aiTitle = !analysis ? "—" : ai === "declared-generated" ? "Declared: created by generative AI" : ai === "declared-edited" ? "Declared: edited with generative AI" : ai === "hinted" ? "AI generator traces in the metadata" : "No AI declaration";
  const aiDetail = !analysis
    ? "Load a file to look for AI declarations."
    : ai === "none"
      ? signals?.capture
        ? "Camera metadata is present and nothing declares AI involvement. Absence of a declaration is not proof — metadata can be stripped or never written."
        : "Nothing in the file declares AI generation. That proves little: most AI images carry no metadata at all once shared."
      : signals!.signals.filter((s) => s.kind === "ai" || s.kind === "ai-edited" || s.kind === "generator").map((s) => `${s.title} (${s.source})`).slice(0, 3).join(" · ");
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <div className="panel p-4">
        <div className={cn("flex items-center gap-2", tone)}>
          <Icon size={18} className={cred.tone === "pending" ? "animate-spin" : ""} />
          <span className="readout">Content Credentials (C2PA)</span>
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{busy ? "Reading file…" : cred.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{cred.detail}</p>
      </div>
      <div className="panel p-4">
        <div className={cn("flex items-center gap-2", ai === "declared-generated" || ai === "declared-edited" ? "text-accent" : ai === "hinted" ? "text-warn" : "text-muted")}>
          {signals?.capture && ai === "none" ? <Camera size={18} /> : <Sparkles size={18} />}
          <span className="readout">AI involvement</span>
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{aiTitle}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{aiDetail}</p>
      </div>
      <div className="panel p-4">
        <div className="flex items-center gap-2 text-muted">
          <ShieldQuestion size={18} />
          <span className="readout">SynthID watermark</span>
        </div>
        <p className="mt-2 text-[15px] font-medium leading-snug text-ink">{analysis ? (signals?.google ? "Google AI signals present — SynthID likely embedded" : "Cannot be checked outside Google") : "—"}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">
          {analysis
            ? signals?.google
              ? "The metadata names a Google product. Google embeds SynthID in everything Imagen, Gemini, Veo and Lyria produce, but only Google's detector can confirm it."
              : "SynthID is an invisible watermark that only Google's keyed detector can read; no third-party tool can detect it. What this page can read are the C2PA and IPTC declarations Google attaches alongside it."
            : "SynthID can't be detected by third parties; this page reads the credentials and metadata Google publishes alongside it."}
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
          <a href="https://deepmind.google/technologies/synthid/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            SynthID Detector <ExternalLink size={11} />
          </a>
          <a href="https://gemini.google.com/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Ask Gemini “was this made with Google AI?” <ExternalLink size={11} />
          </a>
        </p>
      </div>
    </div>
  );
}

/* ----------------------------------------------------------- credentials */

function StatusList({ items, tone }: { items: ValidationStatus[]; tone: "good" | "warn" | "bad" }) {
  if (!items.length) return null;
  const color = { good: "text-positive", warn: "text-muted", bad: "text-danger" }[tone];
  return (
    <ul className="space-y-1">
      {items.map((s, i) => (
        <li key={`${s.code}-${i}`} className="text-[13px]">
          <span className={cn("font-medium", color)}>{statusLabel(s.code)}</span>
          <span className="ml-2 font-mono text-[11.5px] text-faint">{s.code}</span>
          {s.url && <span className="ml-2 break-all font-mono text-[11.5px] text-faint">{s.url}</span>}
        </li>
      ))}
    </ul>
  );
}

function KV({ rows }: { rows: [string, React.ReactNode][] }) {
  const shown = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (!shown.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
      {shown.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-faint">{k}</dt>
          <dd className="min-w-0 break-words text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Json({ value, label, open = false }: { value: unknown; label: string; open?: boolean }) {
  return (
    <details open={open} className="rounded-[var(--radius-sm)] border border-edge">
      <summary className="cursor-pointer select-none px-2 py-1 text-[12.5px] text-muted hover:text-ink">{label}</summary>
      <pre className="max-h-80 overflow-auto border-t border-edge p-2 font-mono text-[11.5px] leading-relaxed text-ink">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

function ManifestCard({ label, m, active, store, thumbs }: { label: string; m: Manifest; active: boolean; store: ManifestStore; thumbs: Record<string, string> }) {
  const sig = m.signature_info;
  const actions = (m.assertions ?? []).filter((a) => a.label.startsWith("c2pa.actions")).flatMap((a) => (((a.data as { actions?: ActionLike[] })?.actions ?? []) as ActionLike[]));
  const others = (m.assertions ?? []).filter((a) => !a.label.startsWith("c2pa.actions"));
  const results = active ? store.validation_results?.activeManifest : undefined;
  const generator = (m.claim_generator_info ?? []).map((g) => [g.name, g.version].filter(Boolean).join(" ")).join(", ") || m.claim_generator || "—";
  return (
    <div className={cn("panel p-4", active && "border-accent/60")}>
      <div className="flex flex-wrap items-start gap-3">
        {thumbs[label] && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumbs[label]} alt="" className="h-20 w-20 shrink-0 rounded-[var(--radius-sm)] border border-edge object-cover" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-medium text-ink">{m.title || "Untitled manifest"}</span>
            {active && <span className="rounded-[var(--radius-sm)] bg-accent-soft px-1.5 py-0.5 text-[11px] font-medium text-accent">active</span>}
            {m.claim_version ? <span className="text-[11.5px] text-faint">claim v{m.claim_version}</span> : null}
          </div>
          <p className="mt-0.5 break-all font-mono text-[11.5px] text-faint">{label}</p>
          <div className="mt-3">
            <KV
              rows={[
                ["Produced with", generator],
                ["Format", m.format ?? ""],
                ["Signed by", sig ? [sig.common_name, sig.issuer && sig.issuer !== sig.common_name ? `(${sig.issuer})` : ""].filter(Boolean).join(" ") : "—"],
                ["Signed at", sig?.time ? new Date(sig.time).toLocaleString() : "no timestamp"],
                ["Algorithm", sig?.alg ?? ""],
                ["Certificate serial", sig?.cert_serial_number ? <span className="font-mono text-[12px]">{sig.cert_serial_number}</span> : ""],
                ["Revocation", sig?.revocation_status === true ? "revoked" : sig?.revocation_status === false ? "not revoked" : ""],
              ]}
            />
          </div>
        </div>
      </div>

      {results && (
        <div className="mt-4 space-y-2 border-t border-edge pt-3">
          <span className="readout">Validation</span>
          <StatusList items={results.failure} tone="bad" />
          <StatusList items={results.success} tone="good" />
          <StatusList items={results.informational} tone="warn" />
        </div>
      )}

      {actions.length > 0 && (
        <div className="mt-4 border-t border-edge pt-3">
          <span className="readout">Actions</span>
          <ol className="mt-2 space-y-1.5">
            {actions.map((a, i) => {
              const dst = digitalSourceType(a.digitalSourceType);
              return (
                <li key={i} className="text-[13px]">
                  <span className="font-medium text-ink">{ACTION_LABELS[a.action] ?? a.action}</span>
                  {agentName(a.softwareAgent) && <span className="text-muted"> · {agentName(a.softwareAgent)}</span>}
                  {a.when && <span className="text-faint"> · {new Date(a.when).toLocaleString()}</span>}
                  {dst && (
                    <span className={cn("ml-2 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11.5px]", dst.kind === "ai" || dst.kind === "ai-edited" ? "bg-accent-soft text-accent" : "bg-raised text-muted")}>
                      {dst.label}
                    </span>
                  )}
                  {a.description && <span className="block text-[12.5px] text-muted">{a.description}</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}

      {(m.ingredients?.length ?? 0) > 0 && (
        <div className="mt-4 border-t border-edge pt-3">
          <span className="readout">Ingredients</span>
          <ul className="mt-2 space-y-2">
            {m.ingredients!.map((ing: Ingredient, i) => {
              const t = thumbs[`${label}/${ing.instance_id ?? ing.title ?? ""}`];
              const failures = ing.validation_results?.activeManifest?.failure ?? ing.validation_status?.filter((s) => s.success === false) ?? [];
              return (
                <li key={i} className="flex items-start gap-3 text-[13px]">
                  {t ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={t} alt="" className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] border border-edge object-cover" />
                  ) : (
                    <span className="h-12 w-12 shrink-0 rounded-[var(--radius-sm)] border border-dashed border-edge" />
                  )}
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{ing.title || "Untitled ingredient"}</span>
                    <span className="text-muted"> · {ing.relationship ?? "componentOf"}</span>
                    {ing.format && <span className="text-faint"> · {ing.format}</span>}
                    <div className="text-[12.5px] text-muted">
                      {ing.active_manifest ? (
                        <>
                          Has its own credentials <span className="font-mono text-[11px] text-faint">{ing.active_manifest}</span>
                          {failures.length ? <span className="text-danger"> · {statusLabel(failures[0].code)}</span> : <span className="text-positive"> · validated</span>}
                        </>
                      ) : (
                        "No credentials of its own"
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {others.length > 0 && (
        <div className="mt-4 space-y-1.5 border-t border-edge pt-3">
          <span className="readout">Other assertions</span>
          {others.map((a, i) => (
            <Json key={i} label={`${assertionLabel(a.label)} — ${a.label}`} value={a.data} />
          ))}
        </div>
      )}
    </div>
  );
}

function Credentials({ analysis, sdk, thumbs }: { analysis: Analysis | null; sdk: SdkState; thumbs: Record<string, string> }) {
  if (!analysis) return <Empty>Load a file to see its manifests.</Empty>;
  if (sdk.kind === "loading") return <Empty spinner>Validating with the C2PA SDK…</Empty>;
  const store = sdk.kind === "ready" ? sdk.result.store : null;
  if (!store) {
    if (analysis.raw.length) {
      return (
        <div className="space-y-3">
          <p className="text-[13px] text-warn">
            The verifier {sdk.kind === "error" ? `failed (${sdk.message})` : "found nothing it could validate"}; showing the structurally parsed manifest instead. See Raw structure for details.
          </p>
          {analysis.raw.map((m) => (
            <div key={m.label} className="panel p-4">
              <p className="break-all font-mono text-[12px] text-faint">{m.label}</p>
              <Json label="Claim" value={m.claim} open />
            </div>
          ))}
        </div>
      );
    }
    return (
      <Empty>
        No Content Credentials in this file.
        {analysis.scan.remoteUrl ? ` It references a remote manifest: ${analysis.scan.remoteUrl}` : ""}
      </Empty>
    );
  }
  const order = Object.keys(store.manifests ?? {}).sort((a, b) => (a === store.active_manifest ? -1 : b === store.active_manifest ? 1 : 0));
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
        <span>
          {order.length} manifest{order.length === 1 ? "" : "s"} · state <span className={cn("font-medium", store.validation_state === "Trusted" ? "text-positive" : store.validation_state === "Valid" ? "text-warn" : "text-danger")}>{store.validation_state ?? "unknown"}</span>
          {sdk.kind === "ready" && !sdk.result.trusted && " · trust list unavailable, trust not evaluated"}
        </span>
        <button type="button" onClick={() => download(JSON.stringify(store, null, 2), `${analysis.name}.manifest.json`, "application/json")} className={cn(GHOST, "ml-auto")}>
          <Download size={13} /> Manifest JSON
        </button>
      </div>
      {order.map((label) => (
        <ManifestCard key={label} label={label} m={store.manifests![label]} active={label === store.active_manifest} store={store} thumbs={thumbs} />
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- signals */

const KIND_STYLE: Record<string, string> = {
  ai: "bg-accent-soft text-accent",
  "ai-edited": "bg-accent-soft text-accent",
  generator: "bg-warn/10 text-warn",
  capture: "bg-positive/10 text-positive",
  human: "bg-positive/10 text-positive",
  info: "bg-raised text-muted",
};
const KIND_LABEL: Record<string, string> = { ai: "AI-generated", "ai-edited": "AI-edited", generator: "Generator trace", capture: "Camera", human: "Human-made", info: "Info" };

function Table({ title, rows }: { title: string; rows: [string, string][] }) {
  if (!rows.length) return null;
  return (
    <div className="panel p-3">
      <span className="readout">{title}</span>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[12.5px]">
        {rows.map(([k, v], i) => (
          <div key={`${k}-${i}`} className="contents">
            <dt className="text-faint">{k}</dt>
            <dd className="min-w-0 break-words text-ink">{v.length > 400 ? <details><summary className="cursor-pointer text-muted">{v.slice(0, 120)}… ({v.length} chars)</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap font-mono text-[11.5px]">{v}</pre></details> : v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Signals({ analysis, signals }: { analysis: Analysis | null; signals: SignalReport | null }) {
  if (!analysis || !signals) return <Empty>Load a file to scan its metadata.</Empty>;
  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <span className="readout">Signals</span>
        {signals.signals.length ? (
          <ul className="mt-2 space-y-1.5">
            {signals.signals.map((s, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
                <span className={cn("rounded-[var(--radius-sm)] px-1.5 py-0.5 text-[11px] font-medium", KIND_STYLE[s.kind])}>{KIND_LABEL[s.kind]}</span>
                <span className="text-ink">{s.title}</span>
                <span className="text-[12px] text-faint">{s.source}</span>
                {s.detail && <span className="w-full break-words font-mono text-[11.5px] text-muted">{s.detail}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No descriptive metadata at all — the file has been stripped, or was produced by software that writes none.</p>
        )}
      </div>
      <Table title="EXIF" rows={Object.entries(analysis.exif)} />
      <Table title="XMP" rows={Object.entries(analysis.xmp)} />
      <Table title="IPTC" rows={Object.entries(analysis.iptc)} />
      <Table title="Text chunks & comments" rows={analysis.text.map((t): [string, string] => [`${t.key} (${t.where})`, t.value])} />
      <div className="panel p-4 text-[13px] leading-relaxed text-muted">
        <span className="readout">About SynthID</span>
        <p className="mt-2">
          SynthID is Google DeepMind&apos;s family of invisible watermarks. For images and video it nudges pixel values across the whole frame; for audio it shapes the spectrogram; for text it biases which tokens the model picks. It is designed to survive
          cropping, resizing, compression, filters and screenshots far better than metadata does, and Google says it is applied to everything produced by Imagen, Gemini&apos;s image generation, Veo and Lyria.
        </p>
        <p className="mt-2">
          Detection requires Google&apos;s secret keys, so there is no public specification or offline detector for images, audio or video — this page, like every third-party tool, cannot see it. The open-source{" "}
          <a href="https://github.com/google-deepmind/synthid-text" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            SynthID Text
          </a>{" "}
          library lets model providers watermark and detect their own text with their own keys; it still can&apos;t detect Gemini&apos;s.
        </p>
        <p className="mt-2">
          To check a file: use Google&apos;s{" "}
          <a href="https://deepmind.google/technologies/synthid/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            SynthID Detector
          </a>{" "}
          portal, or upload the image to the Gemini app and ask whether it was generated with Google AI. Since 2025 Google also attaches C2PA Content Credentials and IPTC &ldquo;trained algorithmic media&rdquo; metadata to much of its AI output — those are what
          this page reads, and they are what most other checkers rely on too.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- raw */

function BoxTree({ boxes, depth = 0 }: { boxes: JumbfBox[]; depth?: number }) {
  return (
    <ul className={cn("space-y-0.5 font-mono text-[12px]", depth > 0 && "ml-4 border-l border-edge pl-3")}>
      {boxes.map((b, i) => (
        <li key={i}>
          <span className="text-ink">{b.type}</span>
          {b.label && <span className="text-accent"> {b.label}</span>}
          {b.uuidName && <span className="text-muted"> · {b.uuidName}</span>}
          <span className="text-faint">
            {" "}
            · {formatBytes(b.length)} @ {b.offset}
          </span>
          {b.children && b.children.length > 0 && <BoxTree boxes={b.children} depth={depth + 1} />}
        </li>
      ))}
    </ul>
  );
}

function Raw({ analysis }: { analysis: Analysis | null }) {
  if (!analysis) return <Empty>Load a file to see its byte-level structure.</Empty>;
  const { scan, tree, raw } = analysis;
  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <span className="readout">Container</span>
        <div className="mt-2">
          <KV
            rows={[
              ["Format", scan.label],
              ["File", `${formatBytes(analysis.size)} · sha256 ${analysis.sha256}`],
              ["Manifest store", scan.jumbf ? `${formatBytes(scan.jumbf.length)} of JUMBF in ${scan.segments.length} segment${scan.segments.length === 1 ? "" : "s"}` : "not embedded"],
              ["Remote manifest", scan.remoteUrl ?? ""],
            ]}
          />
        </div>
        {scan.segments.length > 0 && (
          <table className="mt-2 w-full text-left font-mono text-[12px]">
            <thead className="text-faint">
              <tr>
                <th className="pr-3 font-normal">offset</th>
                <th className="pr-3 font-normal">length</th>
                <th className="font-normal">segment</th>
              </tr>
            </thead>
            <tbody className="text-ink">
              {scan.segments.map((s, i) => (
                <tr key={i}>
                  <td className="pr-3 tabular">0x{s.offset.toString(16)}</td>
                  <td className="pr-3 tabular">{s.length}</td>
                  <td className="text-muted">{s.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {scan.notes.map((n, i) => (
          <p key={i} className="mt-2 text-[12.5px] text-muted">
            {n}
          </p>
        ))}
        {scan.jumbf && (
          <div className="mt-2 flex gap-2">
            <button type="button" onClick={() => download(scan.jumbf!, `${analysis.name}.c2pa`, "application/c2pa")} className={GHOST}>
              <Download size={13} /> Manifest store (.c2pa)
            </button>
          </div>
        )}
      </div>

      {tree && (
        <div className="panel p-3">
          <span className="readout">JUMBF box tree</span>
          <div className="mt-2 overflow-x-auto">
            <BoxTree boxes={tree} />
          </div>
        </div>
      )}

      {raw.map((m) => (
        <div key={m.label} className="panel space-y-3 p-3">
          <p className="break-all font-mono text-[12px] text-faint">{m.label}</p>
          <Json label="Claim (CBOR, decoded)" value={m.claim} />
          <div className="space-y-1.5">
            <span className="readout">Assertions ({m.assertions.length})</span>
            {m.assertions.map((a, i) => (
              <Json key={i} label={`${assertionLabel(a.label)} — ${a.label} (${a.kind})`} value={a.data} />
            ))}
          </div>
          <div className="space-y-2">
            <span className="readout">Signature (COSE_Sign1)</span>
            {m.coseError && <p className="text-[13px] text-danger">{m.coseError}</p>}
            {m.cose && (
              <>
                <KV
                  rows={[
                    ["Algorithm", m.cose.alg],
                    ["Payload", m.cose.detachedPayload ? "detached (the claim bytes)" : "embedded"],
                    ["Certificates in x5chain", String(m.cose.certificates.length)],
                    ["Timestamp token", m.cose.hasTimestamp ? "present (sigTst)" : "none"],
                    ["Padding", m.cose.padBytes ? `${m.cose.padBytes} bytes` : "none"],
                    ["Signature", <span key="sig" className="font-mono text-[11.5px]">{hex(m.cose.signature, 32)} ({m.cose.signature.length} bytes)</span>],
                  ]}
                />
                <Json label="Protected headers" value={m.cose.protectedHeaders} />
                <Json label="Unprotected headers" value={m.cose.unprotectedHeaders} />
              </>
            )}
            {m.certs.map((c, i) => (
              <div key={i} className="rounded-[var(--radius-sm)] border border-edge p-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[12.5px] font-medium text-ink">{i === 0 ? "Signing certificate" : c.isCa ? `Intermediate CA ${i}` : `Certificate ${i + 1}`}</span>
                  <button type="button" onClick={() => download(derToPem(c.der), `cert-${i + 1}.pem`, "application/x-pem-file")} className={cn(GHOST, "ml-auto h-7 px-2 text-[12px]")}>
                    <Download size={12} /> PEM
                  </button>
                </div>
                <div className="mt-1.5">
                  <KV
                    rows={[
                      ["Subject", c.subject],
                      ["Issuer", c.issuer],
                      ["Valid", `${c.notBefore.slice(0, 10)} → ${c.notAfter.slice(0, 10)}${new Date(c.notAfter) < new Date() ? " (expired)" : ""}`],
                      ["Key", c.publicKey],
                      ["Signed with", c.signatureAlgorithm],
                      ["Extended key usage", c.extendedKeyUsage.join(", ")],
                      ["Serial", <span key="s" className="font-mono text-[11.5px]">{c.serial}</span>],
                    ]}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/* --------------------------------------------------------------- signing */

const SIGNABLE = new Set(["jpeg", "png", "webp", "gif", "tiff", "bmff", "riff", "mp3", "svg", "pdf"]);
const DST_OPTIONS = ["digitalCreation", "trainedAlgorithmicMedia", "compositeWithTrainedAlgorithmicMedia", "digitalCapture", "computationalCapture", "composite", "screenCapture"];

function SignDemo({ file, analysis, hasManifest, onSigned }: { file: File | null; analysis: Analysis | null; hasManifest: boolean; onSigned: (f: File) => void }) {
  const [dst, setDst] = useState("digitalCreation");
  const [author, setAuthor] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy"; step: string } | { kind: "done"; name: string; size: number } | { kind: "error"; message: string }>({ kind: "idle" });
  const can = !!file && !!analysis && SIGNABLE.has(analysis.scan.container);

  async function sign() {
    if (!file || !analysis) return;
    try {
      setState({ kind: "busy", step: "Loading the C2PA SDK…" });
      const { mod, c2pa } = await loadSdk();
      setState({ kind: "busy", step: "Preparing the test signer…" });
      const chain = pemToDer(DEMO_CERT_CHAIN_PEM);
      const key = await importEs256PrivateKey(DEMO_PRIVATE_KEY_PEM);
      const reserve = reserveSizeFor(chain);
      const signer = {
        alg: "es256" as const,
        reserveSize: async () => reserve,
        sign: async (bytes: Uint8Array, r: number) => (await coseSignEs256(bytes, key, chain, r)) as Uint8Array<ArrayBuffer>,
      };
      setState({ kind: "busy", step: "Building the manifest…" });
      const builder = await mod.Builder.new(c2pa);
      const dstUri = `http://cv.iptc.org/newscodes/digitalsourcetype/${dst}`;
      const agent = { name: "Bench", version: "demo" };
      if (hasManifest) {
        await builder.setIntent("edit");
        await builder.addAction({ action: "c2pa.edited", softwareAgent: agent, digitalSourceType: dstUri } as never);
      } else {
        await builder.setIntent({ create: dstUri });
        await builder.addAction({ action: "c2pa.created", softwareAgent: agent, digitalSourceType: dstUri } as never);
      }
      if (author.trim()) await builder.addAssertion("stds.schema-org.CreativeWork", { "@context": "https://schema.org", "@type": "CreativeWork", author: [{ "@type": "Person", name: author.trim() }] });
      setState({ kind: "busy", step: "Hashing the content and signing…" });
      const mime = analysis.mime;
      const out = await builder.sign(signer, mime, file);
      await builder.free();
      const base = file.name.replace(/(\.[^.]+)$/, "");
      const ext = file.name.match(/\.[^.]+$/)?.[0] ?? "";
      const name = `${base}.signed${ext}`;
      download(out, name, mime);
      setState({ kind: "done", name, size: out.length });
      onSigned(new File([out as BlobPart], name, { type: mime }));
    } catch (e) {
      setState({ kind: "error", message: e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="panel space-y-3 p-4">
        <span className="readout">Add Content Credentials to this file</span>
        <p className="text-[13px] leading-relaxed text-muted">
          This signs the loaded file with a <strong className="text-ink">public C2PA test certificate</strong> (“C2PA Test Signing Cert — FOR TESTING ONLY”, from the c2pa-rs project). The result is a real, spec-compliant manifest: the content is hashed, the
          claim is signed in your browser with WebCrypto, and the file downloads with the manifest embedded. Because the certificate is public, every verifier will report it as <em>valid but untrusted</em> — which is the honest
          demonstration of how trust lists work.
        </p>
        <label className="block text-[13px] text-muted">
          Declare the origin as
          <select value={dst} onChange={(e) => setDst(e.target.value)} className={cn(SEL, "mt-1 block w-full")}>
            {DST_OPTIONS.map((k) => (
              <option key={k} value={k}>
                {DIGITAL_SOURCE_TYPES[k]?.label ?? k} · {k}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[13px] text-muted">
          Author (optional, becomes a schema.org CreativeWork assertion)
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Ada Lovelace" className={cn(SEL, "mt-1 block w-full")} />
        </label>
        <p className="text-[12.5px] text-faint">
          {hasManifest ? "The file already has credentials, so the new manifest will be an edit with the current file as its parent ingredient — you'll see the chain." : "The file has no credentials, so a fresh “created” manifest is added."}
          {analysis && !SIGNABLE.has(analysis.scan.container) ? " This container can't be signed by the SDK." : ""}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void sign()} disabled={!can || state.kind === "busy"} className="inline-flex h-9 items-center gap-2 rounded-[var(--radius-sm)] bg-accent px-4 text-sm font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:opacity-40">
            {state.kind === "busy" ? <Loader size={14} className="animate-spin" /> : <ShieldCheck size={15} />}
            Sign with the test certificate
          </button>
          {state.kind === "busy" && <span className="text-[13px] text-muted">{state.step}</span>}
          {state.kind === "done" && (
            <span className="text-[13px] text-positive">
              Downloaded {state.name} ({formatBytes(state.size)}) and loaded it above — check the Summary and Credentials tabs.
            </span>
          )}
          {state.kind === "error" && (
            <span className="flex items-center gap-1 text-[13px] text-danger">
              <AlertTriangle size={14} /> {state.message}
            </span>
          )}
        </div>
      </div>
      <div className="panel p-4 text-[13px] leading-relaxed text-muted">
        <span className="readout">What happens under the hood</span>
        <ol className="mt-2 list-decimal space-y-1.5 pl-5">
          <li>The SDK (c2pa-rs compiled to WebAssembly) builds a claim: title, format, a <span className="font-mono text-[12px]">c2pa.actions</span> assertion with your digital source type, and a <span className="font-mono text-[12px]">c2pa.hash.data</span> assertion that hashes every byte of the file except the manifest itself.</li>
          <li>The claim is serialised as CBOR and handed to a signer. Here that is ~40 lines of code: WebCrypto ECDSA P-256 over the COSE <span className="font-mono text-[12px]">Sig_structure</span>, with the certificate chain in the protected header and zero-padding so the signature box is exactly the reserved size.</li>
          <li>Claim, assertions and signature are packed into JUMBF boxes and written into the container — APP11 segments for JPEG, a <span className="font-mono text-[12px]">caBX</span> chunk for PNG, a <span className="font-mono text-[12px]">uuid</span> box for MP4/HEIF, and so on.</li>
          <li>Any C2PA reader can now verify the hash and signature. Only a certificate on a published trust list makes the result <em>trusted</em> — that&apos;s the step a public test key can&apos;t take.</li>
        </ol>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- compare */

function Compare() {
  return (
    <div className="space-y-3">
      <div className="panel overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-[12.5px] leading-relaxed">
          <thead>
            <tr className="border-b border-edge text-ink">
              <th className="p-3 font-medium"></th>
              <th className="p-3 font-medium">C2PA Content Credentials</th>
              <th className="p-3 font-medium">SynthID</th>
              <th className="p-3 font-medium">IPTC / XMP metadata</th>
              <th className="p-3 font-medium">Visible watermark</th>
            </tr>
          </thead>
          <tbody className="text-muted">
            {COMPARE.map((r) => (
              <tr key={r.row} className="border-b border-edge align-top last:border-0">
                <th className="p-3 font-medium text-ink">{r.row}</th>
                <td className="p-3">{r.c2pa}</td>
                <td className="p-3">{r.synthid}</td>
                <td className="p-3">{r.iptc}</td>
                <td className="p-3">{r.visible}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel p-4 text-[13px] leading-relaxed text-muted">
        <span className="readout">They are complementary</span>
        <p className="mt-2">
          Content Credentials answer <em>who</em> and <em>how</em>, and anyone can check them — but they are fragile. SynthID answers only <em>was a Google model involved</em>, and only Google can check it — but it clings to the pixels. That is why Google ships both:
          the credentials carry the story, the watermark survives the screenshot. Neither proves a file is human-made; the absence of both proves nothing at all.
        </p>
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
          <a href="https://c2pa.org/specifications/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            C2PA specification <ExternalLink size={11} />
          </a>
          <a href="https://contentcredentials.org/verify" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            Official Verify tool <ExternalLink size={11} />
          </a>
          <a href="https://deepmind.google/technologies/synthid/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            SynthID <ExternalLink size={11} />
          </a>
          <a href="https://cv.iptc.org/newscodes/digitalsourcetype/" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
            IPTC digital source types <ExternalLink size={11} />
          </a>
        </p>
      </div>
    </div>
  );
}

function Empty({ children, spinner }: { children: React.ReactNode; spinner?: boolean }) {
  return (
    <div className="panel flex items-center gap-2 p-4 text-[13.5px] text-muted">
      {spinner ? <Loader size={15} className="animate-spin text-accent" /> : <Info size={15} className="text-faint" />}
      <span>{children}</span>
    </div>
  );
}
