"use client";

/** Transactions: the wallet's history with filters and paging, and a detail view with inputs, outputs, raw hex and a fee bump for pending RBF sends. */
import { useEffect, useState } from "react";
import { ArrowDownLeft, ArrowUpRight, ExternalLink, RefreshCw, Repeat } from "lucide-react";
import { detailTx, shortAddress, shortTxid, type TxRow } from "@/lib/tools/crypto/btc/history";
import { ownAddresses, type WalletRecord } from "@/lib/tools/crypto/btc/store";
import { formatRate } from "@/lib/tools/crypto/btc/units";
import type { BuiltTx, SpendableUtxo } from "@/lib/tools/crypto/btc/tx";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/copy-button";
import type { Engine } from "./engine";
import { fiatOf } from "./engine";
import { Btn, Modal, Money, Note, Row, Seg, when } from "./ui";

type Filter = "all" | "sent" | "received" | "pending";

export function TransactionsPanel({ engine, wallet }: { engine: Engine; wallet: WalletRecord }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const live = engine.live[wallet.id];
  const rows = engine.rows(wallet.id);
  const unit = engine.state.prefs.unit;
  const fiat = engine.state.prefs.fiat;
  const price = fiatOf(engine.price, fiat);
  const filtered = rows.filter((r) => (filter === "all" ? true : filter === "pending" ? !r.confirmed : r.kind === filter || (filter === "sent" && r.kind === "self")));
  const PAGE = 25;
  const shown = filtered.slice(0, page * PAGE);
  const current = open ? live?.txs.find((t) => t.txid === open) : null;

  return (
    <div className="space-y-3" data-transactions-panel>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg name="tx-filter" value={filter} onChange={(f) => { setFilter(f); setPage(1); }} options={[{ id: "all", label: `All (${rows.length})` }, { id: "received", label: "Received" }, { id: "sent", label: "Sent" }, { id: "pending", label: `Pending (${rows.filter((r) => !r.confirmed).length})` }]} />
        <div className="flex items-center gap-2 text-[11px] text-faint">
          {live?.at ? `updated ${new Date(live.at).toLocaleTimeString("en-GB")}` : ""}
          <Btn className="h-7 px-2" onClick={() => void engine.refresh(wallet.id)} disabled={live?.loading} data-refresh-txs>
            <RefreshCw size={12} className={live?.loading ? "animate-spin" : ""} /> Refresh
          </Btn>
        </div>
      </div>
      {live?.error && <Note tone="error">{live.error}</Note>}
      {!rows.length && !live?.loading && <Note data-txs-empty>No transactions on this network for this wallet yet.</Note>}
      {rows.length > 0 && (
        <ul className="divide-y divide-edge rounded-[var(--radius)] border border-edge" data-tx-list>
          {shown.map((r) => (
            <li key={r.txid}>
              <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-raised/40" onClick={() => setOpen(r.txid)} data-tx={r.txid} data-tx-kind={r.kind}>
                <span className={cn("inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full", r.kind === "received" ? "bg-positive/10 text-positive" : r.kind === "self" ? "bg-raised text-muted" : "bg-danger/10 text-danger")}>
                  {r.kind === "received" ? <ArrowDownLeft size={14} /> : r.kind === "self" ? <Repeat size={13} /> : <ArrowUpRight size={14} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-[12.5px] text-ink">
                    {r.kind === "received" ? "Received" : r.kind === "self" ? "Moved within wallet" : "Sent"}
                    {r.counterparties[0] && <span className="truncate font-mono text-[11px] text-faint">{r.kind === "received" ? "from" : "to"} {shortAddress(r.counterparties[0])}{r.counterparties.length > 1 ? ` +${r.counterparties.length - 1}` : ""}</span>}
                  </span>
                  <span className="flex items-center gap-2 text-[11px] text-faint">
                    <span>{when(r.time)}</span>
                    <span className={cn("rounded px-1 font-mono", r.confirmed ? (r.confirmations >= 6 ? "bg-positive/10 text-positive" : "bg-warn/10 text-warn") : "bg-warn/10 text-warn")} data-confirmations={r.confirmations}>
                      {r.confirmed ? `${r.confirmations} conf` : "pending"}
                    </span>
                    {r.rbf && !r.confirmed && <span className="font-mono">RBF</span>}
                  </span>
                </span>
                <Money sats={r.net} unit={unit} fiat={fiat} price={price} sign className={cn("shrink-0 text-right", r.net > 0n ? "[&>span:first-child]:text-positive" : "")} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(shown.length < filtered.length || live?.more) && (
        <div className="flex justify-center">
          <Btn
            onClick={() => {
              if (shown.length < filtered.length) setPage((p) => p + 1);
              else void engine.loadMore(wallet.id);
            }}
            data-tx-more
          >
            Load more
          </Btn>
        </div>
      )}
      {current && <TxDetailModal engine={engine} wallet={wallet} tx={current} onClose={() => setOpen(null)} />}
    </div>
  );
}

function TxDetailModal({ engine, wallet, tx, onClose }: { engine: Engine; wallet: WalletRecord; tx: NonNullable<ReturnType<Engine["live"][string]["txs"]["find"]>>; onClose: () => void }) {
  const live = engine.live[wallet.id];
  const d = detailTx(tx, new Set(ownAddresses(wallet)), live?.tip ?? 0);
  const unit = engine.state.prefs.unit;
  const fiat = engine.state.prefs.fiat;
  const price = fiatOf(engine.price, fiat);
  const [hex, setHex] = useState<string | null>(null);
  const [showHex, setShowHex] = useState(false);
  const [bump, setBump] = useState<{ built: BuiltTx; utxos: SpendableUtxo[]; to: string; feeRate: number; previousFee: bigint } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!showHex || hex) return;
    let active = true;
    engine.api.txHex(tx.txid).then((h) => active && setHex(h)).catch((e) => active && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      active = false;
    };
  }, [showHex, hex, engine.api, tx.txid]);
  const canBump = !d.confirmed && d.rbf && d.kind !== "received" && wallet.kind === "hd" && engine.hasSecrets(wallet.id);

  return (
    <Modal title={<span className="font-mono text-[13px]">{shortTxid(tx.txid)}</span>} onClose={onClose} wide testId="tx-detail">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Row k="Effect on wallet" v={<Money sats={d.net} unit={unit} fiat={fiat} price={price} sign />} mono={false} />
          <Row k={d.kind === "received" ? "Received" : "Sent to others"} v={<Money sats={d.amount} unit={unit} fiat={fiat} price={price} />} mono={false} />
          <Row k="Fee" v={`${d.fee.toString()} sats · ${formatRate(d.feeRate)}`} />
          <Row k="Status" v={d.confirmed ? `${d.confirmations} confirmation${d.confirmations === 1 ? "" : "s"} · block ${d.height}` : "pending in mempool"} />
          <Row k="Time" v={when(d.time)} />
          <Row k="Size" v={`${d.vsize} vB · ${d.size} B · weight ${d.weight}`} />
          <Row k="Version · locktime" v={`${d.version} · ${d.locktime}`} />
          <Row k="Replace-by-fee" v={d.rbf ? "signalled" : "no"} />
          <Row
            k="Txid"
            v={
              <span className="inline-flex items-center gap-1.5">
                <span className="break-all text-[11px]">{tx.txid}</span>
                <CopyButton value={tx.txid} label="" className="h-6 px-1.5" />
                <a href={`${engine.explorer}/tx/${tx.txid}`} target="_blank" rel="noopener noreferrer" className="text-muted hover:text-accent" aria-label="Open in explorer">
                  <ExternalLink size={12} />
                </a>
              </span>
            }
          />
        </div>
        <div className="space-y-3 text-[12px]">
          <div>
            <div className="readout mb-1">Inputs ({d.inputs.length})</div>
            <ul className="divide-y divide-edge rounded-[var(--radius-sm)] border border-edge">
              {d.inputs.map((i, n) => (
                <li key={n} className={cn("flex items-center justify-between gap-2 px-2 py-1 font-mono text-[11px]", i.mine && "bg-accent-soft/40")}>
                  <span className="truncate">{i.address ? shortAddress(i.address) : "coinbase"}{i.mine && <span className="ml-1 text-accent">(mine)</span>}</span>
                  <span className="shrink-0">{i.value.toString()} sats</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="readout mb-1">Outputs ({d.outputs.length})</div>
            <ul className="divide-y divide-edge rounded-[var(--radius-sm)] border border-edge">
              {d.outputs.map((o, n) => (
                <li key={n} className={cn("flex items-center justify-between gap-2 px-2 py-1 font-mono text-[11px]", o.mine && "bg-accent-soft/40")}>
                  <span className="truncate">{o.address ? shortAddress(o.address) : o.type ?? "script"}{o.mine && <span className="ml-1 text-accent">(mine)</span>}</span>
                  <span className="shrink-0">{o.value.toString()} sats</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Btn onClick={() => setShowHex((s) => !s)} data-tx-hex-toggle>
          {showHex ? "Hide raw hex" : "Raw hex"}
        </Btn>
        {canBump && (
          <Btn
            tone="warn"
            disabled={busy}
            data-bump-fee
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                setBump(await engine.prepareBump(wallet.id, tx.txid));
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Bump fee
          </Btn>
        )}
      </div>
      {showHex && <textarea readOnly className="input mt-2 min-h-24 text-[10.5px]" value={hex ?? "loading…"} data-tx-hex />}
      {bump && (
        <div className="mt-3 rounded-[var(--radius)] border border-warn/50 bg-warn/[0.05] p-3" data-bump-review>
          <div className="readout mb-1">Replace with a higher fee</div>
          <Row k="New fee rate" v={formatRate(bump.feeRate)} />
          <Row k="New fee" v={`${bump.built.fee.toString()} sats (was ${bump.previousFee.toString()})`} />
          <Row k="Same recipient" v={shortAddress(bump.to)} />
          <Row k="Amount" v={<Money sats={bump.built.amount} unit={unit} fiat={fiat} price={price} />} mono={false} />
          <div className="mt-2 flex justify-end gap-2">
            <Btn onClick={() => setBump(null)}>Cancel</Btn>
            <Btn
              tone="primary"
              disabled={busy}
              data-bump-confirm
              onClick={async () => {
                setBusy(true);
                try {
                  const txid = await engine.broadcast(wallet.id, bump.built, bump.utxos);
                  engine.setNote({ tone: "ok", text: `Replacement ${shortTxid(txid)} broadcast.` });
                  onClose();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              Sign & broadcast replacement
            </Btn>
          </div>
        </div>
      )}
      {error && <Note tone="error" className="mt-2">{error}</Note>}
    </Modal>
  );
}

export type { TxRow };
