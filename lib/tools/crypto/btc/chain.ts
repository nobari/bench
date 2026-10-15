/**
 * Chain data through an Esplora-style REST API (Blockstream or mempool.space): unspent outputs, history with
 * paging, transaction hex, broadcast, fee estimates and the chain tip; a public price feed for fiat. Everything
 * is read from the browser with fetch; nothing is cached beyond what the caller keeps.
 */
import type { Network } from "./keys";

export type Provider = "blockstream" | "mempool";
export const PROVIDERS: Record<Provider, { name: string; api: Record<Network, string>; explorer: Record<Network, string> }> = {
  blockstream: {
    name: "Blockstream",
    api: { mainnet: "https://blockstream.info/api", testnet: "https://blockstream.info/testnet/api" },
    explorer: { mainnet: "https://blockstream.info", testnet: "https://blockstream.info/testnet" },
  },
  mempool: {
    name: "mempool.space",
    api: { mainnet: "https://mempool.space/api", testnet: "https://mempool.space/testnet/api" },
    explorer: { mainnet: "https://mempool.space", testnet: "https://mempool.space/testnet" },
  },
};

/** Testnet coins for trying the wallet out. */
export const FAUCETS = [
  { name: "coinfaucet.eu", url: "https://coinfaucet.eu/en/btc-testnet/" },
  { name: "bitcoinfaucet.uo1.net", url: "https://bitcoinfaucet.uo1.net/" },
  { name: "mempool.co faucet", url: "https://testnet-faucet.mempool.co/" },
];

export interface Utxo {
  txid: string;
  vout: number;
  value: number;
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}
export interface EsploraVin {
  txid: string;
  vout: number;
  prevout: { scriptpubkey_address?: string; scriptpubkey_type?: string; value: number } | null;
  sequence: number;
  is_coinbase: boolean;
}
export interface EsploraVout {
  scriptpubkey_address?: string;
  scriptpubkey_type?: string;
  scriptpubkey: string;
  value: number;
}
export interface EsploraTx {
  txid: string;
  version: number;
  locktime: number;
  size: number;
  weight: number;
  fee: number;
  vin: EsploraVin[];
  vout: EsploraVout[];
  status: { confirmed: boolean; block_height?: number; block_time?: number };
}
export interface AddressStats {
  chain_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
  mempool_stats: { funded_txo_sum: number; spent_txo_sum: number; tx_count: number };
}

export class ChainError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "ChainError";
    this.status = status;
  }
}

export class Esplora {
  readonly base: string;
  private readonly fetchFn: typeof fetch;
  constructor(base: string, fetchFn: typeof fetch = (...a) => fetch(...a)) {
    this.base = base;
    this.fetchFn = fetchFn;
  }
  private async get<T>(path: string, text = false): Promise<T> {
    const res = await this.fetchFn(`${this.base}${path}`, { headers: { Accept: text ? "text/plain" : "application/json" } });
    if (!res.ok) throw new ChainError(`${res.status} ${res.statusText || "error"} from the chain API for ${path}`, res.status);
    return (text ? await res.text() : await res.json()) as T;
  }
  utxos(address: string) {
    return this.get<Utxo[]>(`/address/${address}/utxo`);
  }
  stats(address: string) {
    return this.get<AddressStats>(`/address/${address}`);
  }
  /** Confirmed history pages 25 at a time; `lastSeen` continues after that txid. The first page includes mempool txs. */
  txs(address: string, lastSeen?: string) {
    return this.get<EsploraTx[]>(lastSeen ? `/address/${address}/txs/chain/${lastSeen}` : `/address/${address}/txs`);
  }
  tx(txid: string) {
    return this.get<EsploraTx>(`/tx/${txid}`);
  }
  txHex(txid: string) {
    return this.get<string>(`/tx/${txid}/hex`, true);
  }
  tipHeight() {
    return this.get<string>("/blocks/tip/height", true).then((t) => parseInt(t, 10));
  }
  /** Fee estimates in sat/vB keyed by confirmation target in blocks ("1", "2", "3", "6", "144", …). */
  feeEstimates() {
    return this.get<Record<string, number>>("/fee-estimates");
  }
  async broadcast(hex: string): Promise<string> {
    const res = await this.fetchFn(`${this.base}/tx`, { method: "POST", body: hex, headers: { "Content-Type": "text/plain" } });
    const body = await res.text();
    if (!res.ok) throw new ChainError(body.trim() || `${res.status} from the chain API`, res.status);
    return body.trim();
  }
}

export interface FeeTiers {
  slow: number;
  standard: number;
  fast: number;
  /** Blocks each tier aims at. */
  targets: { slow: number; standard: number; fast: number };
}
/** Three tiers from an estimate table: ~1 day, ~1 hour, next blocks; never below the 1 sat/vB relay floor. */
export function feeTiers(estimates: Record<string, number>): FeeTiers {
  const at = (target: number) => {
    const keys = Object.keys(estimates).map(Number).filter((k) => !Number.isNaN(k)).sort((a, b) => a - b);
    const key = keys.find((k) => k >= target) ?? keys[keys.length - 1];
    return Math.max(1, Math.round((estimates[String(key)] ?? 1) * 10) / 10);
  };
  return { slow: at(144), standard: at(6), fast: at(1), targets: { slow: 144, standard: 6, fast: 1 } };
}

/** A BTC price from CoinGecko's public feed, for fiat views; null when it cannot be read. */
export async function fetchPrice(currencies: readonly string[], fetchFn: typeof fetch = (...a) => fetch(...a)): Promise<{ at: number; prices: Record<string, number> } | null> {
  try {
    const res = await fetchFn(`https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=${currencies.join(",")}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { bitcoin?: Record<string, number> };
    return data.bitcoin ? { at: Date.now(), prices: data.bitcoin } : null;
  } catch {
    return null;
  }
}

/** BIP21 payment link. */
export function bip21(address: string, amountSats?: bigint, label?: string): string {
  const params = new URLSearchParams();
  if (amountSats && amountSats > 0n) {
    const whole = amountSats / 100_000_000n, frac = (amountSats % 100_000_000n).toString().padStart(8, "0").replace(/0+$/, "");
    params.set("amount", `${whole}${frac ? "." + frac : ""}`);
  }
  if (label) params.set("label", label);
  const q = params.toString();
  return `bitcoin:${address}${q ? `?${q}` : ""}`;
}
