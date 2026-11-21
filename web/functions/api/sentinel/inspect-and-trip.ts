import { encodeFunctionData, formatEther, isAddress, parseEther, type Address } from "viem";
import {
  assertControlAuthorized,
  DRAINER_ADDRESS,
  fetchAndHashServedBundle,
  getPublicClient,
  getServerAccount,
  getVaultAddress,
  jsonResponse,
  sendSignedTxSync,
  traceCallOnMonad,
  ZERO_DRAIN_VAULT_ABI,
  type PagesContext,
} from "../../_lib/server";

export async function onRequestPost(context: PagesContext) {
  const denied = assertControlAuthorized(context, true);
  if (denied) return denied;

  try {
    const body = (await context.request.json()) as {
      hijacked?: boolean;
      userAddress?: string;
      amountMon?: string;
      autoTrip?: boolean;
    };

    const hijacked = Boolean(body.hijacked);
    const autoTrip = body.autoTrip !== false;
    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");
    const sentinelAccount = getServerAccount(context.env, "SENTINEL_PRIVATE_KEY");
    const userAddress: Address =
      body.userAddress && isAddress(body.userAddress)
        ? (body.userAddress as Address)
        : demoAccount.address;

    const amountWei = parseEther(body.amountMon || "0.05");
    // Real SHA-256 over the ACTUAL served static JS bundle bytes
    const manifest = await fetchAndHashServedBundle(context, hijacked);

    const [trustedHash, currentMode] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "trustedFrontendHash",
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "mode",
      }),
    ]);

    const sriMismatch = manifest.sriHash.toLowerCase() !== trustedHash.toLowerCase();
    const simulatedRecipient: Address = hijacked ? DRAINER_ADDRESS : userAddress;
    const recipientMismatch = simulatedRecipient.toLowerCase() !== userAddress.toLowerCase();

    const calldata = encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "withdraw",
      args: [simulatedRecipient, amountWei],
    });

    const trace = await traceCallOnMonad({
      from: userAddress,
      to: vaultAddress,
      data: calldata,
    });

    const threatDetected = sriMismatch || recipientMismatch;
    let tripResult: {
      txHash: string;
      blockNumber: string;
      gasUsed: string;
      latencyMs: number;
      usedSyncRpc: boolean;
      alreadyTripped?: boolean;
    } | null = null;

    if (threatDetected && autoTrip) {
      if (currentMode === 1) {
        tripResult = {
          txHash: "",
          blockNumber: (await publicClient.getBlockNumber()).toString(),
          gasUsed: "0",
          latencyMs: 0,
          usedSyncRpc: true,
          alreadyTripped: true,
        };
      } else {
        const tripData = encodeFunctionData({
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "tripBreaker",
          args: [
            manifest.sriHash,
            `SERVED_BUNDLE_SRI_DRIFT(${manifest.bundlePath})_AND_DRAINER(${DRAINER_ADDRESS.slice(0, 10)})`,
          ],
        });
        const sent = await sendSignedTxSync({
          account: sentinelAccount,
          to: vaultAddress,
          data: tripData,
        });
        tripResult = {
          txHash: sent.hash,
          blockNumber: sent.blockNumber.toString(),
          gasUsed: sent.gasUsed.toString(),
          latencyMs: sent.latencyMs,
          usedSyncRpc: sent.usedSyncRpc,
        };
      }
    }

    return jsonResponse({
      ok: true,
      sandboxMode: context.env.PUBLIC_DEMO_MODE === "true",
      threatDetected,
      sriCheck: {
        trustedHash,
        liveHash: manifest.sriHash,
        mismatch: sriMismatch,
        dnsProvider: manifest.dnsProvider,
        bundleName: manifest.bundlePath,
        bundleBytes: manifest.bundleBytes,
      },
      calldataDiff: {
        functionName: "withdraw(address recipient, uint256 amount)",
        expectedRecipient: userAddress,
        actualRecipient: simulatedRecipient,
        amountMon: formatEther(amountWei),
        recipientMismatch,
        traceMethod: trace.method,
        traceLatencyMs: trace.latencyMs,
        traceSummary: trace.traceResult,
      },
      breakerTx: tripResult,
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Sentinel inspection failed" },
      500
    );
  }
}
