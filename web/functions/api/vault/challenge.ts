import { isAddress, parseEther, type Address } from "viem";
import {
  BadRequestError,
  getOptionalServerAddress,
  getPublicClient,
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
    const maxChallengeAmount = parseEther("100");
    if (amount <= 0n || amount > maxChallengeAmount) {
      throw new BadRequestError("amountMon must be between 0 and 100 MON");
    }

    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();

    // P1 Read-Only Mode Support: works with ZERO server signing keys via public RPC + on-chain admin fallback!
    let user: Address;
    if (queryUser) {
      user = queryUser as Address;
    } else {
      const configuredDemoAddr = getOptionalServerAddress(context.env, "DEPLOYER_PRIVATE_KEY");
      user =
        configuredDemoAddr ??
        (await publicClient.readContract({
          address: vaultAddress,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "admin",
        }));
    }

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
