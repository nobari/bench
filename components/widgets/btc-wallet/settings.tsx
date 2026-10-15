"use client";

/** Settings: network, data source, polling, units, locking, and how the vault keeps secrets. */
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { PROVIDERS, type Provider } from "@/lib/tools/crypto/btc/chain";
import { NETWORK_LABELS, NETWORK_ORDER, type Network } from "@/lib/tools/crypto/btc/keys";
import { FIAT_CURRENCIES } from "@/lib/tools/crypto/btc/units";
import type { Engine } from "./engine";
import { Btn, Field, Note, Seg } from "./ui";
import { VaultSetup } from "./vault-screens";

export function SettingsPanel({ engine, onClose }: { engine: Engine; onClose: () => void }) {
  const p = engine.state.prefs;
  const [confirmNet, setConfirmNet] = useState<Network | null>(null);
  const [agree, setAgree] = useState(false);
  const [changingVault, setChangingVault] = useState(false);
  const [wipe, setWipe] = useState(false);
  return (
    <div className="space-y-4" data-settings>
      <Field label="Network" hint="Wallets are kept per network; switching shows another list, nothing is lost. Testnet4 is the current test network with working faucets, Signet the stable one, Testnet3 the legacy chain Bitcoin Core no longer ships.">
        <div className="flex flex-wrap items-center gap-2">
          <Seg name="network" value={engine.network} onChange={(n) => (n === engine.network ? null : n === "mainnet" ? setConfirmNet(n) : engine.setNetwork(n))} options={NETWORK_ORDER.map((n) => ({ id: n, label: NETWORK_LABELS[n] }))} />
          {engine.network === "mainnet" && <span className="text-[11.5px] text-warn">Real bitcoin.</span>}
        </div>
      </Field>
      {confirmNet === "mainnet" && (
        <Note tone="warn" data-mainnet-confirm>
          <div className="flex items-start gap-2">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              <div className="font-semibold">Switch to mainnet?</div>
              <p className="mt-1 text-[12px]">Mainnet wallets hold real money. This is a browser tool: keys live in this tab&apos;s storage, there is no hardware isolation, and nobody can reverse a mistake. Suitable for small amounts you can afford to lose, learning, and watch-only use.</p>
              <label className="mt-2 flex items-center gap-2 text-[12px]">
                <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="accent-[var(--accent)]" data-mainnet-agree /> I understand the risk.
              </label>
              <div className="mt-2 flex gap-2">
                <Btn tone="warn" className="h-7" disabled={!agree} data-mainnet-go onClick={() => { engine.setNetwork("mainnet"); setConfirmNet(null); setAgree(false); }}>
                  Switch to mainnet
                </Btn>
                <Btn className="h-7" onClick={() => setConfirmNet(null)}>
                  Stay on {NETWORK_LABELS[engine.network]}
                </Btn>
              </div>
            </div>
          </div>
        </Note>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Chain data" hint={`Public Esplora servers. Your addresses are sent to whichever you pick — that is how any light wallet works. Blockstream has no Testnet4 or Signet: those use mempool.space.${engine.providerName !== PROVIDERS[p.provider].name ? ` In use now: ${engine.providerName}.` : ""}`}>
          <select className="input" value={p.provider} onChange={(e) => engine.setPrefs({ provider: e.target.value as Provider })} data-provider>
            {Object.entries(PROVIDERS).map(([id, v]) => (
              <option key={id} value={id}>
                {v.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Refresh every" hint="While this tab is visible.">
          <select className="input" value={p.pollSeconds} onChange={(e) => engine.setPrefs({ pollSeconds: Number(e.target.value) })} data-poll>
            {[15, 20, 30, 60].map((s) => (
              <option key={s} value={s}>
                {s} s
              </option>
            ))}
          </select>
        </Field>
        <Field label="Unit">
          <Seg name="unit" value={p.unit} onChange={(u) => engine.setPrefs({ unit: u })} options={[{ id: "btc", label: "BTC" }, { id: "sats", label: "sats" }]} />
        </Field>
        <Field label="Fiat estimate" hint="Spot price from CoinGecko, refreshed every five minutes. An indication, not a quote.">
          <select className="input" value={p.fiat} onChange={(e) => engine.setPrefs({ fiat: e.target.value as typeof p.fiat })} data-fiat>
            <option value="none">Off</option>
            {FIAT_CURRENCIES.map((f) => (
              <option key={f} value={f}>
                {f.toUpperCase()}
              </option>
            ))}
          </select>
        </Field>
        {engine.mode === "password" && (
          <>
            <Field label="Lock after">
              <select className="input" value={p.lockMinutes} onChange={(e) => engine.setPrefs({ lockMinutes: Number(e.target.value) })} data-lock-minutes>
                {[1, 5, 15, 30, 60, 0].map((m) => (
                  <option key={m} value={m}>
                    {m === 0 ? "Never" : `${m} min idle`}
                  </option>
                ))}
              </select>
            </Field>
            <label className="flex items-center gap-2 pt-5 text-[12.5px] text-muted">
              <input type="checkbox" checked={p.lockOnHide} onChange={(e) => engine.setPrefs({ lockOnHide: e.target.checked })} className="accent-[var(--accent)]" data-lock-on-hide /> Lock when the tab is hidden
            </label>
          </>
        )}
      </div>
      <section>
        <div className="readout mb-1">Vault</div>
        {changingVault ? (
          <VaultSetup
            changing
            onCancel={() => setChangingVault(false)}
            onChoose={async (m, pw) => {
              await engine.changeVault(m, pw);
              setChangingVault(false);
            }}
          />
        ) : (
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
            {engine.mode === "password" ? "Password vault (encrypted in this browser)." : engine.mode === "plain" ? "Remembered without a password." : "This tab only — nothing stored."}
            <Btn className="h-7" onClick={() => setChangingVault(true)} disabled={engine.locked} data-change-vault>
              Change
            </Btn>
          </div>
        )}
      </section>
      <section className="border-t border-edge pt-3">
        {wipe ? (
          <Note tone="error">
            Remove all {engine.wallets.length} {engine.network} wallet{engine.wallets.length === 1 ? "" : "s"} from this browser? Phrases you did not write down are gone for good.
            <div className="mt-2 flex gap-2">
              <Btn tone="danger" className="h-7" data-wipe-confirm onClick={() => { for (const w of engine.wallets) engine.remove(w.id); setWipe(false); onClose(); }}>
                Remove them
              </Btn>
              <Btn className="h-7" onClick={() => setWipe(false)}>
                Keep
              </Btn>
            </div>
          </Note>
        ) : (
          <Btn tone="danger" className="h-7" onClick={() => setWipe(true)} disabled={!engine.wallets.length} data-wipe>
            Remove all {engine.network} wallets
          </Btn>
        )}
      </section>
    </div>
  );
}
