import { formatEther, isAddress, type Address } from "viem";
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
    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");
    const sentinelAccount = getServerAccount(context.env, "SENTINEL_PRIVATE_KEY");
    const activeUser: Address =
      queryUser && isAddress(queryUser) ? (queryUser as Address) : demoAccount.address;

    const [
      blockNumber,
      gasPrice,
      precompileActive,
      vaultStatus,
      userVaultBalance,
      userWalletBalance,
      userPasskey,
      lockedRecoveryAddress,
      userNonce,
    ] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getGasPrice(),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "isNativeP256PrecompileActive",
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "getVaultStatus",
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "balances",
        args: [activeUser],
      }),
      publicClient.getBalance({ address: activeUser }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "passkeys",
        args: [activeUser],
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "getLockedRecoveryAddress",
        args: [activeUser],
      }),
      publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "nonces",
        args: [activeUser],
      }),
    ]);

    const [
      currentMode,
      trustedHash,
      maliciousHash,
      trippedBlock,
      trippedTime,
      reason,
      trips,
      recoveries,
      tvl,
    ] = vaultStatus;

    return jsonResponse({
      ok: true,
      chainId: 10143,
      publicDemoMode: context.env.PUBLIC_DEMO_MODE === "true",
      vaultAddress,
      demoAddress: demoAccount.address,
      sentinelAddress: sentinelAccount.address,
      activeUser,
      blockNumber: blockNumber.toString(),
      gasPriceGwei: (Number(gasPrice) / 1e9).toFixed(1),
      precompile0x0100Active: precompileActive,
      mode: currentMode === 1 ? "PASSKEY_ONLY" : "NORMAL",
      trustedHash,
      maliciousHash,
      trippedBlock: trippedBlock.toString(),
      trippedTime: trippedTime.toString(),
      tripReason: reason,
      tripCount: trips.toString(),
      emergencyRecoveryCount: recoveries.toString(),
      tvlMon: formatEther(tvl),
      user: {
        address: activeUser,
        lockedRecoveryAddress,
        vaultBalanceWei: userVaultBalance.toString(),
        vaultBalanceMon: formatEther(userVaultBalance),
        walletBalanceMon: Number(formatEther(userWalletBalance)).toFixed(4),
        passkeyRegistered: userPasskey[2],
        passkeyQx: userPasskey[0],
        passkeyQy: userPasskey[1],
        nonce: userNonce.toString(),
      },
    });
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Failed to fetch vault status" },
      500
    );
  }
}
