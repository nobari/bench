"use client";

/** Addresses: both HD chains with labels, usage and balances; more on demand; a private key behind a tap. */
import { useState } from "react";
import { ExternalLink, Eye, EyeOff } from "lucide-react";
import type { Chain } from "@/lib/tools/crypto/btc/keys";
import { privateKeyWif } from "@/lib/tools/crypto/btc/keys";
import type { AddressEntry, WalletRecord } from "@/lib/tools/crypto/btc/store";
import { shortAddress } from "@/lib/tools/crypto/btc/history";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import type { Engine } from "./engine";
import { Btn, Money, Note } from "./ui";

export function AddressesPanel({ engine, wallet }: { engine: Engine; wallet: WalletRecord }) {
  if (wallet.address) return <Note>A single watched address: {wallet.address}</Note>;
  return (
    <div className="space-y-4" data-addresses-panel>
      <ChainList engine={engine} wallet={wallet} chain={0} title="Receive chain (…/0/i)" entries={wallet.receive} />
      <ChainList engine={engine} wallet={wallet} chain={1} title="Change chain (…/1/i)" entries={wallet.change} />
      <p className="text-[11.5px] text-faint">Used addresses are grey; the first unused receive address is what the Receive tab shows. Reusing addresses is allowed, but hurts privacy.</p>
    </div>
  );
}

function ChainList({ engine, wallet, chain, title, entries }: { engine: Engine; wallet: WalletRecord; chain: Chain; title: string; entries: AddressEntry[] }) {
  const [editing, setEditing] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [revealed, setRevealed] = useState<number | null>(null);
  const live = engine.live[wallet.id];
  const unit = engine.state.prefs.unit;
  const balanceOf = (address: string) => (live?.utxos ?? []).filter((u) => u.address === address).reduce((a, u) => a + BigInt(u.value), 0n);
  const canReveal = wallet.kind === "hd" && engine.hasSecrets(wallet.id);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="readout">{title} · {entries.length}</span>
        <Btn className="h-7 px-2" onClick={() => engine.deriveMore(wallet.id, chain, 5)} data-derive-more={chain}>
          Derive 5 more
        </Btn>
      </div>
      <ul className="divide-y divide-edge rounded-[var(--radius)] border border-edge" data-chain={chain}>
        {entries.map((a) => {
          const bal = balanceOf(a.address);
          const key = revealed === a.index && canReveal ? engine.privateKeyFor(wallet.id, `${wallet.path}/${chain}/${a.index}`) : null;
          return (
            <li key={a.index} className={cn("px-3 py-1.5", a.used && "text-faint")} data-address-row={a.index} data-used={a.used || undefined}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="w-6 shrink-0 font-mono text-[11px] text-faint">{a.index}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={a.address}>
                  <span className="hidden sm:inline">{a.address}</span>
                  <span className="sm:hidden">{shortAddress(a.address)}</span>
                </span>
                {editing === a.index ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      engine.label(wallet.id, chain, a.index, draft);
                      setEditing(null);
                    }}
                  >
                    <input className="input h-6 w-32 text-[11px]" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus placeholder="label" data-label-input onBlur={() => { engine.label(wallet.id, chain, a.index, draft); setEditing(null); }} />
                  </form>
                ) : (
                  <button type="button" className={cn("rounded px-1.5 py-0.5 text-[11px]", a.label ? "bg-raised text-ink" : "text-faint hover:text-ink")} onClick={() => { setDraft(a.label ?? ""); setEditing(a.index); }} data-label>
                    {a.label ?? "+ label"}
                  </button>
                )}
                {bal > 0n && <Money sats={bal} unit={unit} fiat="none" price={null} size="sm" />}
                {a.used && bal === 0n && <span className="font-mono text-[10.5px] uppercase">used</span>}
                <span className="flex items-center gap-1">
                  <CopyButton value={a.address} label="" className="h-6 px-1.5" />
                  <a href={`${engine.explorer}/address/${a.address}`} target="_blank" rel="noopener noreferrer" className="p-1 text-muted hover:text-accent" aria-label="Open in explorer">
                    <ExternalLink size={12} />
                  </a>
                  {canReveal && (
                    <button type="button" className="p-1 text-muted hover:text-warn" aria-label={revealed === a.index ? "Hide private key" : "Show private key"} onClick={() => setRevealed((r) => (r === a.index ? null : a.index))} data-reveal-key>
                      {revealed === a.index ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                  )}
                </span>
              </div>
              {key && (
                <div className="mt-1 flex items-center gap-2 rounded-[var(--radius-sm)] border border-warn/40 bg-warn/[0.05] px-2 py-1 font-mono text-[11px]">
                  <span className="text-warn">WIF</span>
                  <span className="min-w-0 flex-1 break-all text-ink" data-wif>{privateKeyWif(key, engine.network)}</span>
                  <CopyButton value={privateKeyWif(key, engine.network)} label="" className="h-6 px-1.5" />
                </div>
              )}
            </li>
          );
        })}
        {!entries.length && <li className="px-3 py-2 text-[12px] text-faint">None derived.</li>}
      </ul>
    </div>
  );
}
