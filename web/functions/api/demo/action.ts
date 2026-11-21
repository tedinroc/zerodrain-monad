import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  parseEther,
  type Hex,
} from "viem";
import {
  DRAINER_ADDRESS,
  getPublicClient,
  getServerAccount,
  getVaultAddress,
  jsonResponse,
  sendSignedTxSync,
  ZERO_DRAIN_VAULT_ABI,
  type PagesContext,
} from "../../_lib/server";

type DemoActionBody =
  | { action: "deposit"; amountMon?: string }
  | { action: "registerPasskey"; qx: Hex; qy: Hex }
  | { action: "withdraw"; hijacked?: boolean; amountMon?: string }
  | {
      action: "emergencyWithdrawWebAuthn";
      amountMon?: string;
      deadline: string;
      auth: {
        r: Hex;
        s: Hex;
        challengeIndex: string;
        typeIndex: string;
        authenticatorData: Hex;
        clientDataJSON: string;
      };
    }
  | {
      action: "emergencyWithdrawRawP256";
      amountMon?: string;
      deadline: string;
      r: Hex;
      s: Hex;
    };

function capDemoAmount(amountMon?: string): bigint {
  const parsed = parseEther(amountMon || "0.05");
  const maxAllowed = parseEther("0.2");
  return parsed > maxAllowed ? maxAllowed : parsed;
}

export async function onRequestPost(context: PagesContext) {
  try {
    const body = (await context.request.json()) as DemoActionBody;
    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");

    if (body.action === "deposit") {
      const amount = capDemoAmount(body.amountMon || "0.1");
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "deposit",
      });
      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data,
        value: amount,
      });
      return jsonResponse({
        ok: true,
        action: "deposit",
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    if (body.action === "registerPasskey") {
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "registerPasskey",
        args: [body.qx, body.qy],
      });
      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data,
      });
      return jsonResponse({
        ok: true,
        action: "registerPasskey",
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    if (body.action === "withdraw") {
      const amount = capDemoAmount(body.amountMon || "0.05");
      const recipient = body.hijacked ? DRAINER_ADDRESS : demoAccount.address;
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "withdraw",
        args: [recipient, amount],
      });

      try {
        await publicClient.simulateContract({
          account: demoAccount.address,
          address: vaultAddress,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "withdraw",
          args: [recipient, amount],
        });
      } catch (simErr) {
        let errorName = "TransactionReverted";
        let details = simErr instanceof Error ? simErr.message : "Reverted";
        if (simErr instanceof BaseError) {
          const revertErr = simErr.walk((e) => e instanceof ContractFunctionRevertedError);
          if (revertErr instanceof ContractFunctionRevertedError) {
            errorName = revertErr.data?.errorName || "VaultInPasskeyOnlyMode";
            details = `${errorName}(${(revertErr.data?.args || []).map(String).join(", ")})`;
          }
        }
        return jsonResponse({
          ok: false,
          blockedOnChain: true,
          errorName,
          error: details,
          attemptedRecipient: recipient,
        });
      }

      const effectiveAmount = body.hijacked ? parseEther("0.001") : amount;
      const effectiveData = body.hijacked
        ? encodeFunctionData({
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "withdraw",
            args: [recipient, effectiveAmount],
          })
        : data;

      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data: effectiveData,
      });

      return jsonResponse({
        ok: true,
        action: "withdraw",
        hijackedExecuted: Boolean(body.hijacked),
        recipient,
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    if (body.action === "emergencyWithdrawWebAuthn") {
      const amount = capDemoAmount(body.amountMon || "0.05");
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "emergencyWithdrawWithWebAuthn",
        args: [
          demoAccount.address,
          amount,
          BigInt(body.deadline),
          {
            r: body.auth.r,
            s: body.auth.s,
            challengeIndex: BigInt(body.auth.challengeIndex),
            typeIndex: BigInt(body.auth.typeIndex),
            authenticatorData: body.auth.authenticatorData,
            clientDataJSON: body.auth.clientDataJSON,
          },
        ],
      });

      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data,
      });
      return jsonResponse({
        ok: true,
        action: "emergencyWithdrawWebAuthn",
        method: "WEBAUTHN_EIP7951_0x0100",
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    if (body.action === "emergencyWithdrawRawP256") {
      const amount = capDemoAmount(body.amountMon || "0.05");
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "emergencyWithdrawWithRawP256",
        args: [demoAccount.address, amount, BigInt(body.deadline), body.r, body.s],
      });

      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data,
      });
      return jsonResponse({
        ok: true,
        action: "emergencyWithdrawRawP256",
        method: "RAW_P256_EIP7951_0x0100",
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    return jsonResponse({ ok: false, error: "Unsupported action" }, 400);
  } catch (err) {
    return jsonResponse(
      { ok: false, error: err instanceof Error ? err.message : "Demo action failed" },
      500
    );
  }
}
