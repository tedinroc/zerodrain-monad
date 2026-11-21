import { NextResponse } from "next/server";
import { encodeFunctionData } from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import { CLEAN_MANIFEST_SOURCE, computeSha256Hex } from "@/lib/manifest";
import { getServerAccount, sendSignedTxSync, VAULT_ADDRESS } from "@/lib/monad";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const adminAccount = getServerAccount("DEPLOYER_PRIVATE_KEY");
    const cleanHash = computeSha256Hex(CLEAN_MANIFEST_SOURCE);

    const data = encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "restoreNormalMode",
      args: [cleanHash],
    });

    const sent = await sendSignedTxSync({
      account: adminAccount,
      to: VAULT_ADDRESS,
      data,
    });

    return NextResponse.json({
      ok: true,
      txHash: sent.hash,
      blockNumber: sent.blockNumber.toString(),
      latencyMs: sent.latencyMs,
      usedSyncRpc: sent.usedSyncRpc,
      trustedHash: cleanHash,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to reset vault mode" },
      { status: 500 }
    );
  }
}
