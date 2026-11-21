import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  fallback,
  http,
  keccak256,
  type Account,
  type Address,
  type Hex,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ZERO_DRAIN_VAULT_ABI } from "../../src/lib/abi";

export { ZERO_DRAIN_VAULT_ABI };

export interface Env {
  ASSETS?: { fetch: (input: RequestInfo | URL) => Promise<Response> };
  NEXT_PUBLIC_VAULT_ADDRESS?: string;
  PUBLIC_DEMO_MODE?: string;
  ADMIN_RESET_TOKEN?: string;
  DEPLOYER_PRIVATE_KEY?: string;
  SENTINEL_PRIVATE_KEY?: string;
}

export interface PagesContext {
  request: Request;
  env: Env;
}

export class BadRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BadRequestError";
  }
}

export const DRAINER_ADDRESS = "0xdeadbeef0000000000000000000000000000bad1" as const;

export const CLEAN_BUNDLE_PATH = "/bundles/vault-action.clean.js";
export const HIJACKED_BUNDLE_PATH = "/bundles/vault-action.hijacked.js";

// Fallback byte-exact SHA-256 of public/bundles/vault-action.clean.js
export const CLEAN_BUNDLE_SHA256: Hex =
  "0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207";

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

// Best-effort per-isolate sliding-window rate limiter (pairs with Cloudflare Edge WAF/DDoS)
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_WRITES = 45;
const rateBuckets = new Map<string, number[]>();

// Per-signer serialization queue & monotonic nonce high-water mark within the isolate
const signerQueues = new Map<string, Promise<unknown>>();
const signerHighWaterNonce = new Map<string, number>();

function withSignerLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const prev = signerQueues.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  const cleanup = next.finally(() => {
    if (signerQueues.get(key) === cleanup) {
      signerQueues.delete(key);
    }
  });
  signerQueues.set(key, cleanup);
  return next;
}

export function getVaultAddress(env: Env): Address {
  return (env.NEXT_PUBLIC_VAULT_ADDRESS || "0xF81E520E4512387a906D22C700d282aF6D3247ab") as Address;
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

/**
 * Safely derives the server account address when configured, or returns null in keyless read-only deployments.
 */
export function getOptionalServerAddress(
  env: Env,
  key: "DEPLOYER_PRIVATE_KEY" | "SENTINEL_PRIVATE_KEY"
): Address | null {
  const pk = env[key];
  if (!pk || !pk.startsWith("0x")) return null;
  try {
    return privateKeyToAccount(pk as Hex).address;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function checkRateLimit(request: Request): Response | null {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown";
  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const recent = (rateBuckets.get(ip) || []).filter((ts) => ts > cutoff);
  if (recent.length >= RATE_LIMIT_MAX_WRITES) {
    return jsonResponse(
      { ok: false, error: "Too many requests; please wait a few seconds before retrying." },
      429,
      { "retry-after": "15" }
    );
  }
  recent.push(now);
  rateBuckets.set(ip, recent);
  if (rateBuckets.size > 500) {
    for (const [k, list] of rateBuckets) {
      if (list.every((ts) => ts <= cutoff)) rateBuckets.delete(k);
    }
  }
  return null;
}

/**
 * Enforces strict CSRF, Content-Type, Rate Limit, and fail-closed Operator Bearer Auth:
 * - Cross-origin browser POSTs (Origin / Sec-Fetch-Site mismatch) are always rejected (403).
 * - Non-JSON Content-Type (including simple text/plain CSRF bypass attempts) is rejected (415).
 * - Per-IP sliding-window rate limit guards against scripted spam (429).
 * - If ADMIN_RESET_TOKEN is configured or PUBLIC_DEMO_MODE !== "true", requires constant-time
 *   `Authorization: Bearer <ADMIN_RESET_TOKEN>` header (401), leaving non-demo sites read-only.
 */
export function assertControlAuthorized(
  context: PagesContext,
  requireOperatorAuth = true
): Response | null {
  const reqUrl = new URL(context.request.url);
  const origin = context.request.headers.get("origin");
  const secFetchSite = context.request.headers.get("sec-fetch-site");
  const contentType = (context.request.headers.get("content-type") || "").toLowerCase();

  if (origin && origin !== reqUrl.origin) {
    return jsonResponse({ ok: false, error: "Forbidden: cross-origin control request rejected" }, 403);
  }
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return jsonResponse({ ok: false, error: "Forbidden: invalid Sec-Fetch-Site header" }, 403);
  }
  if (!contentType.startsWith("application/json")) {
    return jsonResponse(
      { ok: false, error: "Unsupported Media Type: Content-Type must be application/json" },
      415
    );
  }

  const rateDenied = checkRateLimit(context.request);
  if (rateDenied) return rateDenied;

  const configuredToken = (context.env.ADMIN_RESET_TOKEN || "").trim();
  const isPublicDemo = context.env.PUBLIC_DEMO_MODE === "true";

  if (requireOperatorAuth && (configuredToken.length > 0 || !isPublicDemo)) {
    const authHeader = context.request.headers.get("authorization") || "";
    const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    if (!configuredToken || !provided || !constantTimeEqual(provided, configuredToken)) {
      return jsonResponse(
        {
          ok: false,
          error: "Unauthorized: operator Bearer token required (production requires Safe Multisig + Timelock)",
        },
        401
      );
    }
  }
  return null;
}

export async function parseJsonBody<T>(request: Request, allowEmpty = false): Promise<T> {
  const raw = await request.text();
  if (!raw.trim()) {
    if (allowEmpty) return {} as T;
    throw new BadRequestError("Request body must be valid JSON");
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadRequestError("JSON payload must be an object");
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof BadRequestError) throw err;
    throw new BadRequestError("Malformed JSON request body");
  }
}

export async function sha256BytesHex(bytes: ArrayBuffer): Promise<Hex> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * Fetches the ACTUAL served static JS bundle from Cloudflare Pages Assets and computes its real SHA-256 SRI hash.
 */
export async function fetchAndHashServedBundle(context: PagesContext, hijacked: boolean) {
  const bundlePath = hijacked ? HIJACKED_BUNDLE_PATH : CLEAN_BUNDLE_PATH;
  const assetUrl = new URL(bundlePath, context.request.url);

  let res: Response;
  if (context.env.ASSETS) {
    res = await context.env.ASSETS.fetch(assetUrl);
  } else {
    res = await fetch(assetUrl);
  }
  if (!res.ok) {
    throw new Error(`Failed to fetch served asset ${bundlePath} (HTTP ${res.status})`);
  }

  const buffer = await res.arrayBuffer();
  const sriHash = await sha256BytesHex(buffer);

  return {
    hijacked,
    sandboxNotice:
      "Interactive Attack Sandbox: compares live SHA-256 of actual served JS bundle bytes against on-chain trustedFrontendHash",
    version: "v2.1.0",
    bundlePath,
    bundleBytes: buffer.byteLength,
    dnsProvider: hijacked
      ? "Simulated Name.com Hijack (served vault-action.hijacked.js)"
      : "Cloudflare Pages Edge (served vault-action.clean.js)",
    sriHash,
    withdrawRecipientOverride: hijacked ? DRAINER_ADDRESS : null,
    checkedAt: new Date().toISOString(),
  };
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extraHeaders?: Record<string, string>
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      vary: "Origin",
      ...extraHeaders,
    },
  });
}

function isNonceCollisionError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes("nonce too low") ||
    msg.includes("nonce is too low") ||
    msg.includes("invalid nonce") ||
    msg.includes("replacement transaction underpriced") ||
    msg.includes("nonce has already been used") ||
    msg.includes("already known") ||
    msg.includes("already imported")
  );
}

function isAlreadyKnownError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("already known") || msg.includes("already imported");
}

async function broadcastOnceSync(params: {
  account: Account;
  to: Address;
  data: Hex;
  value?: bigint;
  minNonce?: number;
}): Promise<{
  hash: Hex;
  blockNumber: bigint;
  gasUsed: bigint;
  latencyMs: number;
  usedSyncRpc: boolean;
  usedNonce: number;
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

  const [pendingNonce, gasPrice, estimatedGas] = await Promise.all([
    publicClient.getTransactionCount({ address: params.account.address, blockTag: "pending" }),
    publicClient.getGasPrice(),
    publicClient.estimateGas({
      account: params.account.address,
      to: params.to,
      data: params.data,
      value: params.value ?? 0n,
    }),
  ]);

  const signerKey = params.account.address.toLowerCase();
  const prevHighWater = signerHighWaterNonce.get(signerKey);
  const floorNonce = Math.max(
    pendingNonce,
    prevHighWater !== undefined ? prevHighWater + 1 : 0,
    params.minNonce ?? 0
  );
  const nonce = floorNonce;
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

  const deterministicHash = keccak256(serialized);
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
          params: [serialized, 2500],
        }),
        signal: AbortSignal.timeout(3200),
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
        signerHighWaterNonce.set(signerKey, Math.max(prevHighWater ?? -1, nonce));
        return {
          hash: json.result.transactionHash,
          blockNumber: BigInt(json.result.blockNumber || "0x0"),
          gasUsed: BigInt(json.result.gasUsed || "0x0"),
          latencyMs: Date.now() - tBroadcast,
          usedSyncRpc: true,
          usedNonce: nonce,
        };
      }
      if (json.error?.message && isNonceCollisionError(new Error(json.error.message))) {
        const err = new Error(json.error.message) as Error & { attemptedNonce?: number };
        err.attemptedNonce = nonce;
        throw err;
      }
    } catch (err) {
      if (err instanceof Error && (err.message.includes("reverted") || isNonceCollisionError(err))) {
        throw err;
      }
    }
  }

  let hash: Hex = deterministicHash;
  try {
    hash = await publicClient.sendRawTransaction({ serializedTransaction: serialized });
  } catch (err) {
    if (!isAlreadyKnownError(err)) {
      const wrapped = (err instanceof Error ? err : new Error(String(err))) as Error & {
        attemptedNonce?: number;
      };
      wrapped.attemptedNonce = nonce;
      throw wrapped;
    }
  }

  const receipt: TransactionReceipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 250,
    timeout: 20_000,
  });
  if (receipt.status === "reverted") {
    throw new Error("Transaction reverted on-chain");
  }
  signerHighWaterNonce.set(signerKey, Math.max(prevHighWater ?? -1, nonce));
  return {
    hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed,
    latencyMs: Date.now() - tBroadcast,
    usedSyncRpc: false,
    usedNonce: nonce,
  };
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
  return withSignerLock(params.account.address, async () => {
    let minNonce: number | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await broadcastOnceSync({ ...params, minNonce });
      } catch (err) {
        if (attempt < 2 && isNonceCollisionError(err)) {
          const attempted = (err as { attemptedNonce?: number })?.attemptedNonce;
          if (typeof attempted === "number") {
            minNonce = attempted + 1;
          }
          await new Promise((r) => setTimeout(r, 350));
          continue;
        }
        throw err;
      }
    }
    throw new Error("Transaction broadcast exhausted nonce retries");
  });
}

export async function traceCallOnMonad(params: {
  from: Address;
  to: Address;
  data: Hex;
}): Promise<{
  method: "debug_traceCall (callTracer)" | "eth_call (fallback simulation)";
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
      // fallback to eth_call
    }
  }

  const publicClient = getPublicClient();
  let callOutcome = "WOULD_SUCCEED";
  let revertReason: string | null = null;
  try {
    await publicClient.call({ account: params.from, to: params.to, data: params.data });
  } catch (err) {
    callOutcome = "REVERTED";
    if (err instanceof BaseError) {
      const revertErr = err.walk((e) => e instanceof ContractFunctionRevertedError);
      if (revertErr instanceof ContractFunctionRevertedError && revertErr.data?.errorName) {
        revertReason = revertErr.data.errorName;
      }
    }
    if (!revertReason) {
      revertReason = err instanceof Error ? err.message.slice(0, 120) : "reverted";
    }
  }
  return {
    method: "eth_call (fallback simulation)",
    latencyMs: Date.now() - t0,
    traceResult: { outcome: callOutcome, revertReason },
  };
}
