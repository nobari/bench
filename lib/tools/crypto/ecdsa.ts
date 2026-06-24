/**
 * ECDSA sign & verify helpers built on Web Crypto (`SubtleCrypto`).
 *
 * SSR-safe: nothing touches `window`/`document` at module scope and all
 * functions are async, reading `globalThis.crypto.subtle` at call time (so this
 * module can be imported in server contexts without executing browser-only code).
 */

export type EcdsaCurve = "P-256" | "P-384" | "P-521";
export type EcdsaHash = "SHA-256" | "SHA-384" | "SHA-512";

export const CURVES: EcdsaCurve[] = ["P-256", "P-384", "P-521"];
export const HASHES: EcdsaHash[] = ["SHA-256", "SHA-384", "SHA-512"];

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) throw new Error("Web Crypto (SubtleCrypto) is unavailable in this environment.");
  return c.subtle;
}

/* ---- base64 <-> ArrayBuffer ---------------------------------------------- */

export function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function base64ToBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64.trim());
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function pretty(jwk: JsonWebKey): string {
  return JSON.stringify(jwk, null, 2);
}

/* ---- key generation ------------------------------------------------------ */

export interface GeneratedKeyPair {
  /** Public key as pretty-printed JWK JSON. */
  publicJwk: string;
  /** Private key as pretty-printed JWK JSON. */
  privateJwk: string;
  /** Public key as base64 (SPKI / DER). */
  publicSpkiBase64: string;
  /** Private key as base64 (PKCS8 / DER). */
  privatePkcs8Base64: string;
}

/** Generate an extractable ECDSA key pair on `curve`, exported as JWK + base64. */
export async function generateKeyPair(curve: EcdsaCurve): Promise<GeneratedKeyPair> {
  const s = subtle();
  const pair = (await s.generateKey(
    { name: "ECDSA", namedCurve: curve },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;

  const [publicJwk, privateJwk, publicSpki, privatePkcs8] = await Promise.all([
    s.exportKey("jwk", pair.publicKey),
    s.exportKey("jwk", pair.privateKey),
    s.exportKey("spki", pair.publicKey),
    s.exportKey("pkcs8", pair.privateKey),
  ]);

  return {
    publicJwk: pretty(publicJwk),
    privateJwk: pretty(privateJwk),
    publicSpkiBase64: bufferToBase64(publicSpki),
    privatePkcs8Base64: bufferToBase64(privatePkcs8),
  };
}

/* ---- import helpers ------------------------------------------------------ */

function parseJwk(jwk: string): JsonWebKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jwk);
  } catch {
    throw new Error("Key is not valid JSON. Paste a JWK key.");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Key must be a JWK object.");
  return parsed as JsonWebKey;
}

async function importPrivateKey(jwk: string, curve: EcdsaCurve): Promise<CryptoKey> {
  return subtle().importKey(
    "jwk",
    parseJwk(jwk),
    { name: "ECDSA", namedCurve: curve },
    false,
    ["sign"],
  );
}

async function importPublicKey(jwk: string, curve: EcdsaCurve): Promise<CryptoKey> {
  return subtle().importKey(
    "jwk",
    parseJwk(jwk),
    { name: "ECDSA", namedCurve: curve },
    false,
    ["verify"],
  );
}

/* ---- sign / verify ------------------------------------------------------- */

/** Sign `message` with a private JWK; returns the signature as base64. */
export async function sign(
  privateJwk: string,
  message: string,
  curve: EcdsaCurve,
  hash: EcdsaHash,
): Promise<string> {
  const key = await importPrivateKey(privateJwk, curve);
  const data = new TextEncoder().encode(message);
  const sig = await subtle().sign({ name: "ECDSA", hash }, key, data);
  return bufferToBase64(sig);
}

/** Verify a base64 `signatureBase64` over `message` using a public JWK. */
export async function verify(
  publicJwk: string,
  message: string,
  signatureBase64: string,
  curve: EcdsaCurve,
  hash: EcdsaHash,
): Promise<boolean> {
  const key = await importPublicKey(publicJwk, curve);
  const data = new TextEncoder().encode(message);
  const sig = base64ToBuffer(signatureBase64);
  return subtle().verify({ name: "ECDSA", hash }, key, sig, data);
}
