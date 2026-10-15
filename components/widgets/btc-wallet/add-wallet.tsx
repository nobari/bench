"use client";

/** Adding a wallet: pick from fresh candidates (or the next account of a seed you hold), import a phrase, watch an xpub or address, or restore a backup file. */
import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ADDRESS_TYPES, isValidMnemonic, mnemonicWords, normalizeMnemonic, type AddressType } from "@/lib/tools/crypto/btc/keys";
import type { WalletRecord } from "@/lib/tools/crypto/btc/store";
import { cn } from "@/lib/utils";
import type { Candidate, Engine } from "./engine";
import { Btn, Field, Note, Seg } from "./ui";

type Mode = "create" | "import" | "watch" | "restore";

export function AddWallet({ engine, onDone, initial = "create" }: { engine: Engine; onDone: (w: WalletRecord | null) => void; initial?: Mode }) {
  const [mode, setMode] = useState<Mode>(initial);
  const [type, setType] = useState<AddressType>("p2wpkh");
  const hdWallets = engine.wallets.filter((w) => w.kind === "hd" && engine.hasSecrets(w.id));
  return (
    <div className="space-y-3" data-add-wallet-dialog>
      <Seg
        name="add-mode"
        value={mode}
        onChange={setMode}
        options={[
          { id: "create", label: "Create" },
          { id: "import", label: "Import phrase" },
          { id: "watch", label: "Watch-only" },
          { id: "restore", label: "Restore backup" },
        ]}
      />
      {mode !== "restore" && (
        <Field label="Address type" hint={ADDRESS_TYPES.find((t) => t.id === type)?.blurb}>
          <div className="grid gap-1.5 sm:grid-cols-3">
            {ADDRESS_TYPES.map((t) => (
              <button key={t.id} type="button" data-address-type={t.id} onClick={() => setType(t.id)} className={cn("rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-colors", type === t.id ? "border-accent bg-accent-soft" : "border-edge hover:border-edge-bright")}>
                <div className="text-[12.5px] font-medium text-ink">{t.name}</div>
                <div className="font-mono text-[11px] text-faint">
                  BIP{t.purpose} · {t.prefix[engine.network]}…
                </div>
              </button>
            ))}
          </div>
        </Field>
      )}
      {mode === "create" && <CreatePanel engine={engine} type={type} hdWallets={hdWallets} onDone={onDone} />}
      {mode === "import" && <ImportPanel engine={engine} type={type} onDone={onDone} />}
      {mode === "watch" && <WatchPanel engine={engine} type={type} onDone={onDone} />}
      {mode === "restore" && <RestorePanel engine={engine} onDone={onDone} />}
    </div>
  );
}

function CreatePanel({ engine, type, hdWallets, onDone }: { engine: Engine; type: AddressType; hdWallets: WalletRecord[]; onDone: (w: WalletRecord) => void }) {
  const [source, setSource] = useState<string>("new");
  const [list, setList] = useState<Candidate[]>([]);
  const [pick, setPick] = useState<number>(0);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Candidates come from the CSPRNG, so they are drawn off-render.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setList(engine.candidates(type, 10));
      setPick(0);
    });
    return () => {
      active = false;
    };
  }, [engine, type, engine.network]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const w = source === "new" ? await engine.createFromMnemonic(list[pick].mnemonic, type, name) : await engine.createNextAccount(source, type);
      if (source !== "new" && name.trim()) engine.rename(w.id, name);
      engine.select(w.id);
      onDone(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-create-panel>
      {hdWallets.length > 0 && (
        <Field label="Seed" hint={source === "new" ? "A brand-new 12-word phrase. Write it down: it is the wallet." : "Another account of a phrase you already hold — one backup, several wallets."}>
          <select className="input" value={source} onChange={(e) => setSource(e.target.value)} data-create-source>
            <option value="new">New recovery phrase</option>
            {hdWallets.map((w) => (
              <option key={w.id} value={w.id}>
                Next account of “{w.name}”
              </option>
            ))}
          </select>
        </Field>
      )}
      {source === "new" && (
        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="readout">Pick a first address ({list.length} candidates)</span>
            <div className="flex gap-1.5">
              <Btn className="h-7 px-2" onClick={() => setList((l) => [...l, ...engine.candidates(type, 10)])} data-more-candidates>
                <RefreshCw size={12} /> 10 more
              </Btn>
            </div>
          </div>
          <ul className="max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-edge" data-candidates>
            {list.map((c, i) => (
              <li key={c.address}>
                <button type="button" data-candidate={i} onClick={() => setPick(i)} className={cn("flex w-full items-center gap-2 border-b border-edge px-2.5 py-1.5 text-left font-mono text-[12px] last:border-b-0", pick === i ? "bg-accent-soft text-ink" : "text-muted hover:bg-raised/40")}>
                  <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", pick === i ? "bg-accent" : "bg-edge")} />
                  <span className="truncate">{c.address}</span>
                  <span className="ml-auto shrink-0 text-[10px] text-faint">fp {c.fingerprint}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Field label="Name" hint="Optional. Without one the wallet is named after its first address.">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder={list[pick] ? `Wallet ${list[pick].address.slice(0, 3)}…${list[pick].address.slice(-3)}` : "Wallet"} data-create-name />
      </Field>
      {error && <Note tone="error">{error}</Note>}
      <div className="flex justify-end">
        <Btn tone="primary" disabled={busy || (source === "new" && !list[pick])} onClick={create} data-create-confirm>
          Create wallet
        </Btn>
      </div>
    </div>
  );
}

function ImportPanel({ engine, type, onDone }: { engine: Engine; type: AddressType; onDone: (w: WalletRecord) => void }) {
  const [text, setText] = useState("");
  const [scan, setScan] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dup, setDup] = useState<WalletRecord | null>(null);
  const words = text.trim() ? mnemonicWords(text).length : 0;
  const valid = words > 0 && isValidMnemonic(normalizeMnemonic(text));

  const run = async () => {
    setBusy(true);
    setError(null);
    setDup(null);
    try {
      const r = await engine.importMnemonic(text, type, scan);
      if ("duplicate" in r) {
        setDup(r.duplicate);
        return;
      }
      engine.select(r.wallet.id);
      engine.setNote({ tone: "ok", text: r.usedAddresses ? `Imported “${r.wallet.name}” with ${r.usedAddresses} used address${r.usedAddresses === 1 ? "" : "es"} found.` : `Imported “${r.wallet.name}”. No history found on this network yet.` });
      setText("");
      onDone(r.wallet);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const next = async () => {
    if (!dup) return;
    setBusy(true);
    try {
      const w = await engine.createNextAccount(dup.id, type);
      engine.select(w.id);
      setText("");
      onDone(w);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3" data-import-panel>
      <Field
        label="Recovery phrase"
        right={<span className={cn("font-mono text-[11px]", !words ? "text-faint" : valid ? "text-positive" : "text-danger")} data-import-status>{!words ? "12 or 24 words" : valid ? `${words} words · valid` : `${words} words · invalid`}</span>}
        hint="Pasted text stays in this tab. The phrase is checked against the BIP39 word list and checksum."
      >
        <textarea className="input min-h-20 resize-y" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} autoComplete="off" placeholder="abandon ability able …" data-import-phrase />
      </Field>
      <label className="flex items-center gap-2 text-[12.5px] text-muted">
        <input type="checkbox" checked={scan} onChange={(e) => setScan(e.target.checked)} className="accent-[var(--accent)]" data-import-scan />
        Scan the chain for used addresses (gap limit 20) so old receive addresses and their coins show up
      </label>
      {dup && (
        <Note tone="warn" data-import-duplicate>
          This phrase is already in the list as “{dup.name}” ({ADDRESS_TYPES.find((t) => t.id === type)?.name}). Add its next account instead?
          <div className="mt-2 flex gap-2">
            <Btn tone="primary" className="h-7" onClick={next} disabled={busy} data-import-next-account>
              Add next account
            </Btn>
            <Btn className="h-7" onClick={() => setDup(null)}>
              Cancel
            </Btn>
          </div>
        </Note>
      )}
      {error && <Note tone="error">{error}</Note>}
      <div className="flex justify-end">
        <Btn tone="primary" disabled={!valid || busy} onClick={run} data-import-confirm>
          {busy ? (scan ? "Scanning…" : "Importing…") : "Import wallet"}
        </Btn>
      </div>
    </div>
  );
}

function WatchPanel({ engine, type, onDone }: { engine: Engine; type: AddressType; onDone: (w: WalletRecord) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-3" data-watch-panel>
      <Field label="Extended public key or address" hint="An account xpub/tpub (also zpub/vpub) gives a full read-only wallet with balances and history. A single address watches just that address. Nothing here can spend.">
        <input className="input" value={text} onChange={(e) => setText(e.target.value)} placeholder={engine.network === "mainnet" ? "xpub… or bc1q…" : "tpub… or tb1q…"} spellCheck={false} data-watch-input />
      </Field>
      {error && <Note tone="error">{error}</Note>}
      <div className="flex justify-end">
        <Btn
          tone="primary"
          disabled={!text.trim()}
          data-watch-confirm
          onClick={async () => {
            setError(null);
            try {
              const w = await engine.addWatch(text, type);
              engine.select(w.id);
              onDone(w);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Watch
        </Btn>
      </div>
    </div>
  );
}

function RestorePanel({ engine, onDone }: { engine: Engine; onDone: (w: WalletRecord | null) => void }) {
  const [text, setText] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const encrypted = /"kdf"|"salt"|"iv"/.test(text);
  return (
    <div className="space-y-3" data-restore-panel>
      <Field label="Backup file" hint="A JSON file exported from this tool's Backup tab. Wallets already in the list are skipped.">
        <div className="flex gap-2">
          <input
            type="file"
            accept="application/json,.json"
            className="input text-xs"
            data-restore-file
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (f) setText(await f.text());
            }}
          />
        </div>
        <textarea className="input mt-2 min-h-20 resize-y" value={text} onChange={(e) => setText(e.target.value)} placeholder="…or paste the file's contents" spellCheck={false} data-restore-text />
      </Field>
      {encrypted && (
        <Field label="Backup password">
          <input type="password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} data-restore-password />
        </Field>
      )}
      {error && <Note tone="error">{error}</Note>}
      <div className="flex justify-end">
        <Btn
          tone="primary"
          disabled={!text.trim() || busy}
          data-restore-confirm
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const n = await engine.importBackup(text, pw);
              engine.setNote({ tone: n ? "ok" : "warn", text: n ? `Restored ${n} wallet${n === 1 ? "" : "s"}.` : "Nothing new in that backup." });
              onDone(null);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Restore
        </Btn>
      </div>
    </div>
  );
}
