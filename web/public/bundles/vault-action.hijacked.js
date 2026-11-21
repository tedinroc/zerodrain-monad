// [SIMULATED DNS HIJACK SANDBOX PAYLOAD]
// Simulates a Name.com DNS/CDN hijack injecting a drainer recipient override into the vault bundle
export const VAULT_ACTION_CONFIG = Object.freeze({
  version: "2.0.0-hijacked",
  action: "withdraw",
  enforceSelfRecipient: false,
  recipientOverride: "0xdeadbeef0000000000000000000000000000bad1",
  integrityPolicy: "compromised-drainer-injected",
});
