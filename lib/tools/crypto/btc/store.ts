/**
 * What the wallet keeps: public wallet records per network (names, types, derived addresses, labels), the
 * user's preferences, and — separately, in the vault — the mnemonics. Pure helpers over that shape; the widget
 * owns persistence and the live chain data.
 */
import type { AddressType, Network } from "./keys";
import type { Provider } from "./chain";
import type { Fiat, Unit } from "./units";

export interface AddressEntry {
  index: number;
  address: string;
  label?: string;
  /** Seen with funds or transactions on the chain. */
  used?: boolean;
}

export interface WalletRecord {
  id: string;
  name: string;
  /** "hd": a mnemonic in the vault; "watch": an account public key or a single address, no keys. */
  kind: "hd" | "watch";
  type: AddressType;
  account: number;
  path: string;
  /** Account public key (hd and watch accounts). */
  xpub?: string;
  /** Watch-only single address. */
  address?: string;
  /** Master seed fingerprint, to tell seeds apart. */
  fingerprint?: string;
  receive: AddressEntry[];
  change: AddressEntry[];
  createdAt: number;
}

export interface Prefs {
  unit: Unit;
  fiat: Fiat | "none";
  provider: Provider;
  /** Minutes of inactivity before the vault locks (0: never). */
  lockMinutes: number;
  lockOnHide: boolean;
  pollSeconds: number;
  hideSecrets: boolean;
}

export interface WalletState {
  v: 1;
  network: Network;
  wallets: Record<Network, WalletRecord[]>;
  selected: Record<Network, string | null>;
  /** Last known balance per wallet id, so a reload shows a figure before the next fetch. */
  balances: Record<string, { sats: string; at: number }>;
  prefs: Prefs;
}

export type Secrets = Record<string, { mnemonic: string }>;
export type VaultMode = "password" | "plain" | "session";

export const STORAGE_KEY = "bench:btc-wallet:v1";
export const DEFAULT_PREFS: Prefs = { unit: "btc", fiat: "usd", provider: "blockstream", lockMinutes: 15, lockOnHide: false, pollSeconds: 20, hideSecrets: true };
export const GAP_LIMIT = 20;

export function emptyState(): WalletState {
  return { v: 1, network: "testnet", wallets: { mainnet: [], testnet: [] }, selected: { mainnet: null, testnet: null }, balances: {}, prefs: { ...DEFAULT_PREFS } };
}

export function newWalletId(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return "w" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** "Wallet n1x…k9p": the first and last three characters of the first address. */
export function autoName(address: string): string {
  return `Wallet ${address.slice(0, 3)}…${address.slice(-3)}`;
}

/** Every address a wallet owns, for recognising its own inputs and outputs. */
export function ownAddresses(w: WalletRecord): string[] {
  return w.address ? [w.address] : [...w.receive, ...w.change].map((a) => a.address);
}

/** The first unused receive address, or null when none is derived yet. */
export function freshReceive(w: WalletRecord): AddressEntry | null {
  return w.receive.find((a) => !a.used) ?? null;
}
export function freshChange(w: WalletRecord): AddressEntry | null {
  return w.change.find((a) => !a.used) ?? null;
}

/** Accepts a stored state after checking its shape; anything odd comes back as a fresh state. */
export function readState(raw: unknown): WalletState {
  const s = raw as WalletState | null;
  if (!s || typeof s !== "object" || s.v !== 1 || !s.wallets || !s.prefs) return emptyState();
  const base = emptyState();
  return {
    v: 1,
    network: s.network === "mainnet" ? "mainnet" : "testnet",
    wallets: { mainnet: Array.isArray(s.wallets.mainnet) ? s.wallets.mainnet : [], testnet: Array.isArray(s.wallets.testnet) ? s.wallets.testnet : [] },
    selected: { mainnet: s.selected?.mainnet ?? null, testnet: s.selected?.testnet ?? null },
    balances: s.balances && typeof s.balances === "object" ? s.balances : {},
    prefs: { ...base.prefs, ...s.prefs },
  };
}

/** The exported backup file: the public state plus, when unlocked, the secrets — all inside one envelope. */
export interface BackupFile {
  bench: "btc-wallet";
  v: 1;
  exportedAt: number;
  network: Network;
  wallets: WalletRecord[];
  secrets: Secrets;
}
