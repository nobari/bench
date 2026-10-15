"use client";

/** First-run choice of how to keep the wallets, and the unlock screen for the password vault. */
import { useState } from "react";
import { KeyRound, Lock, ShieldCheck, Timer, Unlock } from "lucide-react";
import type { VaultMode } from "@/lib/tools/crypto/btc/store";
import { Btn, Field, Note } from "./ui";

const MODES: { id: VaultMode; name: string; icon: typeof Lock; blurb: string }[] = [
  { id: "password", name: "Password vault", icon: Lock, blurb: "Phrases are encrypted with a password (PBKDF2 · AES-GCM) before they touch this browser's storage. Locks after inactivity." },
  { id: "plain", name: "Remember without a password", icon: Unlock, blurb: "Phrases are stored unencrypted in this browser. Fine for test networks; not for coins you care about." },
  { id: "session", name: "This tab only", icon: Timer, blurb: "Nothing is stored. Close the tab and the wallets are gone unless you kept the phrases." },
];

export function VaultSetup({ onChoose, changing, onCancel }: { onChoose: (mode: VaultMode, password?: string) => Promise<void>; changing?: boolean; onCancel?: () => void }) {
  const [mode, setMode] = useState<VaultMode>("password");
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ok = mode !== "password" || (pw.length >= 8 && pw === pw2);
  return (
    <div className="panel p-4" data-vault-setup>
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">{changing ? "Change how wallets are kept" : "How should this browser keep your wallets?"}</h3>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">Keys never leave the page. The choice is about what survives a reload, and who can open it.</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {MODES.map((m) => (
          <button key={m.id} type="button" data-vault-mode={m.id} onClick={() => setMode(m.id)} className={`rounded-[var(--radius)] border p-3 text-left transition-colors ${mode === m.id ? "border-accent bg-accent-soft" : "border-edge hover:border-edge-bright"}`}>
            <m.icon size={15} className={mode === m.id ? "text-accent" : "text-muted"} />
            <div className="mt-1.5 text-[13px] font-medium text-ink">{m.name}</div>
            <div className="mt-1 text-[11.5px] leading-relaxed text-muted">{m.blurb}</div>
          </button>
        ))}
      </div>
      {mode === "password" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Password" hint="At least 8 characters. There is no reset: lose it and only your written-down phrases get the wallets back.">
            <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" data-vault-password />
          </Field>
          <Field label="Repeat password">
            <input type="password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" data-vault-password2 />
          </Field>
        </div>
      )}
      {mode === "plain" && <Note tone="warn" className="mt-3">Anyone who can read this browser&apos;s storage can read the phrases. Use it for test networks and small experiments.</Note>}
      {error && <Note tone="error" className="mt-3">{error}</Note>}
      <div className="mt-3 flex items-center justify-end gap-2">
        {onCancel && <Btn onClick={onCancel}>Cancel</Btn>}
        <Btn
          tone="primary"
          disabled={!ok || busy}
          data-vault-continue
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await onChoose(mode, mode === "password" ? pw : undefined);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {changing ? "Apply" : "Continue"}
        </Btn>
      </div>
    </div>
  );
}

export function UnlockScreen({ onUnlock, onForget, walletCount }: { onUnlock: (pw: string) => Promise<boolean>; onForget: () => void; walletCount: number }) {
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState(false);
  const [confirmForget, setConfirmForget] = useState(false);
  const submit = async () => {
    if (!pw) return;
    setBusy(true);
    const ok = await onUnlock(pw);
    setBusy(false);
    setBad(!ok);
    if (ok) setPw("");
  };
  return (
    <div className="panel mx-auto max-w-md p-5" data-vault-locked>
      <div className="flex items-center gap-2">
        <KeyRound size={16} className="text-accent" />
        <h3 className="text-sm font-semibold text-ink">Vault locked</h3>
      </div>
      <p className="mt-1 text-[12.5px] text-muted">
        {walletCount} wallet{walletCount === 1 ? "" : "s"} are kept encrypted in this browser. Enter the vault password to open them.
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Vault password" autoComplete="current-password" autoFocus data-unlock-password />
        <Btn tone="primary" type="submit" disabled={!pw || busy} data-unlock>
          Unlock
        </Btn>
      </form>
      {bad && (
        <Note tone="error" className="mt-3" data-unlock-error>
          Wrong password.
        </Note>
      )}
      <div className="mt-4 border-t border-edge pt-3 text-[11.5px] text-faint">
        Forgot it? The phrases cannot be recovered from here.{" "}
        {confirmForget ? (
          <span>
            Remove the vault and every wallet in it?{" "}
            <button type="button" className="text-danger underline" onClick={onForget} data-forget-confirm>
              Yes, remove everything
            </button>{" "}
            ·{" "}
            <button type="button" className="underline" onClick={() => setConfirmForget(false)}>
              Keep it
            </button>
          </span>
        ) : (
          <button type="button" className="underline hover:text-ink" onClick={() => setConfirmForget(true)} data-forget>
            Start over with a new vault
          </button>
        )}
      </div>
    </div>
  );
}
