import { encodeFunctionData } from "viem";
import {
  assertControlAuthorized,
  BadRequestError,
  CLEAN_BUNDLE_SHA256,
  fetchAndHashServedBundle,
  getServerAccount,
  getVaultAddress,
  jsonResponse,
  parseJsonBody,
  sendSignedTxSync,
  ZERO_DRAIN_VAULT_ABI,
  type PagesContext,
} from "../../_lib/server";

export async function onRequestPost(context: PagesContext) {
  // Enforces Same-Origin CSRF + application/json + rate limit + fail-closed Operator Bearer auth
  const denied = assertControlAuthorized(context, true);
  if (denied) return denied;

  try {
    await parseJsonBody<Record<string, unknown>>(context.request, true);

    const vaultAddress = getVaultAddress(context.env);
    const adminAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");

    // F-02 Defense: NEVER anchor a live-fetched hash as trusted!
    // Verify the currently served clean bundle matches the canonical compile-time hash;
    // if it drifted, refuse reset so a compromised bundle can never self-legitimize.
    const cleanManifest = await fetchAndHashServedBundle(context, false);
    if (cleanManifest.sriHash.toLowerCase() !== CLEAN_BUNDLE_SHA256.toLowerCase()) {
      return jsonResponse(
        {
          ok: false,
          error:
            "Reset refused: served clean bundle SHA-256 does not match canonical trustedFrontendHash.",
          expectedHash: CLEAN_BUNDLE_SHA256,
          observedHash: cleanManifest.sriHash,
        },
        409
      );
    }

    const data = encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "restoreNormalMode",
      args: [CLEAN_BUNDLE_SHA256],
    });

    const sent = await sendSignedTxSync({
      account: adminAccount,
      to: vaultAddress,
      data,
    });

    return jsonResponse({
      ok: true,
      sandboxMode: context.env.PUBLIC_DEMO_MODE === "true",
      txHash: sent.hash,
      blockNumber: sent.blockNumber.toString(),
      latencyMs: sent.latencyMs,
      usedSyncRpc: sent.usedSyncRpc,
      trustedHash: CLEAN_BUNDLE_SHA256,
    });
  } catch (err) {
    if (err instanceof BadRequestError) {
      return jsonResponse({ ok: false, error: err.message }, 400);
    }
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Failed to reset vault mode" },
      500
    );
  }
}
