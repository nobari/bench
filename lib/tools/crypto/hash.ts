import { md5 } from "js-md5";
import { sha3_256, sha3_512, keccak256 } from "js-sha3";

/** Hash algorithms offered by the Hash Generator. */
export interface HashAlgo {
  id: string;
  label: string;
  /** Web Crypto subtle algorithm, when applicable. */
  subtle?: AlgorithmIdentifier;
  /** Synchronous JS implementation, when Web Crypto can't do it. */
  sync?: (text: string) => string;
}

export const HASH_ALGOS: HashAlgo[] = [
  { id: "md5", label: "MD5", sync: (t) => md5(t) },
  { id: "sha1", label: "SHA-1", subtle: "SHA-1" },
  { id: "sha256", label: "SHA-256", subtle: "SHA-256" },
  { id: "sha384", label: "SHA-384", subtle: "SHA-384" },
  { id: "sha512", label: "SHA-512", subtle: "SHA-512" },
  { id: "sha3-256", label: "SHA3-256", sync: (t) => sha3_256(t) },
  { id: "sha3-512", label: "SHA3-512", sync: (t) => sha3_512(t) },
  { id: "keccak-256", label: "Keccak-256", sync: (t) => keccak256(t) },
];

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface HashResult {
  id: string;
  label: string;
  value: string;
}

/** Compute every supported hash of `text` (empty input → empty results). */
export async function computeHashes(text: string): Promise<HashResult[]> {
  const data = new TextEncoder().encode(text);
  return Promise.all(
    HASH_ALGOS.map(async (a) => {
      let value = "";
      if (a.sync) value = a.sync(text);
      else if (a.subtle)
        value = toHex(await crypto.subtle.digest(a.subtle, data));
      return { id: a.id, label: a.label, value };
    }),
  );
}
