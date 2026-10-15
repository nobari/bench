"use client";

/** The wallets of the current network: pick one, rename inline, remove with a confirm. */
import { useState } from "react";
import { Check, Eye, Pencil, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { addressTypeInfo } from "@/lib/tools/crypto/btc/keys";
import type { WalletRecord } from "@/lib/tools/crypto/btc/store";
import type { Engine } from "./engine";
import { Btn, Money } from "./ui";
import { fiatOf } from "./engine";

export function WalletList({ engine, onAdd }: { engine: Engine; onAdd: () => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  const price = fiatOf(engine.price, engine.state.prefs.fiat);

  const commit = (w: WalletRecord) => {
    engine.rename(w.id, draft);
    setEditing(null);
  };

  return (
    <aside className="panel flex flex-col" data-wallet-list>
      <div className="flex items-center justify-between border-b border-edge px-3 py-2">
        <span className="readout">
          Wallets · {engine.network === "mainnet" ? "Mainnet" : "Testnet"} ({engine.wallets.length})
        </span>
        <Btn tone="primary" className="h-7 px-2" onClick={onAdd} data-add-wallet>
          <Plus size={13} /> Add
        </Btn>
      </div>
      <ul className="max-h-[60vh] overflow-y-auto p-1.5">
        {engine.wallets.length === 0 && <li className="px-2 py-6 text-center text-[12px] text-faint">No wallets on this network yet.</li>}
        {engine.wallets.map((w) => {
          const selected = engine.selected?.id === w.id;
          const live = engine.live[w.id];
          const bal = engine.balance(w.id);
          return (
            <li key={w.id} className="mb-1 last:mb-0">
              <div
                className={cn("group relative rounded-[var(--radius-sm)] border px-2.5 py-2 transition-colors", selected ? "border-accent bg-accent-soft" : "border-transparent hover:border-edge hover:bg-raised/40")}
                data-wallet-item={w.id}
                data-selected={selected || undefined}
              >
                {editing === w.id ? (
                  <form
                    className="flex items-center gap-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      commit(w);
                    }}
                  >
                    <input className="input h-7 text-xs" value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus data-rename-input onKeyDown={(e) => e.key === "Escape" && setEditing(null)} />
                    <button type="submit" className="rounded p-1 text-positive" aria-label="Save name" data-rename-save>
                      <Check size={13} />
                    </button>
                    <button type="button" className="rounded p-1 text-muted" aria-label="Cancel" onClick={() => setEditing(null)}>
                      <X size={13} />
                    </button>
                  </form>
                ) : removing === w.id ? (
                  <div className="text-[12px]">
                    <div className="text-ink">Remove “{w.name}”?</div>
                    <div className="mt-0.5 text-[11px] text-muted">{w.kind === "hd" ? "Its phrase leaves this browser too. Keep a copy first." : "Watch-only; nothing to lose."}</div>
                    <div className="mt-1.5 flex gap-1.5">
                      <Btn tone="danger" className="h-6 px-2 text-[11px]" onClick={() => { engine.remove(w.id); setRemoving(null); }} data-remove-confirm>
                        Remove
                      </Btn>
                      <Btn className="h-6 px-2 text-[11px]" onClick={() => setRemoving(null)}>
                        Keep
                      </Btn>
                    </div>
                  </div>
                ) : (
                  <button type="button" className="block w-full text-left" onClick={() => engine.select(w.id)}>
                    <div className="flex items-center gap-1.5">
                      {w.kind === "watch" && <Eye size={11} className="shrink-0 text-faint" aria-label="Watch-only" />}
                      <span className="truncate text-[13px] font-medium text-ink">{w.name}</span>
                      {live?.badge && <span className="ml-auto inline-block h-2 w-2 shrink-0 rounded-full bg-positive" title="Balance changed" data-badge />}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-faint">
                      <span className="font-mono">
                        {addressTypeInfo(w.type).name}
                        {w.account ? ` · acct ${w.account}` : ""}
                      </span>
                      {bal ? <Money sats={bal.total} unit={engine.state.prefs.unit} fiat="none" price={price} size="sm" className="text-[11px]" /> : <span className="font-mono">{live?.loading ? "…" : "—"}</span>}
                    </div>
                  </button>
                )}
                {editing !== w.id && removing !== w.id && (
                  <div className="absolute right-1.5 top-1.5 hidden gap-0.5 group-hover:flex">
                    <button type="button" className="rounded bg-surface p-1 text-muted hover:text-ink" aria-label="Rename" onClick={() => { setDraft(w.name); setEditing(w.id); }} data-rename>
                      <Pencil size={11} />
                    </button>
                    <button type="button" className="rounded bg-surface p-1 text-muted hover:text-danger" aria-label="Remove" onClick={() => setRemoving(w.id)} data-remove>
                      <Trash2 size={11} />
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
