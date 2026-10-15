/**
 * The vault: wallet secrets at rest, encrypted with a password through Web Crypto — PBKDF2-SHA256 (600,000
 * rounds) to a 256-bit key, AES-GCM with a fresh IV per write. The envelope is plain JSON, so it can be exported
 * and imported as a file. Nothing here is Bitcoin-specific.
 */
export interface Envelope {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iter: number;
  salt: string;
  iv: string;
  ct: string;
}

export const VAULT_ITERATIONS = 600_000;

const b64 = {
  encode: (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)),
  decode: (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)),
};
const subtle = () => globalThis.crypto.subtle;

export async function deriveKey(password: string, salt: Uint8Array, iter: number): Promise<CryptoKey> {
  const material = await subtle().importKey("raw", new TextEncoder().encode(password.normalize("NFKC")), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: iter }, material, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

export async function encryptJson(value: unknown, password: string, iter = VAULT_ITERATIONS): Promise<Envelope> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, iter);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { v: 1, kdf: "PBKDF2-SHA256", iter, salt: b64.encode(salt), iv: b64.encode(iv), ct: b64.encode(new Uint8Array(ct)) };
}

/** Throws on a wrong password or a tampered envelope. */
export async function decryptJson<T>(env: Envelope, password: string): Promise<T> {
  const key = await deriveKey(password, b64.decode(env.salt), env.iter);
  let plain: ArrayBuffer;
  try {
    plain = await subtle().decrypt({ name: "AES-GCM", iv: b64.decode(env.iv) as BufferSource }, key, b64.decode(env.ct) as BufferSource);
  } catch {
    throw new Error("Wrong password.");
  }
  return JSON.parse(new TextDecoder().decode(plain)) as T;
}

export function isEnvelope(x: unknown): x is Envelope {
  const e = x as Envelope | null;
  return !!e && typeof e === "object" && e.v === 1 && e.kdf === "PBKDF2-SHA256" && typeof e.iter === "number" && typeof e.salt === "string" && typeof e.iv === "string" && typeof e.ct === "string";
}
