"use client";

import { WebAuthnP256 } from "ox";
import type { Hex } from "viem";

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;

// Only public WebAuthn credential ID + public key coordinates (NEVER private keys) are stored in localStorage.
const STORAGE_WEBAUTHN_KEY = "zerodrain_webauthn_pub_v2";
const IDB_NAME = "zerodrain_nonextractable_keys";
const IDB_STORE = "p256_keys";
const IDB_KEY_ID = "demo_fallback_p256_v2";

export type PasskeyMode = "webauthn" | "webcrypto";

export interface StoredWebAuthnCredential {
  id: string;
  qx: Hex;
  qy: Hex;
  label: string;
}

/**
 * Non-extractable WebCrypto handle stored ONLY in IndexedDB (private key bytes cannot be read or exported by JS).
 * Intended strictly as a demo fallback for environments without biometric WebAuthn hardware.
 */
export interface NonExtractableWebCryptoHandle {
  privateKey: CryptoKey; // extractable === false
  qx: Hex;
  qy: Hex;
}

function toBytes32Hex(val: bigint): Hex {
  return `0x${val.toString(16).padStart(64, "0")}`;
}

function normalizeLowS(s: bigint): bigint {
  return s > P256_HALF_N ? P256_N - s : s;
}

function base64UrlToBigInt(b64url: string): bigint {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  let hex = "";
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex);
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return BigInt("0x" + hex);
}

/**
 * Exact TLV ASN.1 DER parser for ECDSA P-256 signatures (handles 31/32/33-byte r & s cleanly).
 */
function parseDerSignatureExact(der: Uint8Array): { r: bigint; s: bigint } {
  if (der[0] !== 0x30) throw new Error("Invalid ASN.1 DER sequence");
  let offset = 2;
  if (der[1] & 0x80) {
    offset = 2 + (der[1] & 0x7f);
  }
  if (der[offset] !== 0x02) throw new Error("Invalid ASN.1 integer for r");
  const rLen = der[offset + 1];
  const rBytes = der.slice(offset + 2, offset + 2 + rLen);
  offset = offset + 2 + rLen;

  if (der[offset] !== 0x02) throw new Error("Invalid ASN.1 integer for s");
  const sLen = der[offset + 1];
  const sBytes = der.slice(offset + 2, offset + 2 + sLen);

  return {
    r: bytesToBigInt(rBytes),
    s: normalizeLowS(bytesToBigInt(sBytes)),
  };
}

function openKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function saveNonExtractableToIdb(handle: NonExtractableWebCryptoHandle): Promise<void> {
  const db = await openKeyDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    tx.objectStore(IDB_STORE).put(handle, IDB_KEY_ID);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadStoredWebCrypto(): Promise<NonExtractableWebCryptoHandle | null> {
  if (typeof window === "undefined" || !("indexedDB" in window)) return null;
  try {
    // Scrub any legacy localStorage entry from v1 if present
    localStorage.removeItem("zerodrain_webcrypto_jwk_v1");
    const db = await openKeyDb();
    const record = await new Promise<NonExtractableWebCryptoHandle | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(IDB_KEY_ID);
      req.onsuccess = () => resolve(req.result as NonExtractableWebCryptoHandle | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (record && record.privateKey && record.privateKey.extractable === false) {
      return record;
    }
    return null;
  } catch {
    return null;
  }
}

export function loadStoredWebAuthn(): StoredWebAuthnCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_WEBAUTHN_KEY);
    return raw ? (JSON.parse(raw) as StoredWebAuthnCredential) : null;
  } catch {
    return null;
  }
}

/**
 * Plan A (Production): Hardware WebAuthn P-256 Passkey (Apple Secure Enclave / Android Keystore).
 */
export async function createHardwareWebAuthnPasskey(
  userLabel: string
): Promise<StoredWebAuthnCredential> {
  const cred = await WebAuthnP256.createCredential({
    name: `ZeroDrain (${userLabel.slice(0, 8)})`,
  });

  const stored: StoredWebAuthnCredential = {
    id: cred.id,
    qx: toBytes32Hex(cred.publicKey.x),
    qy: toBytes32Hex(cred.publicKey.y),
    label: userLabel,
  };
  localStorage.setItem(STORAGE_WEBAUTHN_KEY, JSON.stringify(stored));
  return stored;
}

/**
 * Plan A (Production): Signs on-chain recovery challenge via TouchID / FaceID WebAuthn.
 */
export async function signHardwareWebAuthnChallenge(params: {
  credentialId: string;
  challenge: Hex;
}): Promise<{
  r: Hex;
  s: Hex;
  challengeIndex: string;
  typeIndex: string;
  authenticatorData: Hex;
  clientDataJSON: string;
}> {
  const { metadata, signature, raw } = await WebAuthnP256.sign({
    credentialId: params.credentialId,
    challenge: params.challenge,
  });

  let rBig = signature.r;
  let sBig = normalizeLowS(signature.s);
  const rawResp = (raw as { response?: { signature?: ArrayBuffer } } | undefined)?.response;
  if (rawResp?.signature) {
    const parsed = parseDerSignatureExact(new Uint8Array(rawResp.signature));
    rBig = parsed.r;
    sBig = parsed.s;
  }

  return {
    r: toBytes32Hex(rBig),
    s: toBytes32Hex(sBig),
    challengeIndex: metadata.challengeIndex.toString(),
    typeIndex: metadata.typeIndex.toString(),
    authenticatorData: metadata.authenticatorData,
    clientDataJSON: metadata.clientDataJSON,
  };
}

/**
 * Plan B (Demo Fallback Only): Generates a NON-EXTRACTABLE (extractable: false) WebCrypto ECDSA P-256 key.
 * Private key bytes are NEVER exported or written to localStorage; only the opaque CryptoKey handle is stored in IndexedDB.
 */
export async function createWebCryptoP256Key(): Promise<NonExtractableWebCryptoHandle> {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false, // NON-EXTRACTABLE: JS cannot export raw private key bytes!
    ["sign", "verify"]
  );
  const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  if (!publicJwk.x || !publicJwk.y) {
    throw new Error("Failed to export P-256 public coordinates");
  }
  const handle: NonExtractableWebCryptoHandle = {
    privateKey: keyPair.privateKey,
    qx: toBytes32Hex(base64UrlToBigInt(publicJwk.x)),
    qy: toBytes32Hex(base64UrlToBigInt(publicJwk.y)),
  };
  await saveNonExtractableToIdb(handle);
  return handle;
}

/**
 * Plan B (Demo Fallback Only): Signs 32-byte challenge using the non-extractable CryptoKey handle.
 */
export async function signWebCryptoP256Challenge(params: {
  privateKey: CryptoKey;
  challenge: Hex;
}): Promise<{ r: Hex; s: Hex }> {
  const challengeBytes = hexToBytes(params.challenge);
  const rawSig = new Uint8Array(
    await window.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      params.privateKey,
      challengeBytes as BufferSource
    )
  );
  if (rawSig.length !== 64) {
    throw new Error(`Unexpected WebCrypto P-256 signature length: ${rawSig.length}`);
  }
  const r = bytesToBigInt(rawSig.slice(0, 32));
  const s = normalizeLowS(bytesToBigInt(rawSig.slice(32, 64)));
  return { r: toBytes32Hex(r), s: toBytes32Hex(s) };
}
