import crypto from "crypto";

export const DRAINER_ADDRESS = "0xdeadbeef0000000000000000000000000000bad1" as const;

export const CLEAN_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(self):integrity=verified";

export const HIJACKED_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(0xdeadbeef0000000000000000000000000000bad1):DNS_HIJACKED_DRAINER";

export function computeSha256Hex(payload: string): `0x${string}` {
  const hash = crypto.createHash("sha256").update(payload, "utf8").digest("hex");
  return `0x${hash}`;
}

export function buildManifestPayload(hijacked: boolean) {
  const source = hijacked ? HIJACKED_MANIFEST_SOURCE : CLEAN_MANIFEST_SOURCE;
  const sriHash = computeSha256Hex(source);
  return {
    hijacked,
    version: "v1.0.0",
    dnsProvider: hijacked ? "name.com (HIJACKED A-RECORD -> 185.220.x.x)" : "cloudflare-dnssec (VERIFIED)",
    bundleName: hijacked ? "staking-bundle.4f9a.injected.js" : "staking-bundle.8f7d.clean.js",
    source,
    sriHash,
    withdrawRecipientOverride: hijacked ? DRAINER_ADDRESS : null,
    checkedAt: new Date().toISOString(),
  };
}
