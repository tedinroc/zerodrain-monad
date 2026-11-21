import { NextRequest, NextResponse } from "next/server";
import { encodeFunctionData, formatEther, isAddress, parseEther, type Address } from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import { buildManifestPayload, DRAINER_ADDRESS } from "@/lib/manifest";
import {
  getServerAccount,
  publicClient,
  sendSignedTxSync,
  traceCallOnMonad,
  VAULT_ADDRESS,
} from "@/lib/monad";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      hijacked?: boolean;
      userAddress?: string;
      amountMon?: string;
      autoTrip?: boolean;
    };

    const hijacked = Boolean(body.hijacked);
    const autoTrip = body.autoTrip !== false;
    const demoAccount = getServerAccount("DEPLOYER_PRIVATE_KEY");
    const sentinelAccount = getServerAccount("SENTINEL_PRIVATE_KEY");
    const userAddress: Address =
      body.userAddress && isAddress(body.userAddress)
        ? (body.userAddress as Address)
        : demoAccount.address;

    const amountWei = parseEther(body.amountMon || "0.05");
    const manifest = buildManifestPayload(hijacked);

    // 1. Read canonical trusted hash & mode from Monad Testnet
    const [trustedHash, currentMode] = await Promise.all([
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "trustedFrontendHash",
      }),
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "mode",
      }),
    ]);

    const sriMismatch = manifest.sriHash.toLowerCase() !== trustedHash.toLowerCase();
    const simulatedRecipient: Address = hijacked ? DRAINER_ADDRESS : userAddress;
    const recipientMismatch = simulatedRecipient.toLowerCase() !== userAddress.toLowerCase();

    // 2. Encode the exact withdraw(recipient, amount) calldata the UI would submit & trace via Monad RPC
    const calldata = encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "withdraw",
      args: [simulatedRecipient, amountWei],
    });

    const trace = await traceCallOnMonad({
      from: userAddress,
      to: VAULT_ADDRESS,
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

    // 3. If threat detected & vault still NORMAL, fire sub-second tripBreaker() on Monad Testnet!
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
            `DNS_HIJACK_SRI_DRIFT_AND_DRAINER_REDIRECT(${DRAINER_ADDRESS.slice(0, 10)})`,
          ],
        });
        const sent = await sendSignedTxSync({
          account: sentinelAccount,
          to: VAULT_ADDRESS,
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

    return NextResponse.json({
      ok: true,
      threatDetected,
      sriCheck: {
        trustedHash,
        liveHash: manifest.sriHash,
        mismatch: sriMismatch,
        dnsProvider: manifest.dnsProvider,
        bundleName: manifest.bundleName,
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
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Sentinel inspection failed" },
      { status: 500 }
    );
  }
}
