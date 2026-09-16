"use client";

import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from "lz-string";
import { AlertTriangle, ArrowRight, Check, KeyRound, ShieldCheck, ShieldOff, ShieldX, Wand2, X } from "lucide-react";
import {
  decodeJwt,
  describeClaims,
  generateKeyPair,
  isSymmetric,
  signJwt,
  tokenTime,
  verifyJwt,
  type ClaimInfo,
  type VerifyResult,
} from "@/lib/tools/web/jwt";
import { CopyButton } from "@/components/copy-button";
import { SHARE_SYNC_EVENT } from "@/components/share-button";
import { cn } from "@/lib/utils";

const MODES = ["decode", "encode"] as const;

const DEFAULT_HEADER = JSON.stringify({ alg: "HS256", typ: "JWT" }, null, 2);
const DEFAULT_PAYLOAD = JSON.stringify({ sub: "1234567890", name: "Ada Lovelace", role: "admin" }, null, 2);

/** The token is read once from the URL (`t` query param or compressed hash); keys and secrets never leave local state. */
function readInitial(): string {
  if (typeof window === "undefined") return "";
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const h = hash.get("t");
  if (h) {
    try {
      const v = decompressFromEncodedURIComponent(h);
      if (v) return v;
    } catch {
      /* ignore */
    }
  }
  return new URLSearchParams(window.location.search).get("t") ?? "";
}

const F = "rounded-[var(--radius-sm)] border border-edge bg-base px-2 font-mono text-[12.5px] text-ink outline-none placeholder:text-faint focus:border-accent";
const GHOST =
  "inline-flex h-7 items-center gap-1 rounded-[var(--radius-sm)] border border-edge px-2 text-[12px] text-muted transition-colors hover:border-accent hover:text-accent disabled:pointer-events-none disabled:opacity-40";
const PRIMARY =
  "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 text-[13px] font-medium text-on-accent hover:bg-[var(--color-accent-hover)] disabled:pointer-events-none disabled:opacity-40";
const PART_COLORS = { header: "var(--accent)", payload: "var(--cat-gen)", signature: "var(--cat-time)" };

export function JwtWidget() {
  const [mode, setMode] = useQueryState("m", parseAsStringLiteral(MODES).withDefault("decode").withOptions({ history: "replace" }));
  const [token, setToken] = useState(readInitial);
  const [secret, setSecret] = useState("");
  const [secretB64, setSecretB64] = useState(false);
  const [keyText, setKeyText] = useState("");
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [now, setNow] = useState(0);

  // encode
  const [headerText, setHeaderText] = useState(DEFAULT_HEADER);
  const [payloadText, setPayloadText] = useState(DEFAULT_PAYLOAD);
  const [encSecret, setEncSecret] = useState("");
  const [encSecretB64, setEncSecretB64] = useState(false);
  const [encKey, setEncKey] = useState("");
  const [encPublic, setEncPublic] = useState("");
  const [signed, setSigned] = useState("");
  const [encError, setEncError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const deferredToken = useDeferredValue(token);
  const decoded = useMemo(() => decodeJwt(deferredToken), [deferredToken]);
  const alg = decoded.ok ? decoded.value.alg : "";
  const claims: ClaimInfo[] = useMemo(() => (decoded.ok && now ? describeClaims(decoded.value.payload, now) : []), [decoded, now]);
  const time = decoded.ok && now ? tokenTime(decoded.value.payload, now) : null;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setNow(Date.now());
    });
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const hasKey = decoded.ok && (isSymmetric(alg) ? secret.trim() !== "" : keyText.trim() !== "");
    if (!decoded.ok || !alg || alg === "none" || !hasKey) {
      queueMicrotask(() => {
        if (active) setVerify(null);
      });
      return () => {
        active = false;
      };
    }
    verifyJwt(deferredToken, { secret, secretIsBase64: secretB64, key: keyText }).then((r) => {
      if (active) setVerify(r);
    });
    return () => {
      active = false;
    };
  }, [deferredToken, decoded, alg, secret, secretB64, keyText]);

  useEffect(() => {
    const sync = () => {
      const h = new URLSearchParams();
      if (token.trim()) h.set("t", compressToEncodedURIComponent(token.trim()));
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}#${h}`);
    };
    window.addEventListener(SHARE_SYNC_EVENT, sync);
    return () => window.removeEventListener(SHARE_SYNC_EVENT, sync);
  }, [token]);

  const encAlg = useMemo(() => {
    try {
      const h = JSON.parse(headerText) as { alg?: unknown };
      return typeof h.alg === "string" ? h.alg : "";
    } catch {
      return "";
    }
  }, [headerText]);

  const sign = async () => {
    setBusy(true);
    setEncError(null);
    try {
      const header = JSON.parse(headerText) as Record<string, unknown>;
      const payload = JSON.parse(payloadText) as Record<string, unknown>;
      const t = await signJwt(header, payload, { secret: encSecret, secretIsBase64: encSecretB64, key: encKey });
      setSigned(t);
    } catch (e) {
      setSigned("");
      setEncError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const setTimes = () => {
    try {
      const p = JSON.parse(payloadText) as Record<string, unknown>;
      const t = Math.floor(Date.now() / 1000);
      setPayloadText(JSON.stringify({ ...p, iat: t, exp: t + 3600 }, null, 2));
      setEncError(null);
    } catch {
      setEncError("The payload isn't valid JSON.");
    }
  };

  const genKeys = async () => {
    setBusy(true);
    setEncError(null);
    try {
      const pair = await generateKeyPair(encAlg);
      setEncKey(pair.privateKey);
      setEncPublic(pair.publicKey);
    } catch (e) {
      setEncError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const decodeSigned = () => {
    setToken(signed);
    if (isSymmetric(encAlg)) {
      setSecret(encSecret);
      setSecretB64(encSecretB64);
    } else if (encPublic) setKeyText(encPublic);
    setMode("decode");
  };

  return (
    <div className="space-y-3">
      {/* control bar */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(
            [
              ["decode", "Decode & verify"],
              ["encode", "Encode & sign"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setMode(id)}
              className={cn(
                "h-7 rounded-[3px] px-3 text-[13px] transition-colors",
                mode === id ? "bg-accent font-medium text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "decode" && decoded.ok && (
          <div className="ml-auto flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="rounded border border-edge px-1.5 font-mono text-[11.5px] text-ink">{alg || "no alg"}</span>
            {typeof decoded.value.header.typ === "string" && (
              <span className="rounded border border-edge px-1.5 font-mono text-[11.5px] text-muted">{decoded.value.header.typ}</span>
            )}
            {time && (
              <span
                className={cn(
                  "font-medium",
                  time.state === "valid" && "text-positive",
                  time.state === "expired" && "text-danger",
                  time.state === "not-yet-valid" && "text-warn",
                  time.state === "no-exp" && "text-faint",
                )}
              >
                {time.text}
              </span>
            )}
            <SignatureBadge alg={alg} result={verify} />
          </div>
        )}
      </div>

      {mode === "decode" ? (
        <>
          {/* token */}
          <div className={cn("panel flex flex-col", !decoded.ok && decoded.error !== "empty" && "border-danger/50")}>
            <div className="flex items-center justify-between border-b border-edge px-3 py-2">
              <span className="readout">Token</span>
              <div className="flex items-center gap-2">
                {token && (
                  <button onClick={() => setToken("")} className="inline-flex items-center gap-1 text-[12px] text-faint hover:text-danger">
                    <X size={12} /> Clear
                  </button>
                )}
                <CopyButton value={token.trim()} />
              </div>
            </div>
            <textarea
              value={token}
              onChange={(e) => setToken(e.target.value)}
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              placeholder="Paste a JWT — eyJhbGciOi…"
              className="min-h-[96px] resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-faint"
              style={{ wordBreak: "break-all" }}
            />
            {decoded.ok ? (
              <div className="border-t border-edge px-3 py-2 font-mono text-[12px] leading-relaxed" style={{ wordBreak: "break-all" }}>
                <span style={{ color: PART_COLORS.header }}>{decoded.value.raw.header}</span>
                <span className="text-faint">.</span>
                <span style={{ color: PART_COLORS.payload }}>{decoded.value.raw.payload}</span>
                <span className="text-faint">.</span>
                <span style={{ color: PART_COLORS.signature }}>{decoded.value.raw.signature || "(no signature)"}</span>
              </div>
            ) : decoded.error !== "empty" ? (
              <p className="flex items-center gap-2 border-t border-edge px-3 py-2 text-[12.5px] text-danger">
                <AlertTriangle size={14} /> {decoded.error}
              </p>
            ) : null}
          </div>

          {decoded.ok && (
            <div className="grid gap-3 lg:grid-cols-2">
              <JsonPanel label="Header" color={PART_COLORS.header} value={decoded.value.header} />
              <div className="space-y-3">
                <JsonPanel label="Payload" color={PART_COLORS.payload} value={decoded.value.payload} />
                {claims.length > 0 && (
                  <div className="panel">
                    <div className="border-b border-edge px-3 py-2">
                      <span className="readout">Claims</span>
                    </div>
                    <dl className="divide-y divide-edge">
                      {claims.map((c) => (
                        <div key={c.key} className="flex flex-wrap gap-x-3 gap-y-0.5 px-3 py-2 text-[13px]">
                          <dt className="w-32 shrink-0 text-muted">
                            {c.label}
                            {c.label !== c.key && <span className="ml-1 font-mono text-[11px] text-faint">{c.key}</span>}
                          </dt>
                          <dd className="min-w-0 flex-1">
                            {c.date ? (
                              <>
                                <span className="text-ink">{c.date.toLocaleString()}</span>
                                <span className="ml-2 text-[12px] text-faint">{c.date.toISOString()}</span>
                                <span
                                  className={cn(
                                    "ml-2 text-[12px] font-medium",
                                    c.status === "expired" ? "text-danger" : c.status === "future" ? "text-warn" : "text-positive",
                                  )}
                                >
                                  {c.relative}
                                </span>
                              </>
                            ) : (
                              <code className="break-all font-mono text-[12.5px] text-ink">
                                {typeof c.value === "string" ? c.value : JSON.stringify(c.value)}
                              </code>
                            )}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}
              </div>
            </div>
          )}

          {decoded.ok && (
            <div className="panel">
              <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                <span className="readout" style={{ color: PART_COLORS.signature }}>
                  Verify signature
                </span>
                <span className="text-[12px] text-faint">
                  {alg === "none" || !alg
                    ? "unsigned token"
                    : isSymmetric(alg)
                      ? `${alg} — enter the shared secret`
                      : `${alg} — paste the public key (PEM, JWK or JWKS)`}
                </span>
                <span className="ml-auto text-[11.5px] text-faint">Secrets and keys stay in your browser.</span>
              </div>
              {alg && alg !== "none" && (
                <div className="p-3">
                  {isSymmetric(alg) ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        value={secret}
                        onChange={(e) => setSecret(e.target.value)}
                        placeholder="shared secret"
                        spellCheck={false}
                        autoCapitalize="off"
                        className={cn(F, "h-8 min-w-[240px] flex-1")}
                      />
                      <label className="flex items-center gap-1.5 text-[12px] text-muted" title="Decode the secret from base64 / base64url before use">
                        <input type="checkbox" checked={secretB64} onChange={(e) => setSecretB64(e.target.checked)} className="accent-[var(--accent)]" />
                        secret is base64
                      </label>
                    </div>
                  ) : (
                    <textarea
                      value={keyText}
                      onChange={(e) => setKeyText(e.target.value)}
                      spellCheck={false}
                      placeholder={"-----BEGIN PUBLIC KEY-----\n…\n-----END PUBLIC KEY-----\n\nor a JWK / JWKS JSON"}
                      className={cn(F, "min-h-[110px] w-full resize-y py-2")}
                    />
                  )}
                  {verify && (
                    <p
                      className={cn(
                        "mt-2 flex items-center gap-2 text-[13px]",
                        verify.state === "valid" && "text-positive",
                        verify.state === "invalid" && "text-danger",
                        verify.state === "error" && "text-warn",
                      )}
                    >
                      {verify.state === "valid" ? <ShieldCheck size={15} /> : verify.state === "invalid" ? <ShieldX size={15} /> : <AlertTriangle size={15} />}
                      {verify.message}
                    </p>
                  )}
                </div>
              )}
              {(alg === "none" || !alg) && (
                <p className="flex items-center gap-2 p-3 text-[13px] text-warn">
                  <ShieldOff size={15} /> This token is unsigned (alg {alg ? '"none"' : "missing"}). Anyone can forge it — never trust its claims.
                </p>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <TextPanel label="Header" color={PART_COLORS.header} value={headerText} onChange={setHeaderText} />
            <TextPanel
              label="Payload"
              color={PART_COLORS.payload}
              value={payloadText}
              onChange={setPayloadText}
              actions={
                <button onClick={setTimes} className={GHOST} title="Set iat to now and exp to one hour from now">
                  iat / exp = now + 1 h
                </button>
              }
            />
          </div>

          <div className="panel">
            <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
              <span className="readout" style={{ color: PART_COLORS.signature }}>
                Sign
              </span>
              <span className="text-[12px] text-faint">
                {!encAlg ? 'set "alg" in the header' : isSymmetric(encAlg) ? `${encAlg} — shared secret` : `${encAlg} — private key (PKCS#8 PEM or JWK)`}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {encAlg && !isSymmetric(encAlg) && encAlg !== "none" && (
                  <button onClick={genKeys} disabled={busy} className={GHOST} title="Generate a fresh key pair in your browser">
                    <KeyRound size={13} /> Generate key pair
                  </button>
                )}
                <button onClick={sign} disabled={busy || !encAlg} className={PRIMARY}>
                  <Wand2 size={13} /> Sign token
                </button>
              </div>
            </div>
            <div className="space-y-2 p-3">
              {isSymmetric(encAlg) || !encAlg ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={encSecret}
                    onChange={(e) => setEncSecret(e.target.value)}
                    placeholder="shared secret"
                    spellCheck={false}
                    autoCapitalize="off"
                    className={cn(F, "h-8 min-w-[240px] flex-1")}
                  />
                  <label className="flex items-center gap-1.5 text-[12px] text-muted">
                    <input type="checkbox" checked={encSecretB64} onChange={(e) => setEncSecretB64(e.target.checked)} className="accent-[var(--accent)]" />
                    secret is base64
                  </label>
                </div>
              ) : (
                <div className="grid gap-2 lg:grid-cols-2">
                  <textarea
                    value={encKey}
                    onChange={(e) => setEncKey(e.target.value)}
                    spellCheck={false}
                    placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
                    className={cn(F, "min-h-[120px] w-full resize-y py-2")}
                  />
                  <div className="flex min-w-0 flex-col gap-1">
                    <textarea
                      value={encPublic}
                      readOnly
                      spellCheck={false}
                      placeholder="Public key appears here after Generate key pair"
                      className={cn(F, "min-h-[92px] w-full flex-1 resize-y py-2 text-muted")}
                    />
                    {encPublic && (
                      <div className="flex gap-2">
                        <CopyButton value={encPublic} label="Copy public key" />
                      </div>
                    )}
                  </div>
                </div>
              )}
              {encError && (
                <p className="flex items-center gap-2 text-[12.5px] text-danger">
                  <AlertTriangle size={14} /> {encError}
                </p>
              )}
            </div>
          </div>

          {signed && (
            <div className="panel">
              <div className="flex items-center justify-between border-b border-edge px-3 py-2">
                <span className="readout">Signed token</span>
                <div className="flex items-center gap-2">
                  <button onClick={decodeSigned} className={GHOST}>
                    Decode & verify it <ArrowRight size={13} />
                  </button>
                  <CopyButton value={signed} />
                </div>
              </div>
              <p className="p-3 font-mono text-[12.5px] leading-relaxed text-ink" style={{ wordBreak: "break-all" }}>
                {signed}
              </p>
              <p className="flex items-center gap-2 border-t border-edge px-3 py-1.5 text-[12px] text-positive">
                <Check size={13} /> Signed with {encAlg} in your browser. {signed.length.toLocaleString()} characters.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SignatureBadge({ alg, result }: { alg: string; result: VerifyResult | null }) {
  if (!alg || alg === "none")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-warn">
        <ShieldOff size={14} /> Unsigned
      </span>
    );
  if (!result)
    return (
      <span className="inline-flex items-center gap-1 text-faint">
        <ShieldCheck size={14} /> Signature not verified
      </span>
    );
  if (result.state === "valid")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-positive">
        <ShieldCheck size={14} /> Signature valid
      </span>
    );
  if (result.state === "invalid")
    return (
      <span className="inline-flex items-center gap-1 font-medium text-danger">
        <ShieldX size={14} /> Signature invalid
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-warn">
      <AlertTriangle size={14} /> Can&apos;t verify
    </span>
  );
}

function JsonPanel({ label, color, value }: { label: string; color: string; value: Record<string, unknown> }) {
  const text = JSON.stringify(value, null, 2);
  return (
    <div className="panel flex min-w-0 flex-col">
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="readout" style={{ color }}>
          {label}
        </span>
        <CopyButton value={text} />
      </div>
      <pre className="overflow-auto p-3 font-mono text-[12.5px] leading-relaxed text-ink">{text}</pre>
    </div>
  );
}

function TextPanel({
  label,
  color,
  value,
  onChange,
  actions,
}: {
  label: string;
  color: string;
  value: string;
  onChange: (v: string) => void;
  actions?: React.ReactNode;
}) {
  let error: string | null = null;
  try {
    JSON.parse(value);
  } catch (e) {
    error = e instanceof Error ? e.message.replace(/ in JSON at position \d+.*$/, "") : "invalid JSON";
  }
  return (
    <div className={cn("panel flex min-w-0 flex-col", error && "border-danger/50")}>
      <div className="flex items-center justify-between gap-2 border-b border-edge px-3 py-2">
        <span className="readout" style={{ color }}>
          {label}
        </span>
        <div className="flex items-center gap-2">{actions}</div>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="min-h-[150px] flex-1 resize-y bg-transparent p-3 font-mono text-[12.5px] leading-relaxed text-ink outline-none"
      />
      <div className={cn("border-t border-edge px-3 py-1.5 readout", error && "text-danger")}>{error ?? "valid JSON"}</div>
    </div>
  );
}
