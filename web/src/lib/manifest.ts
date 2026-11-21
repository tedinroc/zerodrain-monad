export const DRAINER_ADDRESS = "0xdeadbeef0000000000000000000000000000bad1" as const;

export const CLEAN_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(self):integrity=verified";

export const HIJACKED_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(0xdeadbeef0000000000000000000000000000bad1):DNS_HIJACKED_DRAINER";
