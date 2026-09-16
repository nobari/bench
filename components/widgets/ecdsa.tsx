"use client";

import { useState } from "react";
import { CheckCircle2, KeyRound, PenLine, ShieldCheck, XCircle } from "lucide-react";
import {
  CURVES,
  HASHES,
  generateKeyPair,
  sign,
  verify,
  type EcdsaCurve,
  type EcdsaHash,
} from "@/lib/tools/crypto/ecdsa";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

type VerifyState = "idle" | "pass" | "fail";

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function EcdsaWidget() {
  const [curve, setCurve] = useState<EcdsaCurve>("P-256");

  // Keys (editable so users can paste their own).
  const [publicJwk, setPublicJwk] = useState("");
  const [privateJwk, setPrivateJwk] = useState("");
  const [genError, setGenError] = useState("");
  const [busyGen, setBusyGen] = useState(false);

  // Sign panel.
  const [signMessage, setSignMessage] = useState("");
  const [signHash, setSignHash] = useState<EcdsaHash>("SHA-256");
  const [signature, setSignature] = useState("");
  const [signError, setSignError] = useState("");
  const [busySign, setBusySign] = useState(false);

  // Verify panel.
  const [verifyMessage, setVerifyMessage] = useState("");
  const [verifyHash, setVerifyHash] = useState<EcdsaHash>("SHA-256");
  const [verifySignature, setVerifySignature] = useState("");
  const [verifyResult, setVerifyResult] = useState<VerifyState>("idle");
  const [verifyError, setVerifyError] = useState("");
  const [busyVerify, setBusyVerify] = useState(false);

  async function onGenerate() {
    setBusyGen(true);
    setGenError("");
    try {
      const pair = await generateKeyPair(curve);
      setPublicJwk(pair.publicJwk);
      setPrivateJwk(pair.privateJwk);
    } catch (e) {
      setGenError(errMessage(e));
    } finally {
      setBusyGen(false);
    }
  }

  async function onSign() {
    setBusySign(true);
    setSignError("");
    setSignature("");
    try {
      const sig = await sign(privateJwk, signMessage, curve, signHash);
      setSignature(sig);
    } catch (e) {
      setSignError(errMessage(e));
    } finally {
      setBusySign(false);
    }
  }

  async function onVerify() {
    setBusyVerify(true);
    setVerifyError("");
    setVerifyResult("idle");
    try {
      const ok = await verify(publicJwk, verifyMessage, verifySignature, curve, verifyHash);
      setVerifyResult(ok ? "pass" : "fail");
    } catch (e) {
      setVerifyError(errMessage(e));
    } finally {
      setBusyVerify(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="font-mono text-xs text-faint">
        Everything runs locally in your browser via the Web Crypto API — keys and
        messages never leave this page.
      </p>

      {/* ---- Keys -------------------------------------------------------- */}
      <section className="panel registered">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-edge px-3 py-2">
          <span className="readout inline-flex items-center gap-1.5">
            <KeyRound size={13} /> Keys
          </span>
          <div className="flex items-center gap-2">
            <label className="readout flex items-center gap-2">
              Curve
              <select
                value={curve}
                onChange={(e) => setCurve(e.target.value as EcdsaCurve)}
                className="input w-auto py-1"
              >
                {CURVES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={onGenerate}
              disabled={busyGen}
              className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busyGen ? "Generating…" : "Generate key pair"}
            </button>
          </div>
        </div>

        <div className="grid gap-3 p-3 md:grid-cols-2">
          <KeyField
            label="Public Key (JWK)"
            value={publicJwk}
            onChange={setPublicJwk}
            placeholder="Generate, or paste a public JWK…"
          />
          <KeyField
            label="Private Key (JWK)"
            value={privateJwk}
            onChange={setPrivateJwk}
            placeholder="Generate, or paste a private JWK…"
          />
        </div>

        {genError && (
          <p className="px-3 pb-3 font-mono text-xs text-danger">{genError}</p>
        )}
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* ---- Sign ------------------------------------------------------ */}
        <section className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout inline-flex items-center gap-1.5">
              <PenLine size={13} /> Sign
            </span>
            <HashSelect value={signHash} onChange={setSignHash} />
          </div>

          <div className="flex flex-1 flex-col gap-3 p-3">
            <Labeled label="Message">
              <textarea
                value={signMessage}
                onChange={(e) => setSignMessage(e.target.value)}
                spellCheck={false}
                placeholder="Message to sign…"
                className="input min-h-[80px] resize-y"
              />
            </Labeled>

            <Labeled label="Private Key (JWK)">
              <textarea
                value={privateJwk}
                onChange={(e) => setPrivateJwk(e.target.value)}
                spellCheck={false}
                placeholder="Private JWK…"
                className="input min-h-[80px] resize-y"
              />
            </Labeled>

            <button
              type="button"
              onClick={onSign}
              disabled={busySign}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busySign ? "Signing…" : "Sign"}
            </button>

            {signError && <p className="font-mono text-xs text-danger">{signError}</p>}

            {signature && (
              <Labeled
                label="Signature (base64)"
                action={<CopyButton value={signature} label="Copy" />}
              >
                <textarea
                  readOnly
                  value={signature}
                  spellCheck={false}
                  className="input min-h-[72px] resize-y text-positive"
                />
              </Labeled>
            )}
          </div>
        </section>

        {/* ---- Verify ---------------------------------------------------- */}
        <section className="panel registered flex flex-col">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout inline-flex items-center gap-1.5">
              <ShieldCheck size={13} /> Verify
            </span>
            <HashSelect value={verifyHash} onChange={setVerifyHash} />
          </div>

          <div className="flex flex-1 flex-col gap-3 p-3">
            <Labeled label="Message">
              <textarea
                value={verifyMessage}
                onChange={(e) => setVerifyMessage(e.target.value)}
                spellCheck={false}
                placeholder="Original message…"
                className="input min-h-[80px] resize-y"
              />
            </Labeled>

            <Labeled label="Public Key (JWK)">
              <textarea
                value={publicJwk}
                onChange={(e) => setPublicJwk(e.target.value)}
                spellCheck={false}
                placeholder="Public JWK…"
                className="input min-h-[80px] resize-y"
              />
            </Labeled>

            <Labeled label="Signature (base64)">
              <textarea
                value={verifySignature}
                onChange={(e) => setVerifySignature(e.target.value)}
                spellCheck={false}
                placeholder="base64 signature…"
                className="input min-h-[72px] resize-y"
              />
            </Labeled>

            <button
              type="button"
              onClick={onVerify}
              disabled={busyVerify}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busyVerify ? "Verifying…" : "Verify"}
            </button>

            {verifyError && (
              <p className="font-mono text-xs text-danger">{verifyError}</p>
            )}

            {verifyResult === "pass" && (
              <div className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-positive/40 bg-positive/10 px-3 py-2 font-mono text-sm font-semibold text-positive">
                <CheckCircle2 size={16} /> PASS — signature is valid
              </div>
            )}
            {verifyResult === "fail" && (
              <div className="inline-flex items-center gap-2 rounded-[var(--radius-sm)] border border-danger/40 bg-danger/10 px-3 py-2 font-mono text-sm font-semibold text-danger">
                <XCircle size={16} /> FAIL — signature does not match
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---- small presentational helpers ---------------------------------------- */

function KeyField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <Labeled label={label} action={<CopyButton value={value} label="Copy" />}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        placeholder={placeholder}
        className="input min-h-[150px] resize-y"
      />
    </Labeled>
  );
}

function Labeled({
  label,
  action,
  children,
}: {
  label: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="readout">{label}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

function HashSelect({
  value,
  onChange,
}: {
  value: EcdsaHash;
  onChange: (v: EcdsaHash) => void;
}) {
  return (
    <label className={cn("readout flex items-center gap-2")}>
      Hash
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as EcdsaHash)}
        className="input w-auto py-1"
      >
        {HASHES.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
    </label>
  );
}
