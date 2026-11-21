import { encodeFunctionData } from "viem";
import {
  CLEAN_MANIFEST_SOURCE,
  getServerAccount,
  getVaultAddress,
  jsonResponse,
  sendSignedTxSync,
  sha256Hex,
  ZERO_DRAIN_VAULT_ABI,
  type PagesContext,
} from "../../_lib/server";

export async function onRequestPost(context: PagesContext) {
  try {
    const vaultAddress = getVaultAddress(context.env);
    const adminAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");
    const cleanHash = await sha256Hex(CLEAN_MANIFEST_SOURCE);

    const data = encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "restoreNormalMode",
      args: [cleanHash],
    });

    const sent = await sendSignedTxSync({
      account: adminAccount,
      to: vaultAddress,
      data,
    });

    return jsonResponse({
      ok: true,
      txHash: sent.hash,
      blockNumber: sent.blockNumber.toString(),
      latencyMs: sent.latencyMs,
      usedSyncRpc: sent.usedSyncRpc,
      trustedHash: cleanHash,
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Failed to reset vault mode" },
      500
    );
  }
}
