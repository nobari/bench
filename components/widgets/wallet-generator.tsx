"use client";

import { useEffect, useMemo, useState } from "react";
import { Eye, EyeOff, RefreshCw, ShieldAlert } from "lucide-react";
import {
  deriveAccounts,
  isValidMnemonic,
  newMnemonic,
  randomAccount,
  type Account,
} from "@/lib/tools/crypto/wallet";
import { CopyButton } from "@/components/copy-button";
import { cn } from "@/lib/utils";

export function WalletGeneratorWidget() {
  const [mode, setMode] = useState<"hd" | "single">("hd");
  const [words, setWords] = useState<12 | 24>(12);
  const [mnemonic, setMnemonic] = useState("");
  const [count, setCount] = useState(3);
  const [reveal, setReveal] = useState(false);
  const [single, setSingle] = useState<Account | null>(null);

  // Initial generation runs off-render (CSPRNG is impure).
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setMnemonic((m) => m || newMnemonic(12));
      setSingle((s) => s ?? randomAccount());
    });
    return () => {
      active = false;
    };
  }, []);

  // Derivation is deterministic → pure useMemo.
  const valid = useMemo(() => isValidMnemonic(mnemonic), [mnemonic]);
  const accounts = useMemo(
    () => (valid ? deriveAccounts(mnemonic, Math.min(Math.max(count, 1), 10)) : []),
    [mnemonic, count, valid],
  );

  const list = mode === "hd" ? accounts : single ? [single] : [];

  return (
    <div className="space-y-3">
      {/* security warning */}
      <div className="flex items-start gap-2.5 rounded-[var(--radius)] border border-warn/40 bg-warn/[0.06] p-3">
        <ShieldAlert size={16} className="mt-0.5 shrink-0 text-warn" />
        <p className="text-[13px] leading-relaxed text-muted">
          <span className="font-semibold text-warn">For development & learning only.</span>{" "}
          Keys are generated locally in your browser and never sent anywhere — but
          you should <span className="text-ink">never</span> use a wallet
          generated on any website to hold real funds. Use a hardware or audited
          wallet for anything of value.
        </p>
      </div>

      {/* mode + controls */}
      <div className="panel flex flex-wrap items-center gap-2 p-2">
        <div className="flex rounded-[var(--radius-sm)] border border-edge p-0.5">
          {(["hd", "single"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={cn(
                "h-8 rounded-[3px] px-3 font-mono text-xs transition-colors",
                mode === m ? "bg-accent text-on-accent" : "text-muted hover:text-ink",
              )}
            >
              {m === "hd" ? "HD wallet" : "Single key"}
            </button>
          ))}
        </div>

        {mode === "hd" && (
          <>
            <select
              value={words}
              onChange={(e) => {
                const w = Number(e.target.value) as 12 | 24;
                setWords(w);
                setMnemonic(newMnemonic(w));
              }}
              className="input h-9 w-auto text-xs"
              aria-label="Mnemonic length"
            >
              <option value={12}>12 words</option>
              <option value={24}>24 words</option>
            </select>
            <div className="flex items-center gap-2">
              <span className="readout">Accounts</span>
              <input
                type="range"
                min={1}
                max={10}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="h-1.5 w-24 cursor-pointer appearance-none rounded-full bg-raised accent-[var(--accent)]"
              />
              <span className="font-mono text-xs tabular text-muted">{count}</span>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setReveal((r) => !r)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] border px-2.5 font-mono text-xs transition-colors",
              reveal ? "border-warn text-warn" : "border-edge text-muted hover:text-ink",
            )}
          >
            {reveal ? <EyeOff size={13} /> : <Eye size={13} />}
            {reveal ? "Hide keys" : "Reveal keys"}
          </button>
          <button
            onClick={() =>
              mode === "hd" ? setMnemonic(newMnemonic(words)) : setSingle(randomAccount())
            }
            className="inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-3 font-mono text-xs font-semibold text-on-accent transition-[filter] hover:brightness-110"
          >
            <RefreshCw size={13} /> New
          </button>
        </div>
      </div>

      {/* mnemonic (HD only) — editable, doubles as import */}
      {mode === "hd" && (
        <div className="panel registered">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="readout">Recovery phrase (BIP39)</span>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "font-mono text-[11px]",
                  valid ? "text-positive" : "text-danger",
                )}
              >
                {valid ? "valid" : "invalid"}
              </span>
              <CopyButton value={mnemonic} label="Copy" />
            </div>
          </div>
          <textarea
            value={mnemonic}
            onChange={(e) => setMnemonic(e.target.value)}
            spellCheck={false}
            placeholder="Generate a phrase, or paste an existing BIP39 mnemonic to derive its addresses…"
            className="min-h-[68px] w-full resize-y bg-transparent p-3 font-mono text-sm leading-relaxed text-ink outline-none placeholder:text-faint"
          />
          {valid && (
            <div className="flex flex-wrap gap-1.5 border-t border-edge p-3">
              {mnemonic.trim().split(/\s+/).map((w, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-edge bg-base px-2 py-1 font-mono text-xs text-ink"
                >
                  <span className="text-faint tabular">{i + 1}</span>
                  {w}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* accounts */}
      <div className="space-y-2">
        {mode === "hd" && !valid ? (
          <div className="panel p-6 text-center font-mono text-xs text-danger">
            Enter a valid BIP39 mnemonic to derive addresses.
          </div>
        ) : (
          list.map((a) => (
            <div key={a.index} className="panel registered p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="readout">
                  Account {a.index} <span className="text-faint">· {a.path}</span>
                </span>
              </div>
              <KeyRow label="Address" value={a.address} mono accent />
              <KeyRow label="Private key" value={a.privateKey} mono secret={!reveal} />
              <KeyRow label="Public key" value={a.publicKey} mono secret={!reveal} truncate />
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function mask(v: string) {
  if (v.length <= 8) return "•".repeat(v.length);
  return v.slice(0, 4) + "•".repeat(Math.min(40, v.length - 8)) + v.slice(-4);
}

function KeyRow({
  label,
  value,
  accent,
  secret,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  accent?: boolean;
  secret?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-edge py-2 first:border-t-0">
      <span className="readout w-24 shrink-0">{label}</span>
      <code
        className={cn(
          "flex-1 font-mono text-[13px]",
          truncate ? "truncate" : "break-all",
          accent ? "text-accent" : "text-ink",
          secret && "text-muted",
        )}
      >
        {secret ? mask(value) : value}
      </code>
      <CopyButton value={value} label="" className="shrink-0" />
    </div>
  );
}
