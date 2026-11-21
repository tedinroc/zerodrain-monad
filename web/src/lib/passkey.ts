"use client";

import { WebAuthnP256 } from "ox";
import type { Hex } from "viem";

const P256_N = 0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;
const P256_HALF_N = 0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8n;

const STORAGE_WEBAUTHN_KEY = "zerodrain_webauthn_cred_v1";
const STORAGE_WEBCRYPTO_KEY = "zerodrain_webcrypto_jwk_v1";

export type PasskeyMode = "webauthn" | "webcrypto";

export interface StoredWebAuthnCredential {
  id: string;
  qx: Hex;
  qy: Hex;
  label: string;
}

export interface StoredWebCryptoCredential {
  privateJwk: JsonWebKey;
  publicJwk: JsonWebKey;
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

export function loadStoredWebAuthn(): StoredWebAuthnCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_WEBAUTHN_KEY);
    return raw ? (JSON.parse(raw) as StoredWebAuthnCredential) : null;
  } catch {
    return null;
  }
}

export function loadStoredWebCrypto(): StoredWebCryptoCredential | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_WEBCRYPTO_KEY);
    return raw ? (JSON.parse(raw) as StoredWebCryptoCredential) : null;
  } catch {
    return null;
  }
}

/**
 * Plan A: Creates a real hardware WebAuthn P-256 Passkey (TouchID / FaceID / Passkey).
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
 * Plan A: Signs an on-chain recovery challenge with real TouchID / FaceID WebAuthn.
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
  const { metadata, signature } = await WebAuthnP256.sign({
    credentialId: params.credentialId,
    challenge: params.challenge,
  });

  const normalizedS = normalizeLowS(signature.s);
  return {
    r: toBytes32Hex(signature.r),
    s: toBytes32Hex(normalizedS),
    challengeIndex: metadata.challengeIndex.toString(),
    typeIndex: metadata.typeIndex.toString(),
    authenticatorData: metadata.authenticatorData,
    clientDataJSON: metadata.clientDataJSON,
  };
}

/**
 * Plan B Fallback: Pure browser WebCrypto ECDSA P-256 keypair verified by Monad 0x0100.
 */
export async function createWebCryptoP256Key(): Promise<StoredWebCryptoCredential> {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"]
  );
  const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const privateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  if (!publicJwk.x || !publicJwk.y) {
    throw new Error("Failed to export P-256 public coordinates");
  }
  const stored: StoredWebCryptoCredential = {
    privateJwk,
    publicJwk,
    qx: toBytes32Hex(base64UrlToBigInt(publicJwk.x)),
    qy: toBytes32Hex(base64UrlToBigInt(publicJwk.y)),
  };
  localStorage.setItem(STORAGE_WEBCRYPTO_KEY, JSON.stringify(stored));
  return stored;
}

/**
 * Plan B Fallback: Signs 32-byte challenge with SHA-256 ECDSA P-256 (IEEE P1363 r||s).
 */
export async function signWebCryptoP256Challenge(params: {
  privateJwk: JsonWebKey;
  challenge: Hex;
}): Promise<{ r: Hex; s: Hex }> {
  const privateKey = await window.crypto.subtle.importKey(
    "jwk",
    params.privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const challengeBytes = hexToBytes(params.challenge);
  const rawSig = new Uint8Array(
    await window.crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      privateKey,
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
