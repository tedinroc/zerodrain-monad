import { isAddress, parseEther, type Address } from "viem";
import {
  BadRequestError,
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
    const amountMon = (url.searchParams.get("amountMon") || "0.05").trim();

    if (queryUser && !isAddress(queryUser)) {
      throw new BadRequestError("Invalid user address parameter");
    }
    if (!/^\d+(\.\d{1,6})?$/.test(amountMon)) {
      throw new BadRequestError("Invalid amountMon parameter");
    }

    const amount = parseEther(amountMon);
    if (amount <= 0n) {
      throw new BadRequestError("amountMon must be positive");
    }

    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");
    const user: Address = queryUser ? (queryUser as Address) : demoAccount.address;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600);

    const [nonce, lockedRecipient] = await Promise.all([
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "nonces",
        args: [user],
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "getLockedRecoveryAddress",
        args: [user],
      }),
    ]);

    const challenge = await publicClient.readContract({
      address: vaultAddress,
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "computeRecoveryChallenge",
      args: [user, amount, nonce, deadline],
    });

    return jsonResponse({
      ok: true,
      user,
      lockedRecipient,
      amountWei: amount.toString(),
      amountMon,
      nonce: nonce.toString(),
      deadline: deadline.toString(),
      challenge,
    });
  } catch (err) {
    if (err instanceof BadRequestError) {
      return jsonResponse({ ok: false, error: err.message }, 400);
    }
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Failed to compute challenge" },
      500
    );
  }
}
