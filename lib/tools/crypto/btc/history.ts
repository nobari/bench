/** Transactions as the wallet sees them: what each one did to its own addresses, and the details behind it. */
import type { EsploraTx } from "./chain";

export type TxKind = "sent" | "received" | "self";
export interface TxRow {
  txid: string;
  kind: TxKind;
  /** Net effect on the wallet in satoshis: negative for sent (fee included), positive for received. */
  net: bigint;
  /** What left the wallet to others (sent) or arrived from others (received). */
  amount: bigint;
  fee: bigint;
  /** sat/vB. */
  feeRate: number;
  vsize: number;
  confirmed: boolean;
  confirmations: number;
  height: number | null;
  time: number | null;
  /** Signals replace-by-fee (an input sequence below 0xfffffffe). */
  rbf: boolean;
  counterparties: string[];
}

/** Summarise a transaction for a wallet that owns `mine`; `tip` is the chain height for confirmations. */
export function summarizeTx(tx: EsploraTx, mine: Set<string>, tip: number): TxRow {
  let inMine = 0n, outMine = 0n, outOther = 0n;
  const others = new Set<string>();
  for (const v of tx.vin) {
    const a = v.prevout?.scriptpubkey_address;
    const val = BigInt(v.prevout?.value ?? 0);
    if (a && mine.has(a)) inMine += val;
    else if (a) others.add(a);
  }
  for (const o of tx.vout) {
    const a = o.scriptpubkey_address;
    const val = BigInt(o.value);
    if (a && mine.has(a)) outMine += val;
    else {
      outOther += val;
      if (a) others.add(a);
    }
  }
  const net = outMine - inMine;
  const kind: TxKind = inMine > 0n ? (outOther > 0n ? "sent" : "self") : "received";
  const amount = kind === "sent" ? outOther : kind === "received" ? outMine : outMine;
  const vsize = Math.ceil(tx.weight / 4);
  const height = tx.status.block_height ?? null;
  return {
    txid: tx.txid,
    kind,
    net,
    amount,
    fee: BigInt(tx.fee ?? 0),
    feeRate: vsize ? Math.round(((tx.fee ?? 0) / vsize) * 10) / 10 : 0,
    vsize,
    confirmed: tx.status.confirmed,
    confirmations: tx.status.confirmed && height !== null ? Math.max(1, tip - height + 1) : 0,
    height,
    time: tx.status.block_time ?? null,
    rbf: tx.vin.some((v) => v.sequence < 0xfffffffe),
    counterparties: [...others],
  };
}

export interface TxDetail extends TxRow {
  inputs: { address: string | null; value: bigint; mine: boolean; txid: string; vout: number }[];
  outputs: { address: string | null; value: bigint; mine: boolean; type?: string }[];
  size: number;
  weight: number;
  version: number;
  locktime: number;
}

export function detailTx(tx: EsploraTx, mine: Set<string>, tip: number): TxDetail {
  return {
    ...summarizeTx(tx, mine, tip),
    inputs: tx.vin.map((v) => ({ address: v.prevout?.scriptpubkey_address ?? null, value: BigInt(v.prevout?.value ?? 0), mine: !!v.prevout?.scriptpubkey_address && mine.has(v.prevout.scriptpubkey_address), txid: v.txid, vout: v.vout })),
    outputs: tx.vout.map((o) => ({ address: o.scriptpubkey_address ?? null, value: BigInt(o.value), mine: !!o.scriptpubkey_address && mine.has(o.scriptpubkey_address), type: o.scriptpubkey_type })),
    size: tx.size,
    weight: tx.weight,
    version: tx.version,
    locktime: tx.locktime,
  };
}

export function shortTxid(txid: string) {
  return `${txid.slice(0, 8)}…${txid.slice(-6)}`;
}
export function shortAddress(address: string) {
  return address.length > 20 ? `${address.slice(0, 10)}…${address.slice(-6)}` : address;
}
