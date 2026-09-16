import { secp256k1 } from "@noble/curves/secp256k1.js";
import { HDKey } from "@scure/bip32";
import {
  generateMnemonic,
  mnemonicToSeedSync,
  validateMnemonic,
} from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";
import { keccak256 } from "js-sha3";

/**
 * Ethereum wallet helpers — BIP39 mnemonics, BIP44 HD derivation
 * (m/44'/60'/0'/0/i) and EIP-55 checksummed addresses. All deterministic
 * except mnemonic / random-key generation, which use a CSPRNG.
 */

const ETH_BASE_PATH = "m/44'/60'/0'/0";

function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/** Apply the EIP-55 mixed-case checksum to a 40-char lowercase hex address. */
function eip55(addr40: string): string {
  const h = keccak256(addr40);
  let out = "0x";
  for (let i = 0; i < 40; i++) {
    out += parseInt(h[i], 16) >= 8 ? addr40[i].toUpperCase() : addr40[i];
  }
  return out;
}

export function addressFromPrivateKey(priv: Uint8Array): string {
  const pub = secp256k1.getPublicKey(priv, false).slice(1); // drop 0x04 prefix
  const addr = keccak256(pub).slice(-40);
  return eip55(addr);
}

export interface Account {
  index: number;
  path: string;
  address: string;
  privateKey: string; // 0x-prefixed
  publicKey: string; // 0x-prefixed, uncompressed
}

export function accountFromPrivateKey(
  priv: Uint8Array,
  index = 0,
  path = "—",
): Account {
  return {
    index,
    path,
    address: addressFromPrivateKey(priv),
    privateKey: "0x" + toHex(priv),
    publicKey: "0x" + toHex(secp256k1.getPublicKey(priv, false)),
  };
}

export function newMnemonic(words: 12 | 24): string {
  return generateMnemonic(wordlist, words === 24 ? 256 : 128);
}

function normalize(m: string): string {
  return m.trim().toLowerCase().replace(/\s+/g, " ");
}

export function isValidMnemonic(m: string): boolean {
  try {
    return validateMnemonic(normalize(m), wordlist);
  } catch {
    return false;
  }
}

/** Deterministically derive `count` Ethereum accounts from a mnemonic. */
export function deriveAccounts(mnemonic: string, count: number): Account[] {
  const seed = mnemonicToSeedSync(normalize(mnemonic));
  const root = HDKey.fromMasterSeed(seed);
  const out: Account[] = [];
  for (let i = 0; i < count; i++) {
    const path = `${ETH_BASE_PATH}/${i}`;
    const node = root.derive(path);
    if (!node.privateKey) continue;
    out.push(accountFromPrivateKey(node.privateKey, i, path));
  }
  return out;
}

/** A standalone random account (no mnemonic). */
export function randomAccount(): Account {
  return accountFromPrivateKey(secp256k1.utils.randomSecretKey(), 0, "random key");
}
