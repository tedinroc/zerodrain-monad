import {
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  type Account,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ZERO_DRAIN_VAULT_ABI } from "../../src/lib/abi";

export { ZERO_DRAIN_VAULT_ABI };

export interface Env {
  NEXT_PUBLIC_VAULT_ADDRESS?: string;
  DEPLOYER_PRIVATE_KEY?: string;
  SENTINEL_PRIVATE_KEY?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
}

export const DRAINER_ADDRESS = "0xdeadbeef0000000000000000000000000000bad1" as const;

export const CLEAN_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(self):integrity=verified";

export const HIJACKED_MANIFEST_SOURCE =
  "zerodrain-monad-staking-ui:v1.0.0:action=withdraw(0xdeadbeef0000000000000000000000000000bad1):DNS_HIJACKED_DRAINER";

export const MONAD_TESTNET_RPCS = [
  "https://testnet-rpc.monad.xyz",
  "https://rpc-testnet.monadinfra.com",
  "https://rpc.ankr.com/monad_testnet",
] as const;

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [...MONAD_TESTNET_RPCS] },
    public: { http: [...MONAD_TESTNET_RPCS] },
  },
  testnet: true,
});

export function getVaultAddress(env: Env): Address {
  return (env.NEXT_PUBLIC_VAULT_ADDRESS || "0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4") as Address;
}

export function getPublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: fallback(
      MONAD_TESTNET_RPCS.map((url) =>
        http(url, { retryCount: 2, retryDelay: 250, timeout: 8_000 })
      ),
      { rank: false }
    ),
  });
}

export function getServerAccount(
  env: Env,
  key: "DEPLOYER_PRIVATE_KEY" | "SENTINEL_PRIVATE_KEY"
): Account {
  const pk = env[key];
  if (!pk || !pk.startsWith("0x")) {
    throw new Error(`Missing Cloudflare Pages secret ${key}`);
  }
  return privateKeyToAccount(pk as Hex);
}

export async function sha256Hex(payload: string): Promise<Hex> {
  const bytes = new TextEncoder().encode(payload);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

export async function buildManifestPayload(hijacked: boolean) {
  const source = hijacked ? HIJACKED_MANIFEST_SOURCE : CLEAN_MANIFEST_SOURCE;
  const sriHash = await sha256Hex(source);
  return {
    hijacked,
    version: "v1.0.0",
    dnsProvider: hijacked
      ? "name.com (HIJACKED A-RECORD -> 185.220.x.x)"
      : "cloudflare-dnssec (VERIFIED)",
    bundleName: hijacked ? "staking-bundle.4f9a.injected.js" : "staking-bundle.8f7d.clean.js",
    source,
    sriHash,
    withdrawRecipientOverride: hijacked ? DRAINER_ADDRESS : null,
    checkedAt: new Date().toISOString(),
  };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function sendSignedTxSync(params: {
  account: Account;
  to: Address;
  data: Hex;
  value?: bigint;
}): Promise<{
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  latencyMs: number;
  usedSyncRpc: boolean;
}> {
  const publicClient = getPublicClient();
  const walletClient = createWalletClient({
    account: params.account,
    chain: monadTestnet,
    transport: fallback(
      MONAD_TESTNET_RPCS.map((url) => http(url, { retryCount: 2, timeout: 10_000 })),
      { rank: false }
    ),
  });

  const [nonce, gasPrice, estimatedGas] = await Promise.all([
    publicClient.getTransactionCount({ address: params.account.address, blockTag: "pending" }),
    publicClient.getGasPrice(),
    publicClient.estimateGas({
      account: params.account.address,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
    }),
  ]);

  const gasLimit = estimatedGas + estimatedGas / 10n + 2_000n;
  const minGasPrice = 110_000_000_000n;
  const maxFeePerGas = gasPrice > minGasPrice ? gasPrice + 10_000_000_000n : minGasPrice;
  const maxPriorityFeePerGas = 2_000_000_000n;

  const serialized = await walletClient.signTransaction({
    account: params.account,
    chain: monadTestnet,
    to: params.to,
    data: params.data,
    value: params.value ?? 0n,
    nonce,
    gas: gasLimit,
    maxFeePerGas,
    maxPriorityFeePerGas,
  });

  const tBroadcast = Date.now();

  for (const rpcUrl of MONAD_TESTNET_RPCS.slice(0, 2)) {
    try {
      const rpcRes = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_sendRawTransactionSync",
          params: [serialized, 4000],
        }),
        signal: AbortSignal.timeout(6000),
      });
      const json = (await rpcRes.json()) as {
        result?: {
          transactionHash?: Hex;
          blockNumber?: Hex;
          gasUsed?: Hex;
          status?: Hex;
        };
      };
      if (json.result?.transactionHash) {
        if (json.result.status === "0x0") {
          throw new Error("Transaction reverted on-chain");
        }
        return {
          hash: json.result.transactionHash,
          blockNumber: BigInt(json.result.blockNumber || "0x0"),
          gasUsed: BigInt(json.result.gasUsed || "0x0"),
          latencyMs: Date.now() - tBroadcast,
          usedSyncRpc: true,
        };
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("reverted")) throw err;
    }
  }

  const hash = await publicClient.sendRawTransaction({ serializedTransaction: serialized });
  const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 250,
    timeout: 20_000,
  });
  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain");
  }
  return {
    hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    latencyMs: Date.now() - tBroadcast,
    usedSyncRpc: false,
  };
}

export async function traceCallOnMonad(params: {
  from: Address;
  to: Address;
  data: Hex;
}): Promise<{
  method: "debug_traceCall (callTracer)" | "eth_call (stateOverride)";
  latencyMs: number;
  traceResult: Record<string, unknown>;
}> {
  const t0 = Date.now();
  for (const rpcUrl of MONAD_TESTNET_RPCS.slice(0, 2)) {
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "debug_traceCall",
          params: [
            { from: params.from, to: params.to, data: params.data },
            "latest",
            { tracer: "callTracer" },
          ],
        }),
        signal: AbortSignal.timeout(5000),
      });
      const json = (await res.json()) as { result?: Record<string, unknown> };
      if (json.result) {
        return {
          method: "debug_traceCall (callTracer)",
          latencyMs: Date.now() - t0,
          traceResult: json.result,
        };
      }
    } catch {
      // fallback
    }
  }

  const publicClient = getPublicClient();
  let callOutcome = "WOULD_SUCCEED";
  try {
    await publicClient.call({ account: params.from, to: params.to, data: params.data });
  } catch (err) {
    callOutcome = `REVERTED: ${err instanceof Error ? err.message.slice(0, 120) : "reverted"}`;
  }
  return {
    method: "eth_call (stateOverride)",
    latencyMs: Date.now() - t0,
    traceResult: { outcome: callOutcome },
  };
}
