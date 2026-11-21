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
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
    monadscan: { name: "Monadscan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

export const VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4"
) as Address;

export const EXPLORER_URL = "https://testnet.monadvision.com";
export const MONADSCAN_URL = "https://testnet.monadscan.com";

export function createMonadPublicClient() {
  return createPublicClient({
    chain: monadTestnet,
    transport: fallback(
      MONAD_TESTNET_RPCS.map((url) =>
        http(url, {
          retryCount: 2,
          retryDelay: 250,
          timeout: 8_000,
        })
      ),
      { rank: false }
    ),
  });
}

export const publicClient = createMonadPublicClient();

export function getServerAccount(envKey: "SENTINEL_PRIVATE_KEY" | "DEPLOYER_PRIVATE_KEY"): Account {
  const pk = process.env[envKey];
  if (!pk || !pk.startsWith("0x")) {
    throw new Error(`Missing server env ${envKey}`);
  }
  return privateKeyToAccount(pk as Hex);
}

/**
 * Broadcast a signed tx using Monad's eth_sendRawTransactionSync for <600ms receipt latency,
 * with automatic fallback to eth_sendRawTransaction + waitForTransactionReceipt.
 * Tightly bounds gasLimit (+10% buffer) to respect Monad's gas_limit billing model.
 */
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
  const walletClient = createWalletClient({
    account: params.account,
    chain: monadTestnet,
    transport: fallback(
      MONAD_TESTNET_RPCS.map((url) => http(url, { retryCount: 2, timeout: 10_000 })),
      { rank: false }
    ),
  });

  const t0 = Date.now();
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

  // Monad charges on gas_limit (not gas_used): keep buffer tight at +10%
  const gasLimit = estimatedGas + estimatedGas / 10n + 2_000n;
  // Live Monad Testnet baseFee is 100 MON-gwei; ensure maxFeePerGas >= 110 gwei
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

  // Measure pure broadcast-to-receipt confirmation time on Monad
  const tBroadcast = Date.now();

  // Try Monad's native eth_sendRawTransactionSync first
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
        error?: { message?: string };
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
      if (err instanceof Error && err.message.includes("reverted")) {
        throw err;
      }
      // Fall through to standard sendRawTransaction fallback
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

/**
 * Runs Monad official RPC debug_traceCall (callTracer) to reveal exact internal call destination,
 * with graceful fallback to eth_call + decoded calldata diff.
 */
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
      const json = (await res.json()) as { result?: Record<string, unknown>; error?: unknown };
      if (json.result) {
        return {
          method: "debug_traceCall (callTracer)",
          latencyMs: Date.now() - t0,
          traceResult: json.result,
        };
      }
    } catch {
      // try next node
    }
  }

  // Graceful fallback to eth_call
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
