/**
 * Bitcoin keys and addresses — the pure half of the wallet. BIP39 mnemonics, BIP32 accounts on the BIP44 / 84 / 86
 * paths (legacy P2PKH, native SegWit P2WPKH, Taproot P2TR), receive and change chains, watch-only accounts from an
 * extended public key, address validation and key export. Deterministic except mnemonic generation (CSPRNG).
 */
import { HDKey } from "@scure/bip32";
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { base58check } from "@scure/base";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { Address, NETWORK, OutScript, TEST_NETWORK, WIF, p2pkh, p2tr, p2wpkh } from "@scure/btc-signer";

/** Mainnet, plus the three test networks. The test networks share address formats and key versions; only the chain differs. */
export type Network = "mainnet" | "testnet4" | "signet" | "testnet";
/** Display order: the current test network first, mainnet last. */
export const NETWORK_ORDER: Network[] = ["testnet4", "signet", "testnet", "mainnet"];
export const isTestNetwork = (n: Network) => n !== "mainnet";
export type AddressType = "p2pkh" | "p2wpkh" | "p2tr";
export type Chain = 0 | 1;

export const NETWORKS: Record<Network, { name: string; net: typeof NETWORK; coinType: number; versions: { private: number; public: number } }> = {
  mainnet: { name: "Bitcoin mainnet", net: NETWORK, coinType: 0, versions: { private: 0x0488ade4, public: 0x0488b21e } },
  testnet4: { name: "Bitcoin testnet4", net: TEST_NETWORK, coinType: 1, versions: { private: 0x04358394, public: 0x043587cf } },
  signet: { name: "Bitcoin signet", net: TEST_NETWORK, coinType: 1, versions: { private: 0x04358394, public: 0x043587cf } },
  testnet: { name: "Bitcoin testnet3", net: TEST_NETWORK, coinType: 1, versions: { private: 0x04358394, public: 0x043587cf } },
};
/** Short labels for switches and lists. */
export const NETWORK_LABELS: Record<Network, string> = { mainnet: "Mainnet", testnet4: "Testnet4", signet: "Signet", testnet: "Testnet3" };

export const ADDRESS_TYPES: { id: AddressType; name: string; purpose: number; prefix: Record<Network, string>; blurb: string }[] = [
  { id: "p2wpkh", name: "Native SegWit", purpose: 84, prefix: { mainnet: "bc1q", testnet4: "tb1q", signet: "tb1q", testnet: "tb1q" }, blurb: "BIP84 · cheapest common type, accepted everywhere that matters" },
  { id: "p2tr", name: "Taproot", purpose: 86, prefix: { mainnet: "bc1p", testnet4: "tb1p", signet: "tb1p", testnet: "tb1p" }, blurb: "BIP86 · newest type, Schnorr signatures, smallest inputs" },
  { id: "p2pkh", name: "Legacy", purpose: 44, prefix: { mainnet: "1", testnet4: "m/n", signet: "m/n", testnet: "m/n" }, blurb: "BIP44 · oldest type, largest fees, works with anything" },
];
export const addressTypeInfo = (id: AddressType) => ADDRESS_TYPES.find((t) => t.id === id)!;

/** Dust: an output below this is not relayed (per type, from Bitcoin Core's rule at 3 sat/vB). */
export const DUST: Record<AddressType, bigint> = { p2pkh: 546n, p2wpkh: 294n, p2tr: 330n };

export const WORD_COUNTS = [12, 24] as const;
export function newMnemonic(words: 12 | 24 = 12): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}
export function normalizeMnemonic(text: string): string {
  return text.trim().toLowerCase().split(/\s+/).filter(Boolean).join(" ");
}
export function isValidMnemonic(text: string): boolean {
  const m = normalizeMnemonic(text);
  return !!m && validateMnemonic(m, wordlist);
}
/** A mnemonic's words, for the backup quiz and the picker. */
export const mnemonicWords = (m: string) => normalizeMnemonic(m).split(" ");

export function accountPath(type: AddressType, network: Network, account: number): string {
  return `m/${addressTypeInfo(type).purpose}'/${NETWORKS[network].coinType}'/${account}'`;
}

export interface DerivedAddress {
  address: string;
  /** Full path, m/…/chain/index. */
  path: string;
  chain: Chain;
  index: number;
  /** Compressed public key, hex. */
  pubkey: string;
  /** The output script this address pays to. */
  script: Uint8Array;
}

/** The payment for a public key of the given type. */
function payment(pub: Uint8Array, type: AddressType, network: Network) {
  const net = NETWORKS[network].net;
  if (type === "p2pkh") return p2pkh(pub, net);
  if (type === "p2wpkh") return p2wpkh(pub, net);
  return p2tr(pub.length === 33 ? pub.slice(1) : pub, undefined, net);
}

/** Addresses from an account-level node (private or public): m/purpose'/coin'/account'/chain/index. */
export function addressAt(accountNode: HDKey, type: AddressType, network: Network, chain: Chain, index: number, basePath: string): DerivedAddress {
  const node = accountNode.deriveChild(chain).deriveChild(index);
  if (!node.publicKey) throw new Error("No public key at this path.");
  const pay = payment(node.publicKey, type, network);
  return { address: pay.address!, path: `${basePath}/${chain}/${index}`, chain, index, pubkey: bytesToHex(node.publicKey), script: pay.script };
}

export interface AccountKeys {
  type: AddressType;
  network: Network;
  account: number;
  path: string;
  /** Extended public key of the account (xpub / tpub serialisation, whatever the type). */
  xpub: string;
  /** Master key fingerprint, hex, to tell seeds apart. */
  fingerprint: string;
  /** The private account node; derive spending keys from it. */
  node: HDKey;
}

/** The account at `account` on the path for `type`, from a mnemonic (seed derived without a passphrase). */
export function deriveAccount(mnemonic: string, type: AddressType, network: Network, account: number): AccountKeys {
  const m = normalizeMnemonic(mnemonic);
  if (!validateMnemonic(m, wordlist)) throw new Error("Invalid mnemonic phrase.");
  const versions = NETWORKS[network].versions;
  const master = HDKey.fromMasterSeed(mnemonicToSeedSync(m), versions);
  const path = accountPath(type, network, account);
  const node = master.derive(path);
  return { type, network, account, path, xpub: node.publicExtendedKey, fingerprint: master.fingerprint.toString(16).padStart(8, "0"), node };
}

/** The master fingerprint of a mnemonic, without deriving anything else. */
export function seedFingerprint(mnemonic: string): string {
  return HDKey.fromMasterSeed(mnemonicToSeedSync(normalizeMnemonic(mnemonic))).fingerprint.toString(16).padStart(8, "0");
}

/** The private key for an address under an account's private node. */
export function privateKeyAt(account: AccountKeys, chain: Chain, index: number): Uint8Array {
  const node = account.node.deriveChild(chain).deriveChild(index);
  if (!node.privateKey) throw new Error("This account cannot sign (watch-only).");
  return node.privateKey;
}

/* ------------------------------------------------------------- watch-only */

/** SLIP-132 prefixes map to a type; plain xpub/tpub need the type said. */
const SLIP132: Record<string, { test: boolean; type: AddressType }> = {
  xpub: { test: false, type: "p2pkh" },
  zpub: { test: false, type: "p2wpkh" },
  tpub: { test: true, type: "p2pkh" },
  vpub: { test: true, type: "p2wpkh" },
};

/** An account's public node from an extended public key (xpub/tpub/zpub/vpub), re-tagged to the network's version. */
export function publicAccount(xpub: string, network: Network, typeHint?: AddressType): { node: HDKey; type: AddressType; xpub: string } {
  const trimmed = xpub.trim();
  const prefix = trimmed.slice(0, 4);
  const known = SLIP132[prefix];
  if (!known) throw new Error("Not an extended public key (expected xpub, zpub, tpub or vpub).");
  if (known.test !== isTestNetwork(network)) throw new Error(known.test ? "That key is for a test network, not mainnet." : "That key is for mainnet, not a test network.");
  const raw = base58check(sha256).decode(trimmed);
  const retagged = new Uint8Array(raw);
  const v = NETWORKS[network].versions.public;
  retagged.set([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255], 0);
  const serialized = base58check(sha256).encode(retagged);
  const node = HDKey.fromExtendedKey(serialized, NETWORKS[network].versions);
  const type = typeHint ?? (prefix === "zpub" || prefix === "vpub" ? "p2wpkh" : known.type);
  return { node, type, xpub: serialized };
}

/* ------------------------------------------------------------ addresses */

export function isValidAddress(address: string, network: Network): boolean {
  try {
    Address(NETWORKS[network].net).decode(address.trim());
    return true;
  } catch {
    return false;
  }
}

/** The type of an address, or "other" (P2SH, multisig, unknown). */
export function addressTypeOf(address: string, network: Network): AddressType | "other" | null {
  try {
    const d = Address(NETWORKS[network].net).decode(address.trim());
    return d.type === "pkh" ? "p2pkh" : d.type === "wpkh" ? "p2wpkh" : d.type === "tr" ? "p2tr" : "other";
  } catch {
    return null;
  }
}

export function addressScript(address: string, network: Network): Uint8Array {
  return OutScript.encode(Address(NETWORKS[network].net).decode(address.trim()));
}

/* ----------------------------------------------------------------- export */

export const privateKeyHex = (priv: Uint8Array) => bytesToHex(priv);
export const privateKeyWif = (priv: Uint8Array, network: Network) => WIF(NETWORKS[network].net).encode(priv);
export const scriptHex = (script: Uint8Array) => bytesToHex(script);
export { bytesToHex, hexToBytes };
