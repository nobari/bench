/**
 * JWT decode / verify / sign — all client-side.
 *
 * Decoding is pure. Verification and signing use WebCrypto: HMAC (HS*),
 * RSASSA-PKCS1-v1_5 (RS*), RSA-PSS (PS*), ECDSA (ES*) and Ed25519 (EdDSA).
 * Keys are accepted as PEM (SPKI public / PKCS#8 private), a JWK, or a JWKS
 * (the key is picked by the token's `kid`).
 */

export type Alg =
  | "HS256" | "HS384" | "HS512"
  | "RS256" | "RS384" | "RS512"
  | "PS256" | "PS384" | "PS512"
  | "ES256" | "ES384" | "ES512"
  | "EdDSA" | "none";

export const ALGS: Alg[] = [
  "HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA",
];

export function isSymmetric(alg: string): boolean {
  return alg.startsWith("HS");
}

/* ----------------------------------------------------------------- base64url */

export function base64UrlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function base64UrlEncode(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function utf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

/* -------------------------------------------------------------------- decode */

export interface JwtParts {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  /** Raw base64url segments as they appear in the token. */
  raw: { header: string; payload: string; signature: string };
  signature: Uint8Array;
  alg: string;
}

export type Decoded = { ok: true; value: JwtParts } | { ok: false; error: string };

export function decodeJwt(token: string): Decoded {
  const t = token.trim().replace(/^Bearer\s+/i, "");
  if (!t) return { ok: false, error: "empty" };
  const parts = t.split(".");
  if (parts.length !== 3)
    return { ok: false, error: `A JWT has three dot-separated parts (header.payload.signature); this has ${parts.length}.` };
  if (!parts.every((p) => /^[A-Za-z0-9_-]*$/.test(p)))
    return { ok: false, error: "Parts must be base64url (letters, digits, - and _) — check for stray whitespace or padding." };

  let header: unknown, payload: unknown;
  try {
    header = JSON.parse(utf8(base64UrlDecode(parts[0])));
  } catch {
    return { ok: false, error: "The header isn't base64url-encoded JSON." };
  }
  try {
    payload = JSON.parse(utf8(base64UrlDecode(parts[1])));
  } catch {
    return { ok: false, error: "The payload isn't base64url-encoded JSON." };
  }
  if (!header || typeof header !== "object" || Array.isArray(header)) return { ok: false, error: "The header must be a JSON object." };
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "The payload must be a JSON object." };
  const h = header as Record<string, unknown>;
  return {
    ok: true,
    value: {
      header: h,
      payload: payload as Record<string, unknown>,
      raw: { header: parts[0], payload: parts[1], signature: parts[2] },
      signature: base64UrlDecode(parts[2]),
      alg: typeof h.alg === "string" ? h.alg : "",
    },
  };
}

/* -------------------------------------------------------------------- claims */

export interface ClaimInfo {
  key: string;
  label: string;
  value: unknown;
  /** Present for the time claims (exp, nbf, iat, auth_time). */
  date?: Date;
  relative?: string;
  /** Meaning of the time relative to now. */
  status?: "ok" | "expired" | "future";
}

const CLAIM_LABELS: Record<string, string> = {
  iss: "Issuer",
  sub: "Subject",
  aud: "Audience",
  exp: "Expires",
  nbf: "Not before",
  iat: "Issued at",
  jti: "Token ID",
  auth_time: "Authenticated at",
  azp: "Authorized party",
  scope: "Scope",
  scp: "Scopes",
  roles: "Roles",
  email: "Email",
  name: "Name",
  nonce: "Nonce",
  sid: "Session ID",
  client_id: "Client ID",
};
const TIME_CLAIMS = new Set(["exp", "nbf", "iat", "auth_time"]);

export function relativeTime(date: Date, now: number): string {
  const diff = date.getTime() - now;
  const abs = Math.abs(diff);
  const units: [number, string][] = [
    [365 * 864e5, "y"], [30 * 864e5, "mo"], [7 * 864e5, "w"], [864e5, "d"], [36e5, "h"], [6e4, "min"], [1e3, "s"],
  ];
  const parts: string[] = [];
  let rest = abs;
  for (const [ms, label] of units) {
    if (rest >= ms && parts.length < 2) {
      const n = Math.floor(rest / ms);
      parts.push(`${n} ${label}`);
      rest -= n * ms;
    }
  }
  if (!parts.length) return diff >= 0 ? "now" : "just now";
  return diff >= 0 ? `in ${parts.join(" ")}` : `${parts.join(" ")} ago`;
}

export function describeClaims(payload: Record<string, unknown>, now: number): ClaimInfo[] {
  return Object.entries(payload).map(([key, value]) => {
    const info: ClaimInfo = { key, label: CLAIM_LABELS[key] ?? key, value };
    if (TIME_CLAIMS.has(key) && typeof value === "number" && Number.isFinite(value)) {
      const date = new Date(value * 1000);
      info.date = date;
      info.relative = relativeTime(date, now);
      if (key === "exp") info.status = date.getTime() <= now ? "expired" : "ok";
      else if (key === "nbf") info.status = date.getTime() > now ? "future" : "ok";
      else info.status = date.getTime() > now + 6e4 ? "future" : "ok";
    }
    return info;
  });
}

export type TokenTime = { state: "valid" | "expired" | "not-yet-valid" | "no-exp"; text: string };

export function tokenTime(payload: Record<string, unknown>, now: number): TokenTime {
  const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
  const nbf = typeof payload.nbf === "number" ? payload.nbf * 1000 : null;
  if (nbf !== null && nbf > now) return { state: "not-yet-valid", text: `Not valid yet — becomes valid ${relativeTime(new Date(nbf), now)}` };
  if (exp === null) return { state: "no-exp", text: "No expiry (exp) claim" };
  if (exp <= now) return { state: "expired", text: `Expired ${relativeTime(new Date(exp), now)}` };
  return { state: "valid", text: `Expires ${relativeTime(new Date(exp), now)}` };
}

/* ---------------------------------------------------------------------- keys */

export interface KeyInput {
  /** HS*: the shared secret. */
  secret?: string;
  /** Interpret the secret as base64 / base64url instead of UTF-8 text. */
  secretIsBase64?: boolean;
  /** RS/PS/ES/EdDSA: PEM, JWK or JWKS text. */
  key?: string;
}

function pemToDer(pem: string): { label: string; der: ArrayBuffer } | null {
  const m = pem.match(/-----BEGIN ([A-Z0-9 ]+)-----([\s\S]*?)-----END \1-----/);
  if (!m) return null;
  const bin = atob(m[2].replace(/[^A-Za-z0-9+/=]/g, ""));
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) der[i] = bin.charCodeAt(i);
  return { label: m[1], der: der.buffer };
}

function algParams(alg: string): { importAlg: RsaHashedImportParams | EcKeyImportParams | Algorithm; signAlg: AlgorithmIdentifier | RsaPssParams | EcdsaParams } {
  const bits = alg.slice(2);
  const hash = `SHA-${bits}`;
  if (alg.startsWith("RS")) return { importAlg: { name: "RSASSA-PKCS1-v1_5", hash }, signAlg: { name: "RSASSA-PKCS1-v1_5" } };
  if (alg.startsWith("PS")) return { importAlg: { name: "RSA-PSS", hash }, signAlg: { name: "RSA-PSS", saltLength: Number(bits) / 8 } };
  if (alg.startsWith("ES")) {
    const curve = bits === "256" ? "P-256" : bits === "384" ? "P-384" : "P-521";
    return { importAlg: { name: "ECDSA", namedCurve: curve }, signAlg: { name: "ECDSA", hash } };
  }
  if (alg === "EdDSA") return { importAlg: { name: "Ed25519" }, signAlg: { name: "Ed25519" } };
  throw new Error(`Unsupported algorithm "${alg}".`);
}

function pickJwk(text: string, kid: string | undefined): JsonWebKey {
  const parsed = JSON.parse(text) as { keys?: JsonWebKey[] } & JsonWebKey;
  if (Array.isArray(parsed.keys)) {
    const keys = parsed.keys as (JsonWebKey & { kid?: string })[];
    const match = kid ? keys.find((k) => k.kid === kid) : undefined;
    if (kid && !match) throw new Error(`No key with kid "${kid}" in the JWKS.`);
    const jwk = match ?? keys[0];
    if (!jwk) throw new Error("The JWKS has no keys.");
    return jwk;
  }
  return parsed;
}

async function importAsymmetric(alg: string, keyText: string, usage: "verify" | "sign", kid?: string): Promise<CryptoKey> {
  const { importAlg } = algParams(alg);
  const text = keyText.trim();
  if (!text) throw new Error(usage === "verify" ? "Paste the public key (PEM, JWK or JWKS)." : "Paste the private key (PEM or JWK).");

  if (text.startsWith("{")) {
    const jwk: JsonWebKey = { ...pickJwk(text, kid) };
    if (usage === "sign" && !("d" in jwk)) throw new Error("This JWK is a public key; signing needs the private key (with a d parameter).");
    // WebCrypto rejects a JWK whose key_ops / alg disagree with the requested use;
    // the token header already told us the algorithm, so drop the hints.
    delete jwk.key_ops;
    delete jwk.alg;
    delete jwk.use;
    return crypto.subtle.importKey("jwk", jwk, importAlg, false, [usage]);
  }

  const pem = pemToDer(text);
  if (!pem) throw new Error("Unrecognised key format — use a PEM block, a JWK or a JWKS.");
  if (pem.label === "CERTIFICATE") throw new Error("That's an X.509 certificate. Extract its public key first (e.g. openssl x509 -pubkey -noout).");
  if (pem.label === "RSA PUBLIC KEY" || pem.label === "RSA PRIVATE KEY" || pem.label === "EC PRIVATE KEY")
    throw new Error(`"${pem.label}" is a PKCS#1/SEC1 block; convert it to ${usage === "verify" ? "SPKI (BEGIN PUBLIC KEY)" : "PKCS#8 (BEGIN PRIVATE KEY)"} with openssl pkey.`);
  if (usage === "verify") {
    if (pem.label !== "PUBLIC KEY") throw new Error(`Expected a public key (BEGIN PUBLIC KEY), got "${pem.label}".`);
    return crypto.subtle.importKey("spki", pem.der, importAlg, false, ["verify"]);
  }
  if (pem.label !== "PRIVATE KEY") throw new Error(`Expected a private key (BEGIN PRIVATE KEY), got "${pem.label}".`);
  return crypto.subtle.importKey("pkcs8", pem.der, importAlg, false, ["sign"]);
}

function secretBytes(input: KeyInput): Uint8Array {
  const s = input.secret ?? "";
  if (!s) throw new Error("Enter the shared secret.");
  return input.secretIsBase64 ? base64UrlDecode(s.replace(/\s+/g, "")) : new TextEncoder().encode(s);
}

async function importHmac(alg: string, input: KeyInput, usage: "verify" | "sign"): Promise<CryptoKey> {
  const raw = secretBytes(input);
  return crypto.subtle.importKey("raw", raw as BufferSource, { name: "HMAC", hash: `SHA-${alg.slice(2)}` }, false, [usage]);
}

/* -------------------------------------------------------------- verify / sign */

export type VerifyResult = { state: "valid" | "invalid" | "unsigned" | "error"; message: string };

export async function verifyJwt(token: string, input: KeyInput): Promise<VerifyResult> {
  const d = decodeJwt(token);
  if (!d.ok) return { state: "error", message: d.error };
  const { alg, raw, signature, header } = d.value;
  if (!alg || alg === "none") return { state: "unsigned", message: 'alg is "none" — the token carries no signature and must not be trusted.' };
  const data = new TextEncoder().encode(`${raw.header}.${raw.payload}`);
  try {
    let ok: boolean;
    if (isSymmetric(alg)) {
      const key = await importHmac(alg, input, "verify");
      ok = await crypto.subtle.verify("HMAC", key, signature as BufferSource, data);
    } else {
      const key = await importAsymmetric(alg, input.key ?? "", "verify", typeof header.kid === "string" ? header.kid : undefined);
      ok = await crypto.subtle.verify(algParams(alg).signAlg, key, signature as BufferSource, data);
    }
    return ok
      ? { state: "valid", message: `Signature verified with ${alg}.` }
      : { state: "invalid", message: `Signature does not match — wrong ${isSymmetric(alg) ? "secret" : "key"}, or the token was altered.` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { state: "error", message: /not supported|NotSupported|Unrecognized name/i.test(msg) ? `${alg} isn't supported by this browser's WebCrypto.` : msg };
  }
}

export async function signJwt(header: Record<string, unknown>, payload: Record<string, unknown>, input: KeyInput): Promise<string> {
  const alg = typeof header.alg === "string" ? header.alg : "";
  if (!alg || alg === "none") throw new Error('Set "alg" in the header to a signing algorithm (e.g. HS256).');
  const h = base64UrlEncode(JSON.stringify(header));
  const p = base64UrlEncode(JSON.stringify(payload));
  const data = new TextEncoder().encode(`${h}.${p}`);
  let sig: ArrayBuffer;
  if (isSymmetric(alg)) {
    const key = await importHmac(alg, input, "sign");
    sig = await crypto.subtle.sign("HMAC", key, data);
  } else {
    const key = await importAsymmetric(alg, input.key ?? "", "sign", typeof header.kid === "string" ? header.kid : undefined);
    sig = await crypto.subtle.sign(algParams(alg).signAlg, key, data);
  }
  return `${h}.${p}.${base64UrlEncode(new Uint8Array(sig))}`;
}

/** Export a WebCrypto key as PEM (for the built-in key generator). */
export async function exportPem(key: CryptoKey): Promise<string> {
  const fmt = key.type === "private" ? "pkcs8" : "spki";
  const der = new Uint8Array(await crypto.subtle.exportKey(fmt, key));
  let bin = "";
  for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]);
  const b64 = btoa(bin).replace(/(.{64})/g, "$1\n").trim();
  const label = key.type === "private" ? "PRIVATE KEY" : "PUBLIC KEY";
  return `-----BEGIN ${label}-----\n${b64}\n-----END ${label}-----`;
}

/** Generate a key pair suitable for `alg` and return both halves as PEM. */
export async function generateKeyPair(alg: string): Promise<{ publicKey: string; privateKey: string }> {
  const { importAlg } = algParams(alg);
  let params: RsaHashedKeyGenParams | EcKeyGenParams | Algorithm;
  if (alg.startsWith("RS") || alg.startsWith("PS"))
    params = { ...(importAlg as RsaHashedImportParams), modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) };
  else params = importAlg;
  const pair = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  return { publicKey: await exportPem(pair.publicKey), privateKey: await exportPem(pair.privateKey) };
}
