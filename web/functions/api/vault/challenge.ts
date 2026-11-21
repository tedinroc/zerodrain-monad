import { isAddress, parseEther, type Address } from "viem";
import {
  getPublicClient,
  getServerAccount,
  getVaultAddress,
  jsonResponse,
  ZERO_DRAIN_VAULT_ABI,
  type PagesContext,
} from "../../_lib/server";

export async function onRequestGet(context: PagesContext) {
  try {
    const url = new URL(context.request.url);
    const queryUser = url.searchParams.get("user");
    const querySafe = url.searchParams.get("safeRecipient");
    const amountMon = url.searchParams.get("amountMon") || "0.05";

    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");
    const user: Address =
      queryUser && isAddress(queryUser) ? (queryUser as Address) : demoAccount.address;
    const safeRecipient: Address =
      querySafe && isAddress(querySafe) ? (querySafe as Address) : user;

    const amount = parseEther(amountMon);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const nonce = await publicClient.readContract({
      address: vaultAddress,
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "nonces",
      args: [user],
    });

    const challenge = await publicClient.readContract({
      address: vaultAddress,
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "computeRecoveryChallenge",
      args: [user, safeRecipient, amount, nonce, deadline],
    });

    return jsonResponse({
      ok: true,
      user,
      safeRecipient,
      amountWei: amount.toString(),
      amountMon,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      challenge,
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Failed to compute challenge" },
      500
    );
  }
}
