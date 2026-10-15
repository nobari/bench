"use client";

/** Receive: the next unused address as text and QR, an optional BIP21 amount and label, and a watch for the payment. */
import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { Copy, Droplets, ExternalLink, RefreshCw } from "lucide-react";
import { bip21, FAUCETS } from "@/lib/tools/crypto/btc/chain";
import { NETWORK_LABELS, isTestNetwork } from "@/lib/tools/crypto/btc/keys";
import { freshReceive, type AddressEntry, type WalletRecord } from "@/lib/tools/crypto/btc/store";
import { parseAmount } from "@/lib/tools/crypto/btc/units";
import { CopyButton } from "@/components/copy-button";
import type { Engine } from "./engine";
import { fiatOf } from "./engine";
import { Btn, Field, Money, Note, Seg } from "./ui";

export function ReceivePanel({ engine, wallet }: { engine: Engine; wallet: WalletRecord }) {
  // The shown address is pinned by index so a payment arriving does not swap it for the next unused one.
  const [idx, setIdx] = useState(() => freshReceive(wallet)?.index ?? 0);
  const [amountText, setAmountText] = useState("");
  const [label, setLabel] = useState("");
  const [qr, setQr] = useState<string | null>(null);
  const unit = engine.state.prefs.unit;
  const price = fiatOf(engine.price, engine.state.prefs.fiat);

  const entry = useMemo<AddressEntry | undefined>(
    () => (wallet.address ? { index: 0, address: wallet.address } : (wallet.receive.find((a) => a.index === idx) ?? wallet.receive[wallet.receive.length - 1])),
    [wallet, idx],
  );
  const another = () => {
    if (!entry) return;
    const next = wallet.receive.find((a) => !a.used && a.index > entry.index);
    if (next) setIdx(next.index);
    else {
      engine.deriveMore(wallet.id, 0, 5);
      setIdx((wallet.receive[wallet.receive.length - 1]?.index ?? -1) + 1);
    }
  };
  const amount = parseAmount(amountText, unit);
  const uri = useMemo(() => (entry ? bip21(entry.address, amount && amount > 0n ? amount : undefined, label.trim() || undefined) : ""), [entry, amount, label]);

  useEffect(() => {
    if (!uri) return;
    let active = true;
    QRCode.toDataURL(uri, { margin: 1, width: 220, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } })
      .then((d) => active && setQr(d))
      .catch(() => active && setQr(null));
    return () => {
      active = false;
    };
  }, [uri]);

  // Watch for a payment to the shown address.
  const live = engine.live[wallet.id];
  const incoming = useMemo(() => {
    if (!entry || !live) return null;
    const utxos = live.utxos.filter((u) => u.address === entry.address);
    if (!utxos.length) return null;
    const total = utxos.reduce((a, u) => a + BigInt(u.value), 0n);
    return { total, confirmed: utxos.every((u) => u.status.confirmed) };
  }, [entry, live]);

  if (!entry) return <Note>This watch-only wallet has no addresses to show.</Note>;

  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]" data-receive-panel>
      <div className="flex flex-col items-center gap-2">
        <div className="rounded-[var(--radius)] border border-edge bg-white p-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data URL drawn locally */}
          {qr ? <img src={qr} alt={`QR code for ${entry.address}`} width={220} height={220} className="block" data-receive-qr /> : <div className="h-[220px] w-[220px]" />}
        </div>
        <span className="text-[11px] text-faint">{amount && amount > 0n ? "Address with amount (BIP21)" : "Address"}</span>
      </div>
      <div className="space-y-3">
        <Field
          label={wallet.address ? "Watched address" : `Receive address · index ${entry.index}${entry.label ? ` · ${entry.label}` : ""}`}
          right={
            !wallet.address && (
              <button type="button" className="inline-flex items-center gap-1 font-mono text-[11px] text-muted hover:text-ink" data-next-address onClick={another}>
                <RefreshCw size={11} /> another address
              </button>
            )
          }
        >
          <div className="flex gap-2">
            <input className="input" readOnly value={entry.address} data-receive-address onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={entry.address} />
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Request amount (optional)" right={<Seg size="xs" name="receive-unit" value={unit} onChange={(u) => engine.setPrefs({ unit: u })} options={[{ id: "btc", label: "BTC" }, { id: "sats", label: "sats" }]} />}>
            <input className="input" inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} placeholder={unit === "btc" ? "0.001" : "100000"} data-receive-amount />
          </Field>
          <Field label="Label (optional)">
            <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Invoice 42" data-receive-label />
          </Field>
        </div>
        {amount && amount > 0n && (
          <div className="flex items-center gap-2 text-[12px] text-muted">
            Requesting <Money sats={amount} unit={unit} fiat={engine.state.prefs.fiat} price={price} />
          </div>
        )}
        <Field label="Payment link">
          <div className="flex gap-2">
            <input className="input text-[11px]" readOnly value={uri} data-receive-uri onFocus={(e) => e.currentTarget.select()} />
            <CopyButton value={uri} label="Copy link" />
          </div>
        </Field>
        {incoming ? (
          <Note tone="ok" data-payment-received>
            Payment received: <Money sats={incoming.total} unit={unit} fiat={engine.state.prefs.fiat} price={price} /> {incoming.confirmed ? "· confirmed" : "· waiting for confirmation"}
          </Note>
        ) : (
          <Note data-payment-waiting>
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" /> Watching this address — a payment shows here within {engine.state.prefs.pollSeconds} s of reaching the mempool.
          </Note>
        )}
        {isTestNetwork(engine.network) && <FaucetPanel engine={engine} address={entry.address} />}
      </div>
    </div>
  );
}

/** Free test coins: every faucet known for this network, with the address one tap away from its form. */
function FaucetPanel({ engine, address }: { engine: Engine; address: string }) {
  const [copied, setCopied] = useState<string | null>(null);
  const list = FAUCETS[engine.network];
  const go = async (url: string) => {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? null : c)), 2000);
    } catch {
      /* clipboard unavailable: the address is still on screen */
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <section className="rounded-[var(--radius)] border border-edge" data-faucets data-faucet-network={engine.network}>
      <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
        <Droplets size={14} className="text-accent" />
        <span className="readout">Get {NETWORK_LABELS[engine.network]} coins from a faucet</span>
      </div>
      <ul className="divide-y divide-edge">
        {list.map((f) => (
          <li key={f.url} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2" data-faucet={f.url}>
            <div className="min-w-0 flex-1">
              <a href={f.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[12.5px] font-medium text-ink underline-offset-2 hover:underline">
                {f.name} <ExternalLink size={11} className="text-faint" />
              </a>
              <div className="text-[11.5px] text-faint">{f.note}</div>
            </div>
            <Btn className="h-7 px-2" onClick={() => void go(f.url)} data-faucet-go={f.url}>
              <Copy size={11} /> {copied === f.url ? "Address copied" : "Copy address & open"}
            </Btn>
          </li>
        ))}
        {!list.length && <li className="px-3 py-2 text-[12px] text-faint">No faucet known for this network.</li>}
      </ul>
      <p className="border-t border-edge px-3 py-2 text-[11.5px] text-faint">
        Paste the address into the faucet&apos;s form. The payment shows up above within {engine.state.prefs.pollSeconds} s of reaching the mempool, then needs a confirmation before it can be spent. Faucets come and go; if one is empty, try the next.
      </p>
    </section>
  );
}
