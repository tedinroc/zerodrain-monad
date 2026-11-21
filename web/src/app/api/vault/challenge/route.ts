import { NextRequest, NextResponse } from "next/server";
import { isAddress, parseEther, type Address } from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import { getServerAccount, publicClient, VAULT_ADDRESS } from "@/lib/monad";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const queryUser = req.nextUrl.searchParams.get("user");
    const querySafe = req.nextUrl.searchParams.get("safeRecipient");
    const amountMon = req.nextUrl.searchParams.get("amountMon") || "0.05";

    const demoAccount = getServerAccount("DEPLOYER_PRIVATE_KEY");
    const user: Address =
      queryUser && isAddress(queryUser) ? (queryUser as Address) : demoAccount.address;
    const safeRecipient: Address =
      querySafe && isAddress(querySafe) ? (querySafe as Address) : user;

    const amount = parseEther(amountMon);
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 600); // 10 minutes

    const nonce = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "nonces",
      args: [user],
    });

    const challenge = await publicClient.readContract({
      address: VAULT_ADDRESS,
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "computeRecoveryChallenge",
      args: [user, safeRecipient, amount, nonce, deadline],
    });

    return NextResponse.json({
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
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to compute challenge" },
      { status: 500 }
    );
  }
}
