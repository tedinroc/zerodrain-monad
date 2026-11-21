import { NextRequest, NextResponse } from "next/server";
import { formatEther, isAddress, type Address } from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import { getServerAccount, publicClient, VAULT_ADDRESS } from "@/lib/monad";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const queryUser = req.nextUrl.searchParams.get("user");
    const demoAccount = getServerAccount("DEPLOYER_PRIVATE_KEY");
    const sentinelAccount = getServerAccount("SENTINEL_PRIVATE_KEY");
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
      userNonce,
    ] = await Promise.all([
      publicClient.getBlockNumber(),
      publicClient.getGasPrice(),
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "isNativeP256PrecompileActive",
      }),
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "getVaultStatus",
      }),
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "balances",
        args: [activeUser],
      }),
      publicClient.getBalance({ address: activeUser }),
      publicClient.readContract({
        address: VAULT_ADDRESS,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "passkeys",
        args: [activeUser],
      }),
      publicClient.readContract({
        address: VAULT_ADDRESS,
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

    return NextResponse.json({
      ok: true,
      chainId: 10143,
      vaultAddress: VAULT_ADDRESS,
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
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to fetch vault status" },
      { status: 500 }
    );
  }
}
