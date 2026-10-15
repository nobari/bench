/**
 * Building and signing: coin selection with a fee rate (largest-first, change only when it is worth more than
 * dust), replace-by-fee, sweeping, and signing per input type — ECDSA for P2PKH and P2WPKH, Schnorr with the
 * Taproot tweak for P2TR. The library does the PSBT work; this module turns wallet UTXOs into its inputs.
 */
import { DEFAULT_SEQUENCE, Transaction, selectUTXO } from "@scure/btc-signer";
import { DUST, NETWORKS, addressScript, hexToBytes, type AddressType, type Network } from "./keys";

/** An unspent output the wallet can spend, with where its key lives. */
export interface SpendableUtxo {
  txid: string;
  vout: number;
  value: bigint;
  address: string;
  type: AddressType;
  /** Full derivation path of the address. */
  path: string;
  /** Compressed public key of the address, hex. */
  pubkey: string;
  /** Output script, hex. */
  script: string;
  /** Raw hex of the funding transaction (needed to spend P2PKH). */
  nonWitnessHex?: string;
  confirmed: boolean;
  height?: number;
  label?: string;
}

export const RBF_SEQUENCE = 0xfffffffd;

/** Rough weight of an input or output by type, for previews before selection (vbytes). */
export const VBYTES = {
  input: { p2pkh: 148, p2wpkh: 68, p2tr: 57.5 } as Record<AddressType, number>,
  output: { p2pkh: 34, p2wpkh: 31, p2tr: 43, other: 34 } as Record<AddressType | "other", number>,
  overhead: 10.5,
};
export function estimateVsize(inputs: AddressType[], outputs: (AddressType | "other")[]): number {
  return Math.ceil(VBYTES.overhead + inputs.reduce((a, t) => a + VBYTES.input[t], 0) + outputs.reduce((a, t) => a + VBYTES.output[t], 0));
}

function inputFor(u: SpendableUtxo, rbf: boolean) {
  const base = { txid: u.txid, index: u.vout, sequence: rbf ? RBF_SEQUENCE : DEFAULT_SEQUENCE };
  const pub = hexToBytes(u.pubkey);
  if (u.type === "p2pkh") {
    if (!u.nonWitnessHex) throw new Error(`The funding transaction of ${u.txid.slice(0, 8)}… is needed to spend a legacy output.`);
    return { ...base, nonWitnessUtxo: hexToBytes(u.nonWitnessHex) };
  }
  if (u.type === "p2tr") return { ...base, witnessUtxo: { script: hexToBytes(u.script), amount: u.value }, tapInternalKey: pub.slice(1) };
  return { ...base, witnessUtxo: { script: hexToBytes(u.script), amount: u.value } };
}

export interface BuildRequest {
  utxos: SpendableUtxo[];
  to: string;
  /** Satoshis; ignored when `sweep` is set. */
  amount: bigint;
  /** sat/vB. */
  feeRate: number;
  changeAddress: string;
  changeType: AddressType;
  network: Network;
  rbf: boolean;
  /** Send everything the chosen UTXOs hold, minus the fee. */
  sweep?: boolean;
  /** Only these UTXOs may be used (coin control); all of them are used when sweeping. */
  only?: string[];
}
export interface BuiltTx {
  tx: Transaction;
  fee: bigint;
  vsize: number;
  /** UTXOs that went in, as txid:vout. */
  inputs: string[];
  amount: bigint;
  change: bigint;
  changed: boolean;
}

/** Picks inputs and lays out outputs; the result is unsigned. Throws with a plain message when it cannot. */
export function buildTx(req: BuildRequest): BuiltTx {
  const net = NETWORKS[req.network].net;
  if (!req.to.trim()) throw new Error("Enter a recipient address.");
  let toScript: Uint8Array;
  try {
    toScript = addressScript(req.to, req.network);
  } catch {
    throw new Error(`That is not a valid ${NETWORKS[req.network].name} address.`);
  }
  const feePerByte = BigInt(Math.max(1, Math.ceil(req.feeRate)));
  const pool = req.only ? req.utxos.filter((u) => req.only!.includes(`${u.txid}:${u.vout}`)) : req.utxos;
  if (!pool.length) throw new Error(req.only ? "None of the chosen coins can be spent." : "This wallet has nothing to spend.");
  const total = pool.reduce((a, u) => a + u.value, 0n);
  const inputs = pool.map((u) => inputFor(u, req.rbf));
  if (req.sweep) {
    const vsize = estimateVsize(pool.map((u) => u.type), [req.to ? "other" : "other"]);
    const fee = BigInt(vsize) * feePerByte;
    const amount = total - fee;
    if (amount <= 0n) throw new Error("The fee would take everything these coins hold.");
    const res = selectUTXO(inputs, [{ script: toScript, amount }], "all", { feePerByte, changeAddress: req.changeAddress, network: net, dust: DUST[req.changeType], createTx: true, allowUnknownOutputs: true });
    if (!res?.tx) throw new Error("Could not build the sweep.");
    return { tx: res.tx, fee: res.fee ?? fee, vsize: Math.ceil(res.weight / 4), inputs: pool.map((u) => `${u.txid}:${u.vout}`), amount, change: 0n, changed: false };
  }
  if (req.amount <= 0n) throw new Error("Enter an amount above zero.");
  const dustTo = dustForScript(toScript);
  if (req.amount < dustTo) throw new Error(`Amounts below ${dustTo} sats are dust and would not be relayed.`);
  if (req.amount > total) throw new Error(`Not enough funds: ${total} sats available.`);
  const res = selectUTXO(inputs, [{ script: toScript, amount: req.amount }], req.only ? "all" : "default", {
    feePerByte,
    changeAddress: req.changeAddress,
    network: net,
    dust: DUST[req.changeType],
    createTx: true,
    allowUnknownOutputs: true,
    bip69: false,
  });
  if (!res?.tx) throw new Error(`Not enough funds to cover the amount and a ${feePerByte} sat/vB fee.`);
  const used = res.inputs.map((i) => `${typeof i.txid === "string" ? i.txid : bytesToHexLocal(i.txid as Uint8Array)}:${i.index}`);
  const changeOut = res.tx.outputsLength > 1 ? res.tx.getOutput(res.tx.outputsLength - 1).amount ?? 0n : 0n;
  return { tx: res.tx, fee: res.fee ?? res.tx.fee, vsize: Math.ceil(res.weight / 4), inputs: used, amount: req.amount, change: res.change ? changeOut : 0n, changed: !!res.change };
}

function bytesToHexLocal(b: Uint8Array) {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
/** Dust for an arbitrary output script by its type. */
function dustForScript(script: Uint8Array): bigint {
  if (script.length === 22 && script[0] === 0) return DUST.p2wpkh;
  if (script.length === 34 && script[0] === 0x51) return DUST.p2tr;
  return DUST.p2pkh;
}

export interface SignedTx {
  hex: string;
  txid: string;
  vsize: number;
  fee: bigint;
}

/** Signs every input with the key for its path and finalises. `keyFor` returns the private key of a path. */
export function signTx(built: BuiltTx, utxos: SpendableUtxo[], keyFor: (path: string) => Uint8Array): SignedTx {
  const tx = built.tx;
  const byOutpoint = new Map(utxos.map((u) => [`${u.txid}:${u.vout}`, u]));
  for (let i = 0; i < tx.inputsLength; i++) {
    const input = tx.getInput(i);
    const txid = input.txid ? bytesToHexLocal(input.txid) : "";
    const u = byOutpoint.get(`${txid}:${input.index}`);
    if (!u) throw new Error(`Input ${i} is not one of the wallet's coins.`);
    tx.signIdx(keyFor(u.path), i);
  }
  tx.finalize();
  return { hex: tx.hex, txid: tx.id, vsize: tx.vsize, fee: tx.fee };
}

/** The same transaction again with a higher fee rate, for replace-by-fee: same inputs, same recipient. */
export function bumpFeeRate(current: number, step = 1.25): number {
  return Math.max(current + 1, Math.ceil(current * step));
}
