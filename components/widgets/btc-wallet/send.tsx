"use client";

/** Send: recipient, amount or sweep, a fee from live estimates or a custom rate, replace-by-fee, coin control, a review step, then broadcast. */
import { useEffect, useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { DUST, isValidAddress, addressTypeOf } from "@/lib/tools/crypto/btc/keys";
import type { WalletRecord } from "@/lib/tools/crypto/btc/store";
import { formatRate, parseAmount } from "@/lib/tools/crypto/btc/units";
import type { BuiltTx, SpendableUtxo } from "@/lib/tools/crypto/btc/tx";
import { estimateVsize } from "@/lib/tools/crypto/btc/tx";
import { shortTxid } from "@/lib/tools/crypto/btc/history";
import { cn } from "@/lib/utils";
import type { Engine } from "./engine";
import { fiatOf } from "./engine";
import { Btn, Field, Money, Note, Row, Seg } from "./ui";

type Tier = "slow" | "standard" | "fast" | "custom";

export function SendPanel({ engine, wallet }: { engine: Engine; wallet: WalletRecord }) {
  const [to, setTo] = useState("");
  const [amountText, setAmountText] = useState("");
  const [sweep, setSweep] = useState(false);
  const [tier, setTier] = useState<Tier>("standard");
  const [custom, setCustom] = useState("");
  const [rbf, setRbf] = useState(true);
  const [coinControl, setCoinControl] = useState(false);
  const [only, setOnly] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<{ built: BuiltTx; utxos: SpendableUtxo[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  const unit = engine.state.prefs.unit;
  const fiat = engine.state.prefs.fiat;
  const price = fiatOf(engine.price, fiat);
  const live = engine.live[wallet.id];
  const bal = engine.balance(wallet.id);
  const tiers = engine.tiers;
  const feeRate = tier === "custom" ? Number(custom) || 0 : tiers ? tiers[tier] : tier === "slow" ? 2 : tier === "fast" ? 10 : 4;
  const amount = parseAmount(amountText, unit);
  const toType = to.trim() ? addressTypeOf(to.trim(), engine.network) : null;
  const toValid = to.trim() ? isValidAddress(to.trim(), engine.network) : false;
  const canSpend = wallet.kind === "hd" && engine.hasSecrets(wallet.id);
  const dust = toType && toType !== "other" ? DUST[toType] : 546n;

  // A rough fee preview before building: inputs guessed from the selected coins or one input.
  const preview = useMemo(() => {
    const n = coinControl && only.size ? only.size : Math.max(1, Math.min(3, live?.utxos.length ?? 1));
    const vsize = estimateVsize(Array(n).fill(wallet.type), [toType ?? "other", wallet.type]);
    return { vsize, fee: BigInt(Math.ceil(vsize * feeRate)) };
  }, [coinControl, only, live, wallet.type, toType, feeRate]);

  useEffect(() => {
    // Any edit invalidates a reviewed transaction.
    queueMicrotask(() => setReview(null));
  }, [to, amountText, sweep, tier, custom, rbf, coinControl, only]);

  const problems: string[] = [];
  if (to.trim() && !toValid) problems.push(`Not a valid ${engine.network} address.`);
  if (!sweep && amountText && amount === null) problems.push("Amount is not a number.");
  if (!sweep && amount !== null && amount > 0n && amount < dust) problems.push(`Below the dust limit (${dust} sats) for that address type.`);
  if (!sweep && amount !== null && bal && amount > bal.total) problems.push("Insufficient funds.");
  if (tier === "custom" && !(Number(custom) >= 1)) problems.push("Custom fee rate must be at least 1 sat/vB.");
  const ready = canSpend && toValid && (sweep || (amount !== null && amount > 0n)) && problems.length === 0;

  const build = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await engine.prepareSend(wallet.id, { to: to.trim(), amount: amount ?? 0n, feeRate, rbf, sweep, only: coinControl && only.size ? [...only] : undefined });
      setReview(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!review) return;
    setBusy(true);
    setError(null);
    try {
      const txid = await engine.broadcast(wallet.id, review.built, review.utxos);
      setSent(txid);
      setReview(null);
      setTo("");
      setAmountText("");
      setSweep(false);
      setOnly(new Set());
      engine.setNote({ tone: "ok", text: `Broadcast ${shortTxid(txid)}. It appears under Transactions as pending.` });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (wallet.kind === "watch") return <Note data-send-watch-only>This is a watch-only wallet: it can see coins, not spend them. Import the recovery phrase to send.</Note>;
  if (!canSpend) return <Note tone="warn">Unlock the vault to send from this wallet.</Note>;

  return (
    <div className="space-y-3" data-send-panel>
      {sent && (
        <Note tone="ok" data-send-result>
          Sent. Transaction{" "}
          <a href={`${engine.explorer}/tx/${sent}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono underline">
            {shortTxid(sent)} <ExternalLink size={11} />
          </a>
        </Note>
      )}
      <Field label="Recipient" right={toType && toType !== "other" && toValid ? <span className="font-mono text-[11px] text-faint">{toType}</span> : null}>
        <input className={cn("input", to.trim() && !toValid && "border-danger")} value={to} onChange={(e) => setTo(e.target.value)} placeholder={engine.network === "mainnet" ? "bc1q…" : "tb1q…"} spellCheck={false} data-send-to />
      </Field>
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field
          label="Amount"
          right={
            <span className="flex items-center gap-2">
              <Seg size="xs" name="send-unit" value={unit} onChange={(u) => engine.setPrefs({ unit: u })} options={[{ id: "btc", label: "BTC" }, { id: "sats", label: "sats" }]} />
              <button type="button" className={cn("font-mono text-[11px]", sweep ? "text-accent" : "text-muted hover:text-ink")} onClick={() => setSweep((s) => !s)} data-send-max>
                {sweep ? "sending everything" : "max"}
              </button>
            </span>
          }
        >
          <input className="input" inputMode="decimal" value={sweep ? "" : amountText} disabled={sweep} onChange={(e) => setAmountText(e.target.value)} placeholder={sweep ? "whole balance minus fee" : unit === "btc" ? "0.001" : "100000"} data-send-amount />
        </Field>
        <div className="text-[11.5px] text-faint sm:pt-6">
          Available
          <br />
          {bal ? <Money sats={bal.confirmed} unit={unit} fiat={fiat} price={price} size="sm" /> : "—"}
          {bal && bal.pending > 0n && <div className="text-warn">+{bal.pending.toString()} sats pending</div>}
        </div>
      </div>
      <Field label="Fee" hint={tiers ? `Live estimates from ${engine.state.prefs.provider}: slow ≈ ${tiers.targets.slow} blocks, standard ≈ ${tiers.targets.standard}, fast next block.` : "Fee estimates are not loaded yet; defaults shown."}>
        <div className="flex flex-wrap items-center gap-2">
          <Seg
            name="fee-tier"
            value={tier}
            onChange={setTier}
            options={[
              { id: "slow", label: `Slow · ${tiers ? formatRate(tiers.slow) : "2 sat/vB"}` },
              { id: "standard", label: `Standard · ${tiers ? formatRate(tiers.standard) : "4 sat/vB"}` },
              { id: "fast", label: `Fast · ${tiers ? formatRate(tiers.fast) : "10 sat/vB"}` },
              { id: "custom", label: "Custom" },
            ]}
          />
          {tier === "custom" && <input className="input h-8 w-28" inputMode="decimal" value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="sat/vB" data-send-custom-rate />}
          <span className="font-mono text-[11px] text-faint">
            ≈ {preview.vsize} vB · ≈ {preview.fee.toString()} sats
          </span>
        </div>
      </Field>
      <div className="flex flex-wrap items-center gap-4 text-[12.5px] text-muted">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={rbf} onChange={(e) => setRbf(e.target.checked)} className="accent-[var(--accent)]" data-send-rbf /> Replace-by-fee (lets you bump the fee later)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={coinControl} onChange={(e) => setCoinControl(e.target.checked)} className="accent-[var(--accent)]" data-send-coin-control /> Choose coins
        </label>
      </div>
      {coinControl && (
        <ul className="max-h-48 overflow-y-auto rounded-[var(--radius-sm)] border border-edge" data-coins>
          {(live?.utxos ?? []).map((u) => {
            const key = `${u.txid}:${u.vout}`;
            const on = only.has(key);
            return (
              <li key={key} className="border-b border-edge last:border-b-0">
                <label className="flex items-center gap-2 px-2.5 py-1.5 font-mono text-[11.5px]">
                  <input type="checkbox" checked={on} className="accent-[var(--accent)]" data-coin={key} onChange={() => setOnly((s) => { const n = new Set(s); if (on) n.delete(key); else n.add(key); return n; })} />
                  <span className="text-ink">{u.value.toLocaleString("en-US")} sats</span>
                  <span className="truncate text-faint">{u.address}</span>
                  <span className="ml-auto text-faint">{u.status.confirmed ? `#${u.status.block_height}` : "pending"}</span>
                </label>
              </li>
            );
          })}
          {!live?.utxos.length && <li className="px-2.5 py-2 text-[12px] text-faint">No coins.</li>}
        </ul>
      )}
      {problems.map((p) => (
        <Note key={p} tone="error" data-send-problem>
          {p}
        </Note>
      ))}
      {error && <Note tone="error" data-send-error>{error}</Note>}
      {review ? (
        <div className="rounded-[var(--radius)] border border-accent bg-accent-soft/40 p-3" data-send-review>
          <div className="readout mb-1">Review</div>
          <Row k="To" v={to.trim()} />
          <Row k="Amount" v={<Money sats={review.built.amount} unit={unit} fiat={fiat} price={price} />} mono={false} />
          <Row k="Fee" v={<span>{review.built.fee.toString()} sats · {formatRate(Number(review.built.fee) / review.built.vsize)} · {review.built.vsize} vB</span>} />
          <Row k="Total out" v={<Money sats={review.built.amount + review.built.fee} unit={unit} fiat={fiat} price={price} />} mono={false} />
          <Row k="Inputs" v={`${review.built.inputs.length} coin${review.built.inputs.length === 1 ? "" : "s"}`} />
          <Row k="Change" v={review.built.changed ? `${review.built.change.toString()} sats back to this wallet` : "none"} />
          <Row k="Replace-by-fee" v={rbf ? "on" : "off"} />
          <div className="mt-2 flex justify-end gap-2">
            <Btn onClick={() => setReview(null)}>Edit</Btn>
            <Btn tone="primary" onClick={send} disabled={busy} data-send-confirm>
              {busy ? "Broadcasting…" : "Sign & broadcast"}
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Btn tone="primary" onClick={build} disabled={!ready || busy} data-send-review-button>
            {busy ? "Building…" : "Review"}
          </Btn>
        </div>
      )}
    </div>
  );
}
