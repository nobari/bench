"use client";

/**
 * The wallet's engine: state and preferences (persisted), the vault (password, plain or session-only), live
 * chain data per wallet with polling, and every action the panels call — creating and importing wallets,
 * deriving addresses, scanning, sending, bumping fees, backups. The panels render; this decides.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { addressAt, addressTypeInfo, addressTypeOf, deriveAccount, isValidAddress, isValidMnemonic, newMnemonic, normalizeMnemonic, privateKeyAt, publicAccount, scriptHex, seedFingerprint, type AddressType, type Chain, type Network } from "@/lib/tools/crypto/btc/keys";
import { Esplora, endpoints, fetchPrice, feeTiers, type EsploraTx, type FeeTiers, type Utxo } from "@/lib/tools/crypto/btc/chain";
import { buildTx, bumpFeeRate, signTx, type BuildRequest, type BuiltTx, type SpendableUtxo } from "@/lib/tools/crypto/btc/tx";
import { decryptJson, encryptJson, isEnvelope, type Envelope } from "@/lib/tools/crypto/btc/vault";
import { summarizeTx, type TxRow } from "@/lib/tools/crypto/btc/history";
import { GAP_LIMIT, STORAGE_KEY, autoName, emptyState, freshChange, newWalletId, ownAddresses, readState, type AddressEntry, type BackupFile, type Prefs, type Secrets, type VaultMode, type WalletRecord, type WalletState } from "@/lib/tools/crypto/btc/store";
import type { Fiat } from "@/lib/tools/crypto/btc/units";

interface Persisted {
  state: WalletState;
  mode: VaultMode;
  /** Password mode: the encrypted secrets. Plain mode: the secrets as they are. */
  vault: Envelope | { plain: Secrets } | null;
}

export interface Live {
  utxos: (Utxo & { address: string })[];
  txs: EsploraTx[];
  /** Esplora pages 25 confirmed txs at a time; the last txid continues the list. */
  more: boolean;
  tip: number;
  loading: boolean;
  error: string | null;
  at: number;
  /** Balance rose while the wallet was not selected. */
  badge?: boolean;
}

export interface Candidate {
  mnemonic: string;
  address: string;
  fingerprint: string;
}

export interface Engine {
  ready: boolean;
  state: WalletState;
  network: Network;
  wallets: WalletRecord[];
  selected: WalletRecord | null;
  live: Record<string, Live>;
  mode: VaultMode | null;
  locked: boolean;
  hasSecrets: (id: string) => boolean;
  tiers: FeeTiers | null;
  price: { at: number; prices: Record<string, number> } | null;
  explorer: string;
  /** Name of the server actually in use (the chosen one, or mempool.space when it lacks the network). */
  providerName: string;
  api: Esplora;
  // vault
  setupVault: (mode: VaultMode, password?: string) => Promise<void>;
  unlock: (password: string) => Promise<boolean>;
  lock: () => void;
  changeVault: (mode: VaultMode, password?: string) => Promise<void>;
  // wallets
  select: (id: string | null) => void;
  setNetwork: (n: Network) => void;
  setPrefs: (p: Partial<Prefs>) => void;
  candidates: (type: AddressType, count: number) => Candidate[];
  createFromMnemonic: (mnemonic: string, type: AddressType, name?: string) => Promise<WalletRecord>;
  createNextAccount: (fromWalletId: string, type: AddressType) => Promise<WalletRecord>;
  importMnemonic: (mnemonic: string, type: AddressType, scan: boolean) => Promise<{ wallet: WalletRecord; usedAddresses: number } | { duplicate: WalletRecord }>;
  addWatch: (input: string, type: AddressType) => Promise<WalletRecord>;
  rename: (id: string, name: string) => void;
  remove: (id: string) => void;
  label: (id: string, chain: Chain, index: number, label: string) => void;
  deriveMore: (id: string, chain: Chain, count?: number) => void;
  mnemonicOf: (id: string) => string | null;
  privateKeyFor: (id: string, path: string) => Uint8Array | null;
  exportBackup: () => Promise<string>;
  importBackup: (text: string, password: string) => Promise<number>;
  // chain
  refresh: (id?: string) => Promise<void>;
  loadMore: (id: string) => Promise<void>;
  spendable: (id: string) => Promise<SpendableUtxo[]>;
  prepareSend: (id: string, req: Omit<BuildRequest, "utxos" | "changeAddress" | "changeType" | "network">) => Promise<{ built: BuiltTx; utxos: SpendableUtxo[] }>;
  prepareBump: (id: string, txid: string) => Promise<{ built: BuiltTx; utxos: SpendableUtxo[]; to: string; feeRate: number; previousFee: bigint }>;
  broadcast: (id: string, built: BuiltTx, utxos: SpendableUtxo[]) => Promise<string>;
  rows: (id: string) => TxRow[];
  balance: (id: string) => { confirmed: bigint; pending: bigint; total: bigint } | null;
  note: { tone: "ok" | "warn" | "error"; text: string } | null;
  setNote: (n: Engine["note"]) => void;
}

const readPersisted = (): Persisted | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Persisted;
    if (!p || typeof p !== "object") return null;
    return { state: readState(p.state), mode: p.mode === "password" || p.mode === "session" ? p.mode : "plain", vault: p.vault ?? null };
  } catch {
    return null;
  }
};

export function useWalletEngine(testHooks?: { onEngine?: (e: Engine) => void }): Engine {
  const [ready, setReady] = useState(false);
  const [state, setState] = useState<WalletState>(emptyState);
  const [mode, setMode] = useState<VaultMode | null>(null);
  const [locked, setLocked] = useState(false);
  const [live, setLive] = useState<Record<string, Live>>({});
  const [tiers, setTiers] = useState<FeeTiers | null>(null);
  const [price, setPrice] = useState<Engine["price"]>(null);
  const [note, setNote] = useState<Engine["note"]>(null);
  const secrets = useRef<Secrets>({});
  const password = useRef<string | null>(null);
  const envelope = useRef<Envelope | null>(null);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  const modeRef = useRef<VaultMode | null>(null);

  // Load what the browser holds.
  useEffect(() => {
    const p = readPersisted();
    queueMicrotask(() => {
      if (p) {
        if (p.mode !== "session") setState(p.state);
        setMode(p.mode);
        modeRef.current = p.mode;
        if (p.mode === "password" && p.vault && isEnvelope(p.vault)) {
          envelope.current = p.vault;
          setLocked(true);
        } else if (p.mode === "plain" && p.vault && "plain" in p.vault) secrets.current = p.vault.plain;
      }
      setReady(true);
    });
  }, []);

  // Persist the public state whenever it changes (not in session mode).
  useEffect(() => {
    if (!ready || modeRef.current === "session" || modeRef.current === null) return;
    const prev = readPersisted();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, mode: modeRef.current, vault: prev?.vault ?? null } satisfies Persisted));
    } catch {
      /* storage unavailable */
    }
  }, [state, ready]);

  const saveSecrets = useCallback(async () => {
    const m = modeRef.current;
    if (m === "session" || m === null) return;
    let vault: Persisted["vault"] = null;
    if (m === "password") {
      if (!password.current) throw new Error("The vault is locked.");
      envelope.current = await encryptJson(secrets.current, password.current);
      vault = envelope.current;
    } else vault = { plain: secrets.current };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ state: stateRef.current, mode: m, vault } satisfies Persisted));
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setupVault = useCallback(
    async (m: VaultMode, pw?: string) => {
      modeRef.current = m;
      setMode(m);
      password.current = m === "password" ? (pw ?? null) : null;
      setLocked(false);
      if (m === "session") {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "session" }));
        } catch {
          /* ignore */
        }
      } else await saveSecrets();
    },
    [saveSecrets],
  );
  const unlock = useCallback(async (pw: string) => {
    if (!envelope.current) return false;
    try {
      secrets.current = await decryptJson<Secrets>(envelope.current, pw);
      password.current = pw;
      setLocked(false);
      return true;
    } catch {
      return false;
    }
  }, []);
  const lock = useCallback(() => {
    if (modeRef.current !== "password") return;
    secrets.current = {};
    password.current = null;
    setLocked(true);
  }, []);
  const changeVault = useCallback(
    async (m: VaultMode, pw?: string) => {
      if (m === "password" && !pw) throw new Error("Choose a password.");
      await setupVault(m, pw);
      if (m === "session") {
        // Only the choice is remembered; wallets live until the tab closes.
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ mode: "session" }));
        } catch {
          /* ignore */
        }
      }
    },
    [setupVault],
  );

  // Auto-lock after inactivity, and when the tab hides if asked.
  const prefs = state.prefs;
  useEffect(() => {
    if (mode !== "password" || locked) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      if (prefs.lockMinutes > 0) timer = setTimeout(lock, prefs.lockMinutes * 60_000);
    };
    const onHide = () => {
      if (document.visibilityState === "hidden" && prefs.lockOnHide) lock();
    };
    const events = ["pointerdown", "keydown", "scroll", "touchstart"] as const;
    for (const e of events) window.addEventListener(e, arm, { passive: true });
    document.addEventListener("visibilitychange", onHide);
    arm();
    return () => {
      clearTimeout(timer);
      for (const e of events) window.removeEventListener(e, arm);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [mode, locked, prefs.lockMinutes, prefs.lockOnHide, lock]);

  const network = state.network;
  const wallets = state.wallets[network];
  const selectedId = state.selected[network];
  const selected = wallets.find((w) => w.id === selectedId) ?? null;
  const ep = useMemo(() => endpoints(prefs.provider, network), [prefs.provider, network]);
  const api = useMemo(() => new Esplora(ep.api), [ep.api]);
  const explorer = ep.explorer;
  const providerName = ep.name;

  const patchState = useCallback((fn: (s: WalletState) => WalletState) => setState((s) => fn(s)), []);
  const patchWallet = useCallback(
    (id: string, fn: (w: WalletRecord) => WalletRecord) =>
      patchState((s) => ({ ...s, wallets: { ...s.wallets, [s.network]: s.wallets[s.network].map((w) => (w.id === id ? fn(w) : w)) } })),
    [patchState],
  );

  const select = useCallback(
    (id: string | null) => {
      patchState((s) => ({ ...s, selected: { ...s.selected, [s.network]: id } }));
      if (id) setLive((l) => (l[id]?.badge ? { ...l, [id]: { ...l[id], badge: false } } : l));
    },
    [patchState],
  );
  const setNetwork = useCallback((n: Network) => patchState((s) => ({ ...s, network: n })), [patchState]);
  const setPrefs = useCallback((p: Partial<Prefs>) => patchState((s) => ({ ...s, prefs: { ...s.prefs, ...p } })), [patchState]);

  /* ------------------------------------------------------------ wallets */

  const deriveEntries = (w: Pick<WalletRecord, "type" | "path"> & { xpub: string }, net: Network, chain: Chain, from: number, count: number): AddressEntry[] => {
    const { node } = publicAccount(w.xpub, net, w.type);
    const out: AddressEntry[] = [];
    for (let i = from; i < from + count; i++) out.push({ index: i, address: addressAt(node, w.type, net, chain, i, w.path).address });
    return out;
  };

  const addWallet = useCallback(
    (w: WalletRecord, mnemonic?: string) => {
      if (mnemonic) secrets.current = { ...secrets.current, [w.id]: { mnemonic } };
      patchState((s) => {
        const list = [...s.wallets[s.network], w];
        return { ...s, wallets: { ...s.wallets, [s.network]: list }, selected: { ...s.selected, [s.network]: s.selected[s.network] ?? w.id } };
      });
    },
    [patchState],
  );

  const candidates = useCallback(
    (type: AddressType, count: number): Candidate[] => {
      const out: Candidate[] = [];
      for (let i = 0; i < count; i++) {
        const mnemonic = newMnemonic(12);
        const acct = deriveAccount(mnemonic, type, stateRef.current.network, 0);
        out.push({ mnemonic, address: addressAt(acct.node, type, stateRef.current.network, 0, 0, acct.path).address, fingerprint: acct.fingerprint });
      }
      return out;
    },
    [],
  );

  const makeRecord = (mnemonic: string, type: AddressType, account: number, net: Network, name?: string): WalletRecord => {
    const acct = deriveAccount(mnemonic, type, net, account);
    const receive = Array.from({ length: 5 }, (_, i) => ({ index: i, address: addressAt(acct.node, type, net, 0, i, acct.path).address }));
    const change = Array.from({ length: 2 }, (_, i) => ({ index: i, address: addressAt(acct.node, type, net, 1, i, acct.path).address }));
    return { id: newWalletId(), name: name?.trim() || autoName(receive[0].address), kind: "hd", type, account, path: acct.path, xpub: acct.xpub, fingerprint: acct.fingerprint, receive, change, createdAt: Date.now() };
  };

  const createFromMnemonic = useCallback(
    async (mnemonic: string, type: AddressType, name?: string) => {
      const m = normalizeMnemonic(mnemonic);
      if (!isValidMnemonic(m)) throw new Error("Invalid mnemonic phrase.");
      const w = makeRecord(m, type, 0, stateRef.current.network, name);
      if (stateRef.current.wallets[stateRef.current.network].some((x) => x.xpub === w.xpub)) throw new Error("This wallet is already in the list.");
      addWallet(w, m);
      await saveSecrets();
      return w;
    },
    [addWallet, saveSecrets],
  );

  const createNextAccount = useCallback(
    async (fromId: string, type: AddressType) => {
      const m = secrets.current[fromId]?.mnemonic;
      if (!m) throw new Error("That wallet's phrase is not available (watch-only, or the vault is locked).");
      const fp = seedFingerprint(m);
      const net = stateRef.current.network;
      const taken = new Set(stateRef.current.wallets[net].filter((w) => w.fingerprint === fp && w.type === type).map((w) => w.account));
      let account = 0;
      while (taken.has(account)) account++;
      const w = makeRecord(m, type, account, net);
      addWallet(w, m);
      await saveSecrets();
      return w;
    },
    [addWallet, saveSecrets],
  );

  /** Which addresses of a list have ever been used, from the chain. */
  const usedOf = useCallback(
    async (addresses: string[]): Promise<Set<string>> => {
      const used = new Set<string>();
      await Promise.all(
        addresses.map(async (a) => {
          const s = await api.stats(a);
          if (s.chain_stats.tx_count + s.mempool_stats.tx_count > 0) used.add(a);
        }),
      );
      return used;
    },
    [api],
  );

  const importMnemonic = useCallback(
    async (mnemonic: string, type: AddressType, scan: boolean) => {
      const m = normalizeMnemonic(mnemonic);
      if (!isValidMnemonic(m)) throw new Error("Invalid mnemonic phrase.");
      const net = stateRef.current.network;
      const fp = seedFingerprint(m);
      const existing = stateRef.current.wallets[net].find((w) => w.fingerprint === fp && w.type === type && w.account === 0);
      if (existing) return { duplicate: existing };
      const w = makeRecord(m, type, 0, net);
      let usedCount = 0;
      if (scan) {
        // Walk the receive chain until a gap of unused addresses; the change chain a little way too.
        const acct = deriveAccount(m, type, net, 0);
        for (const chain of [0, 1] as Chain[]) {
          const entries: AddressEntry[] = [];
          let gap = 0, index = 0;
          while (gap < (chain === 0 ? GAP_LIMIT : 10) && index < 200) {
            const batch = Array.from({ length: 10 }, (_, i) => ({ index: index + i, address: addressAt(acct.node, type, net, chain, index + i, acct.path).address }));
            const used = await usedOf(batch.map((b) => b.address));
            for (const b of batch) {
              const u = used.has(b.address);
              entries.push({ ...b, used: u });
              if (u) {
                gap = 0;
                usedCount++;
              } else gap++;
            }
            index += 10;
          }
          const lastUsed = entries.map((e, i) => (e.used ? i : -1)).reduce((a, b) => Math.max(a, b), -1);
          const keep = entries.slice(0, Math.max(chain === 0 ? 5 : 2, lastUsed + 2));
          if (chain === 0) w.receive = keep;
          else w.change = keep;
        }
      }
      addWallet(w, m);
      await saveSecrets();
      return { wallet: w, usedAddresses: usedCount };
    },
    [addWallet, saveSecrets, usedOf],
  );

  const addWatch = useCallback(
    async (input: string, type: AddressType) => {
      const text = input.trim();
      const net = stateRef.current.network;
      if (/^[xtzv]pub/.test(text)) {
        const { node, type: t, xpub } = publicAccount(text, net, type);
        if (stateRef.current.wallets[net].some((w) => w.xpub === xpub)) throw new Error("This account is already in the list.");
        const path = `m/${addressTypeInfo(t).purpose}'/${net === "mainnet" ? 0 : 1}'/0'`;
        const receive = Array.from({ length: 5 }, (_, i) => ({ index: i, address: addressAt(node, t, net, 0, i, path).address }));
        const change = Array.from({ length: 2 }, (_, i) => ({ index: i, address: addressAt(node, t, net, 1, i, path).address }));
        const w: WalletRecord = { id: newWalletId(), name: `Watch ${autoName(receive[0].address).slice(7)}`, kind: "watch", type: t, account: 0, path, xpub, receive, change, createdAt: Date.now() };
        addWallet(w);
        return w;
      }
      if (!isValidAddress(text, net)) throw new Error(`Not a ${net} address or an extended public key.`);
      if (stateRef.current.wallets[net].some((w) => w.address === text)) throw new Error("This address is already in the list.");
      const t = addressTypeOf(text, net);
      const w: WalletRecord = { id: newWalletId(), name: `Watch ${autoName(text).slice(7)}`, kind: "watch", type: t === "other" || t === null ? "p2wpkh" : t, account: 0, path: "", address: text, receive: [], change: [], createdAt: Date.now() };
      addWallet(w);
      return w;
    },
    [addWallet],
  );

  const rename = useCallback((id: string, name: string) => patchWallet(id, (w) => ({ ...w, name: name.trim() || w.name })), [patchWallet]);
  const remove = useCallback(
    (id: string) => {
      delete secrets.current[id];
      patchState((s) => {
        const list = s.wallets[s.network].filter((w) => w.id !== id);
        const selected = s.selected[s.network] === id ? (list[0]?.id ?? null) : s.selected[s.network];
        return { ...s, wallets: { ...s.wallets, [s.network]: list }, selected: { ...s.selected, [s.network]: selected } };
      });
      void saveSecrets();
    },
    [patchState, saveSecrets],
  );
  const label = useCallback(
    (id: string, chain: Chain, index: number, text: string) =>
      patchWallet(id, (w) => ({ ...w, [chain === 0 ? "receive" : "change"]: (chain === 0 ? w.receive : w.change).map((a) => (a.index === index ? { ...a, label: text.trim() || undefined } : a)) })),
    [patchWallet],
  );
  const deriveMore = useCallback(
    (id: string, chain: Chain, count = 5) =>
      patchWallet(id, (w) => {
        if (!w.xpub) return w;
        const list = chain === 0 ? w.receive : w.change;
        const from = list.length ? list[list.length - 1].index + 1 : 0;
        const more = deriveEntries({ type: w.type, path: w.path, xpub: w.xpub }, stateRef.current.network, chain, from, count);
        return { ...w, [chain === 0 ? "receive" : "change"]: [...list, ...more] };
      }),
    [patchWallet],
  );
  const mnemonicOf = useCallback((id: string) => secrets.current[id]?.mnemonic ?? null, []);
  const hasSecrets = useCallback((id: string) => !!secrets.current[id], []);
  const privateKeyFor = useCallback((id: string, path: string) => {
    const m = secrets.current[id]?.mnemonic;
    const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
    if (!m || !w) return null;
    const acct = deriveAccount(m, w.type, stateRef.current.network, w.account);
    const parts = path.split("/");
    return privateKeyAt(acct, Number(parts[parts.length - 2]) as Chain, Number(parts[parts.length - 1]));
  }, []);

  const exportBackup = useCallback(async () => {
    const pw = password.current ?? "";
    const file: BackupFile = { bench: "btc-wallet", v: 1, exportedAt: Date.now(), network: stateRef.current.network, wallets: stateRef.current.wallets[stateRef.current.network], secrets: secrets.current };
    if (modeRef.current === "password" && pw) return JSON.stringify(await encryptJson(file, pw), null, 2);
    return JSON.stringify({ unencrypted: true, ...file }, null, 2);
  }, []);
  const importBackup = useCallback(
    async (text: string, pw: string) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error("That file is not JSON.");
      }
      const file = isEnvelope(parsed) ? await decryptJson<BackupFile>(parsed, pw) : (parsed as BackupFile);
      if (file?.bench !== "btc-wallet" || !Array.isArray(file.wallets)) throw new Error("That is not a Bench wallet backup.");
      if (file.network !== stateRef.current.network) throw new Error(`That backup is for ${file.network}; switch network first.`);
      let added = 0;
      for (const w of file.wallets) {
        if (stateRef.current.wallets[file.network].some((x) => x.id === w.id || (w.xpub && x.xpub === w.xpub) || (w.address && x.address === w.address))) continue;
        const copy = { ...w, id: newWalletId() };
        addWallet(copy, file.secrets?.[w.id]?.mnemonic);
        added++;
      }
      await saveSecrets();
      return added;
    },
    [addWallet, saveSecrets],
  );

  /* -------------------------------------------------------------- chain */

  const refreshOne = useCallback(
    async (w: WalletRecord, isSelected: boolean) => {
      setLive((l) => ({ ...l, [w.id]: { ...(l[w.id] ?? { utxos: [], txs: [], more: false, tip: 0, at: 0, error: null }), loading: true } }));
      try {
        const addrs = ownAddresses(w);
        const [tip, utxoLists] = await Promise.all([api.tipHeight(), Promise.all(addrs.map(async (a) => (await api.utxos(a)).map((u) => ({ ...u, address: a }))))]);
        const utxos = utxoLists.flat();
        // History: the first page of every address, merged and sorted; more pages on request from the selected one.
        const pages = await Promise.all(addrs.map((a) => api.txs(a)));
        const seen = new Map<string, EsploraTx>();
        for (const page of pages) for (const t of page) seen.set(t.txid, t);
        const txs = [...seen.values()].sort((a, b) => (b.status.block_time ?? Number.MAX_SAFE_INTEGER) - (a.status.block_time ?? Number.MAX_SAFE_INTEGER));
        const total = utxos.reduce((a, u) => a + u.value, 0);
        const usedNow = new Set<string>();
        for (const t of txs) {
          for (const v of t.vin) if (v.prevout?.scriptpubkey_address) usedNow.add(v.prevout.scriptpubkey_address);
          for (const o of t.vout) if (o.scriptpubkey_address) usedNow.add(o.scriptpubkey_address);
        }
        const prev = stateRef.current.balances[w.id];
        patchState((s) => ({ ...s, balances: { ...s.balances, [w.id]: { sats: String(total), at: Date.now() } } }));
        // Mark used addresses, and keep a fresh one ahead on each chain.
        patchWallet(w.id, (x) => {
          const mark = (list: AddressEntry[]) => list.map((a) => (usedNow.has(a.address) && !a.used ? { ...a, used: true } : a));
          let receive = mark(x.receive), change = mark(x.change);
          if (x.xpub) {
            if (!receive.some((a) => !a.used)) receive = [...receive, ...deriveEntries({ type: x.type, path: x.path, xpub: x.xpub }, stateRef.current.network, 0, receive.length ? receive[receive.length - 1].index + 1 : 0, 5)];
            if (!change.some((a) => !a.used)) change = [...change, ...deriveEntries({ type: x.type, path: x.path, xpub: x.xpub }, stateRef.current.network, 1, change.length ? change[change.length - 1].index + 1 : 0, 2)];
          }
          return { ...x, receive, change };
        });
        setLive((l) => ({ ...l, [w.id]: { utxos, txs, more: pages.some((p) => p.length >= 25), tip, loading: false, error: null, at: Date.now(), badge: !isSelected && !!prev && Number(prev.sats) < total ? true : (l[w.id]?.badge ?? false) } }));
      } catch (e) {
        setLive((l) => ({ ...l, [w.id]: { ...(l[w.id] ?? { utxos: [], txs: [], more: false, tip: 0, at: 0 }), loading: false, error: e instanceof Error ? e.message : String(e) } }));
      }
    },
    [api, patchState, patchWallet],
  );

  const refresh = useCallback(
    async (id?: string) => {
      const list = stateRef.current.wallets[stateRef.current.network];
      const targets = id ? list.filter((w) => w.id === id) : list;
      const sel = stateRef.current.selected[stateRef.current.network];
      await Promise.all(targets.map((w) => refreshOne(w, w.id === sel)));
      try {
        setTiers(feeTiers(await api.feeEstimates()));
      } catch {
        /* fee estimates are optional */
      }
    },
    [api, refreshOne],
  );

  const loadMore = useCallback(
    async (id: string) => {
      const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
      const cur = live[id];
      if (!w || !cur?.more) return;
      const last = [...cur.txs].reverse().find((t) => t.status.confirmed);
      if (!last) return;
      const pages = await Promise.all(ownAddresses(w).map((a) => api.txs(a, last.txid).catch(() => [] as EsploraTx[])));
      const seen = new Map(cur.txs.map((t) => [t.txid, t]));
      for (const page of pages) for (const t of page) seen.set(t.txid, t);
      setLive((l) => ({ ...l, [id]: { ...l[id], txs: [...seen.values()].sort((a, b) => (b.status.block_time ?? Number.MAX_SAFE_INTEGER) - (a.status.block_time ?? Number.MAX_SAFE_INTEGER)), more: pages.some((p) => p.length >= 25) } }));
    },
    [api, live],
  );

  // Poll while visible; refresh on network/provider change and when the wallet list changes.
  const walletKey = wallets.map((w) => w.id).join(",");
  useEffect(() => {
    if (!ready) return;
    let stop = false;
    const tick = () => {
      if (stop || document.visibilityState !== "visible") return;
      void refresh();
    };
    const id = setInterval(tick, Math.max(10, prefs.pollSeconds) * 1000);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    queueMicrotask(tick);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, refresh, prefs.pollSeconds, walletKey, network]);

  // Price for the fiat view, every five minutes.
  useEffect(() => {
    if (!ready || prefs.fiat === "none") return;
    let stop = false;
    const load = () => void fetchPrice(["usd", "eur", "jpy", "gbp"]).then((p) => !stop && p && setPrice(p));
    queueMicrotask(load);
    const id = setInterval(load, 300_000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [ready, prefs.fiat]);

  const spendable = useCallback(
    async (id: string): Promise<SpendableUtxo[]> => {
      const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
      const cur = live[id];
      if (!w || !w.xpub) throw new Error("This wallet cannot spend.");
      const net = stateRef.current.network;
      const { node } = publicAccount(w.xpub, net, w.type);
      const byAddress = new Map<string, { chain: Chain; index: number }>();
      for (const a of w.receive) byAddress.set(a.address, { chain: 0, index: a.index });
      for (const a of w.change) byAddress.set(a.address, { chain: 1, index: a.index });
      const out: SpendableUtxo[] = [];
      for (const u of cur?.utxos ?? []) {
        const at = byAddress.get(u.address);
        if (!at) continue;
        const d = addressAt(node, w.type, net, at.chain, at.index, w.path);
        out.push({ txid: u.txid, vout: u.vout, value: BigInt(u.value), address: u.address, type: w.type, path: d.path, pubkey: d.pubkey, script: scriptHex(d.script), confirmed: u.status.confirmed, height: u.status.block_height, nonWitnessHex: w.type === "p2pkh" ? await api.txHex(u.txid) : undefined });
      }
      return out;
    },
    [api, live],
  );

  const prepareSend = useCallback(
    async (id: string, req: Omit<BuildRequest, "utxos" | "changeAddress" | "changeType" | "network">) => {
      const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
      if (!w) throw new Error("No wallet selected.");
      if (w.kind === "watch") throw new Error("A watch-only wallet cannot send.");
      if (!secrets.current[id]) throw new Error("Unlock the vault to send.");
      const utxos = await spendable(id);
      const change = freshChange(w) ?? w.change[0];
      const built = buildTx({ ...req, utxos, changeAddress: change.address, changeType: w.type, network: stateRef.current.network });
      return { built, utxos };
    },
    [spendable],
  );

  /** The inputs of one of the wallet's own pending transactions, as spendable coins again, for a fee bump. */
  const prepareBump = useCallback(
    async (id: string, txid: string) => {
      const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
      const cur = live[id];
      const t = cur?.txs.find((x) => x.txid === txid);
      if (!w || !w.xpub || !t) throw new Error("That transaction is not in this wallet's history.");
      if (t.status.confirmed) throw new Error("That transaction is already confirmed.");
      if (!secrets.current[id]) throw new Error("Unlock the vault to bump a fee.");
      const net = stateRef.current.network;
      const mine = new Set(ownAddresses(w));
      if (!t.vin.every((v) => v.prevout?.scriptpubkey_address && mine.has(v.prevout.scriptpubkey_address))) throw new Error("Only transactions this wallet sent can be bumped.");
      if (!t.vin.some((v) => v.sequence < 0xfffffffe)) throw new Error("That transaction was not sent with replace-by-fee enabled.");
      const { node } = publicAccount(w.xpub, net, w.type);
      const byAddress = new Map<string, { chain: Chain; index: number }>();
      for (const a of w.receive) byAddress.set(a.address, { chain: 0, index: a.index });
      for (const a of w.change) byAddress.set(a.address, { chain: 1, index: a.index });
      const utxos: SpendableUtxo[] = [];
      for (const v of t.vin) {
        const address = v.prevout!.scriptpubkey_address!;
        const at = byAddress.get(address)!;
        const d = addressAt(node, w.type, net, at.chain, at.index, w.path);
        utxos.push({ txid: v.txid, vout: v.vout, value: BigInt(v.prevout!.value), address, type: w.type, path: d.path, pubkey: d.pubkey, script: scriptHex(d.script), confirmed: true, nonWitnessHex: w.type === "p2pkh" ? await api.txHex(v.txid) : undefined });
      }
      const recipient = t.vout.find((o) => o.scriptpubkey_address && !mine.has(o.scriptpubkey_address));
      if (!recipient?.scriptpubkey_address) throw new Error("Could not find the recipient of that transaction.");
      const vsize = Math.ceil(t.weight / 4);
      const feeRate = bumpFeeRate(t.fee / vsize);
      const change = freshChange(w) ?? w.change[0];
      const built = buildTx({ utxos, only: utxos.map((u) => `${u.txid}:${u.vout}`), to: recipient.scriptpubkey_address, amount: BigInt(recipient.value), feeRate, changeAddress: change.address, changeType: w.type, network: net, rbf: true });
      return { built, utxos, to: recipient.scriptpubkey_address, feeRate, previousFee: BigInt(t.fee) };
    },
    [api, live],
  );

  const broadcast = useCallback(
    async (id: string, built: BuiltTx, utxos: SpendableUtxo[]) => {
      const signed = signTx(built, utxos, (path) => {
        const k = privateKeyFor(id, path);
        if (!k) throw new Error("Unlock the vault to sign.");
        return k;
      });
      const txid = await api.broadcast(signed.hex);
      setTimeout(() => void refresh(id), 1500);
      return txid;
    },
    [api, privateKeyFor, refresh],
  );

  const rows = useCallback(
    (id: string): TxRow[] => {
      const w = stateRef.current.wallets[stateRef.current.network].find((x) => x.id === id);
      const cur = live[id];
      if (!w || !cur) return [];
      const mine = new Set(ownAddresses(w));
      return cur.txs.map((t) => summarizeTx(t, mine, cur.tip));
    },
    [live],
  );
  const balance = useCallback(
    (id: string) => {
      const cur = live[id];
      if (!cur) {
        const cached = state.balances[id];
        return cached ? { confirmed: BigInt(cached.sats), pending: 0n, total: BigInt(cached.sats) } : null;
      }
      let confirmed = 0n, pending = 0n;
      for (const u of cur.utxos) if (u.status.confirmed) confirmed += BigInt(u.value); else pending += BigInt(u.value);
      return { confirmed, pending, total: confirmed + pending };
    },
    [live, state.balances],
  );

  const engine: Engine = {
    ready, state, network, wallets, selected, live, mode, locked, hasSecrets, tiers, price, explorer, providerName, api,
    setupVault, unlock, lock, changeVault,
    select, setNetwork, setPrefs, candidates, createFromMnemonic, createNextAccount, importMnemonic, addWatch, rename, remove, label, deriveMore, mnemonicOf, privateKeyFor, exportBackup, importBackup,
    refresh, loadMore, spendable, prepareSend, prepareBump, broadcast, rows, balance, note, setNote,
  };
  useEffect(() => {
    testHooks?.onEngine?.(engine);
  });
  return engine;
}

export const fiatOf = (price: Engine["price"], fiat: Fiat | "none") => (price && fiat !== "none" ? (price.prices[fiat] ?? null) : null);
