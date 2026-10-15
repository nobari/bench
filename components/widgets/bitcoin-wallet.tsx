"use client";

/**
 * Bitcoin Wallet Manager: HD wallets (BIP39 · BIP44/84/86) kept in this browser, live balances and history
 * from a public Esplora server, sending with live fee estimates and replace-by-fee, watch-only wallets,
 * an encrypted vault and backups. Testnet by default.
 */
import { useEffect, useState } from "react";
import { Bitcoin, Droplets, Lock, RefreshCw, Settings, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { NETWORK_LABELS, NETWORK_ORDER, addressTypeInfo, isTestNetwork } from "@/lib/tools/crypto/btc/keys";
import { STORAGE_KEY } from "@/lib/tools/crypto/btc/store";
import { formatRate } from "@/lib/tools/crypto/btc/units";
import { useWalletEngine, fiatOf, type Engine } from "./btc-wallet/engine";
import { Btn, Modal, Money, Note, Seg } from "./btc-wallet/ui";
import { UnlockScreen, VaultSetup } from "./btc-wallet/vault-screens";
import { WalletList } from "./btc-wallet/wallet-list";
import { AddWallet } from "./btc-wallet/add-wallet";
import { ReceivePanel } from "./btc-wallet/receive";
import { SendPanel } from "./btc-wallet/send";
import { TransactionsPanel } from "./btc-wallet/transactions";
import { AddressesPanel } from "./btc-wallet/addresses";
import { BackupPanel } from "./btc-wallet/backup";
import { SettingsPanel } from "./btc-wallet/settings";

type Tab = "receive" | "send" | "transactions" | "addresses" | "backup";
const TABS: { id: Tab; label: string }[] = [
  { id: "receive", label: "Receive" },
  { id: "send", label: "Send" },
  { id: "transactions", label: "Transactions" },
  { id: "addresses", label: "Addresses" },
  { id: "backup", label: "Backup" },
];

declare global {
  interface Window {
    __benchBtc?: Engine;
  }
}

export function BitcoinWalletWidget() {
  const engine = useWalletEngine({ onEngine: (e) => (window.__benchBtc = e) });
  const [tab, setTab] = useState<Tab>("receive");
  const [adding, setAdding] = useState(false);
  const [settings, setSettings] = useState(false);
  const w = engine.selected;
  const price = fiatOf(engine.price, engine.state.prefs.fiat);
  const { note, setNote } = engine;

  // Notes fade out on their own.
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note, setNote]);

  if (!engine.ready) return <div className="panel h-64 animate-pulse" />;

  return (
    <div className="space-y-3" data-btc-wallet data-network={engine.network}>
      <div className={cn("flex items-start gap-2.5 rounded-[var(--radius)] border p-3", engine.network === "mainnet" ? "border-danger/40 bg-danger/[0.06]" : "border-warn/40 bg-warn/[0.06]")}>
        <ShieldAlert size={16} className={cn("mt-0.5 shrink-0", engine.network === "mainnet" ? "text-danger" : "text-warn")} />
        <p className="text-[13px] leading-relaxed text-muted">
          {engine.network === "mainnet" ? (
            <>
              <span className="font-semibold text-danger">Mainnet — real bitcoin.</span> Keys are generated and kept in this browser and never sent anywhere, but a web page is not a hardware wallet. Keep amounts small and your recovery phrases on paper.
            </>
          ) : engine.network === "testnet" ? (
            <>
              <span className="font-semibold text-warn">Testnet3 — legacy.</span> Bitcoin Core dropped it in v30 and its faucets are drying up; start new experiments on Testnet4. Keys stay in this browser; only addresses go to the chain server you pick.
            </>
          ) : (
            <>
              <span className="font-semibold text-warn">{NETWORK_LABELS[engine.network]}.</span> Coins here are worthless test coins from a faucet (Receive tab), so try everything. Keys are generated and kept in this browser; your addresses go to the chain server you pick, nothing else leaves the page.
            </>
          )}
        </p>
      </div>

      {engine.mode === null ? (
        <VaultSetup onChoose={engine.setupVault} />
      ) : engine.locked ? (
        <UnlockScreen
          onUnlock={engine.unlock}
          walletCount={engine.wallets.length}
          onForget={() => {
            try {
              localStorage.removeItem(STORAGE_KEY);
            } catch {
              /* ignore */
            }
            location.reload();
          }}
        />
      ) : (
        <>
          <div className="panel flex flex-wrap items-center gap-2 p-2" data-toolbar>
            <span className="inline-flex items-center gap-1.5 px-1 text-sm font-semibold text-ink">
              <Bitcoin size={15} className="text-accent" /> Bitcoin wallet
            </span>
            <Seg size="xs" name="network-quick" value={engine.network} onChange={(n) => (n === "mainnet" ? setSettings(true) : engine.setNetwork(n))} options={NETWORK_ORDER.map((n) => ({ id: n, label: NETWORK_LABELS[n] }))} />
            {isTestNetwork(engine.network) && w && (
              <Btn
                className="h-7 px-2"
                data-faucets-button
                onClick={() => {
                  setTab("receive");
                  requestAnimationFrame(() => document.querySelector("[data-faucets]")?.scrollIntoView({ behavior: "smooth", block: "center" }));
                }}
              >
                <Droplets size={12} /> Test coins
              </Btn>
            )}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {engine.tiers && (
                <span className="hidden font-mono text-[11px] text-faint md:inline" title="Fee estimates: slow / standard / fast">
                  fees {formatRate(engine.tiers.slow).replace(" sat/vB", "")}/{formatRate(engine.tiers.standard).replace(" sat/vB", "")}/{formatRate(engine.tiers.fast)}
                </span>
              )}
              {price !== null && engine.state.prefs.fiat !== "none" && engine.price && (
                <span className="hidden font-mono text-[11px] text-faint sm:inline" title={`CoinGecko · ${new Date(engine.price.at).toLocaleTimeString("en-GB")} · indicative only`} data-price>
                  1 BTC ≈ {new Intl.NumberFormat("en-US", { style: "currency", currency: engine.state.prefs.fiat.toUpperCase(), maximumFractionDigits: 0 }).format(price)}
                </span>
              )}
              <Seg size="xs" name="unit-quick" value={engine.state.prefs.unit} onChange={(u) => engine.setPrefs({ unit: u })} options={[{ id: "btc", label: "BTC" }, { id: "sats", label: "sats" }]} />
              <Btn className="h-7 px-2" onClick={() => void engine.refresh()} aria-label="Refresh" data-refresh>
                <RefreshCw size={12} className={Object.values(engine.live).some((l) => l.loading) ? "animate-spin" : ""} />
              </Btn>
              {engine.mode === "password" && (
                <Btn className="h-7 px-2" onClick={engine.lock} aria-label="Lock vault" data-lock>
                  <Lock size={12} />
                </Btn>
              )}
              <Btn className="h-7 px-2" onClick={() => setSettings(true)} aria-label="Settings" data-settings-button>
                <Settings size={12} />
              </Btn>
            </div>
          </div>

          {engine.note && (
            <Note tone={engine.note.tone === "ok" ? "ok" : engine.note.tone === "warn" ? "warn" : "error"} data-note>
              {engine.note.text}
            </Note>
          )}

          <div className="grid gap-3 lg:grid-cols-[260px_1fr]">
            <WalletList engine={engine} onAdd={() => setAdding(true)} />
            <section className="panel min-w-0" data-wallet-panel>
              {!w ? (
                <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
                  <Bitcoin size={28} className="text-faint" />
                  <p className="max-w-sm text-[13px] text-muted">
                    No wallet selected. Create one from a fresh recovery phrase, import a phrase you already have, or watch an address or account key.
                    {isTestNetwork(engine.network) && " Then fill it from a faucet on the Receive tab — free test coins."}
                  </p>
                  <Btn tone="primary" onClick={() => setAdding(true)} data-add-wallet-cta>
                    Add a wallet
                  </Btn>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-end justify-between gap-3 border-b border-edge px-4 py-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="truncate text-[15px] font-semibold text-ink" data-wallet-name>{w.name}</h3>
                        <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">{addressTypeInfo(w.type).name}</span>
                        {w.kind === "watch" && <span className="rounded bg-raised px-1.5 py-0.5 font-mono text-[10.5px] text-muted">watch-only</span>}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-faint">{w.path || w.address}</div>
                    </div>
                    <div className="text-right" data-balance>
                      {(() => {
                        const b = engine.balance(w.id);
                        return b ? (
                          <>
                            <Money sats={b.total} unit={engine.state.prefs.unit} fiat={engine.state.prefs.fiat} price={price} size="lg" />
                            {b.pending > 0n && <div className="text-[11px] text-warn">{b.pending.toString()} sats pending</div>}
                          </>
                        ) : (
                          <span className="font-mono text-sm text-faint">{engine.live[w.id]?.error ? "unavailable" : "loading…"}</span>
                        );
                      })()}
                    </div>
                  </div>
                  <div className="flex gap-1 overflow-x-auto border-b border-edge px-2" role="tablist">
                    {TABS.map((t) => (
                      <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} data-tab={t.id} onClick={() => setTab(t.id)} className={cn("whitespace-nowrap border-b-2 px-3 py-2 font-mono text-xs transition-colors", tab === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")}>
                        {t.label}
                      </button>
                    ))}
                  </div>
                  <div className="p-4">
                    {tab === "receive" && <ReceivePanel key={w.id} engine={engine} wallet={w} />}
                    {tab === "send" && <SendPanel key={w.id} engine={engine} wallet={w} />}
                    {tab === "transactions" && <TransactionsPanel key={w.id} engine={engine} wallet={w} />}
                    {tab === "addresses" && <AddressesPanel key={w.id} engine={engine} wallet={w} />}
                    {tab === "backup" && <BackupPanel key={w.id} engine={engine} wallet={w} />}
                  </div>
                </>
              )}
            </section>
          </div>
        </>
      )}

      {adding && (
        <Modal title="Add a wallet" onClose={() => setAdding(false)} wide testId="add-wallet">
          <AddWallet engine={engine} onDone={() => setAdding(false)} />
        </Modal>
      )}
      {settings && (
        <Modal title="Settings" onClose={() => setSettings(false)} testId="settings">
          <SettingsPanel engine={engine} onClose={() => setSettings(false)} />
        </Modal>
      )}
    </div>
  );
}
