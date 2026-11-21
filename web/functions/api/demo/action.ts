import {
  BaseError,
  ContractFunctionRevertedError,
  encodeFunctionData,
  parseEther,
  type Hex,
} from "viem";
import {
  assertControlAuthorized,
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

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;
const MAX_DEMO_VAULT_BALANCE = parseEther("0.5");

function parseSafeDemoAmount(amountMon?: string, defaultVal = "0.05"): bigint {
  const raw = (amountMon || defaultVal).trim();
  if (!/^\d+(\.\d{1,6})?$/.test(raw)) {
    throw new Error("Invalid MON amount format");
  }
  const parsed = parseEther(raw);
  if (parsed <= 0n) throw new Error("Amount must be positive");
  const maxAllowed = parseEther("0.2");
  return parsed > maxAllowed ? maxAllowed : parsed;
}

function assertBytes32(val: unknown, name: string): Hex {
  if (typeof val !== "string" || !BYTES32_RE.test(val)) {
    throw new Error(`Invalid bytes32 parameter: ${name}`);
  }
  return val as Hex;
}

export async function onRequestPost(context: PagesContext) {
  const denied = assertControlAuthorized(context, false);
  if (denied) return denied;

  try {
    const body = (await context.request.json()) as DemoActionBody;
    const vaultAddress = getVaultAddress(context.env);
    const publicClient = getPublicClient();
    const demoAccount = getServerAccount(context.env, "DEPLOYER_PRIVATE_KEY");

    if (body.action === "deposit") {
      const amount = parseSafeDemoAmount(body.amountMon, "0.1");
      const currentBal = await publicClient.readContract({
        address: vaultAddress,
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "balances",
        args: [demoAccount.address],
      });
      if (currentBal >= MAX_DEMO_VAULT_BALANCE) {
        return jsonResponse({
          ok: true,
          action: "deposit",
          skippedAlreadyFunded: true,
          txHash: "",
          blockNumber: (await publicClient.getBlockNumber()).toString(),
          gasUsed: "0",
          latencyMs: 0,
          usedSyncRpc: true,
        });
      }

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
      const qx = assertBytes32(body.qx, "qx");
      const qy = assertBytes32(body.qy, "qy");
      // Check if contract blocks Passkey mutation during PASSKEY_ONLY incident!
      try {
        await publicClient.simulateContract({
          account: demoAccount.address,
          address: vaultAddress,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "registerPasskey",
          args: [qx, qy],
        });
      } catch (simErr) {
        let errorName = "PasskeyLockedDuringBreaker";
        if (simErr instanceof BaseError) {
          const revertErr = simErr.walk((e) => e instanceof ContractFunctionRevertedError);
          if (revertErr instanceof ContractFunctionRevertedError && revertErr.data?.errorName) {
            errorName = revertErr.data.errorName;
          }
        }
        return jsonResponse(
          {
            ok: false,
            lockedDuringIncident: errorName === "PasskeyLockedDuringBreaker",
            errorName,
            error: "Passkey mutation is frozen on-chain while vault is in PASSKEY_ONLY mode.",
          },
          409
        );
      }

      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "registerPasskey",
        args: [qx, qy],
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
      const amount = parseSafeDemoAmount(body.amountMon, "0.05");
      const recipient = body.hijacked ? DRAINER_ADDRESS : demoAccount.address;

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

      if (body.hijacked) {
        return jsonResponse(
          {
            ok: false,
            blockedOnChain: false,
            error: "Circuit breaker is currently NORMAL; trigger Step 2 DNS hijack first to test on-chain blocking.",
          },
          400
        );
      }

      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "withdraw",
        args: [demoAccount.address, amount],
      });
      const sent = await sendSignedTxSync({
        account: demoAccount,
        to: vaultAddress,
        data,
      });

      return jsonResponse({
        ok: true,
        action: "withdraw",
        hijackedExecuted: false,
        recipient: demoAccount.address,
        txHash: sent.hash,
        blockNumber: sent.blockNumber.toString(),
        gasUsed: sent.gasUsed.toString(),
        latencyMs: sent.latencyMs,
        usedSyncRpc: sent.usedSyncRpc,
      });
    }

    if (body.action === "emergencyWithdrawWebAuthn") {
      const amount = parseSafeDemoAmount(body.amountMon, "0.05");
      const r = assertBytes32(body.auth?.r, "auth.r");
      const s = assertBytes32(body.auth?.s, "auth.s");
      // v2: payout target is enforced strictly on-chain as getLockedRecoveryAddress(msg.sender)
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "emergencyWithdrawWithWebAuthn",
        args: [
          amount,
          BigInt(body.deadline),
          {
            r,
            s,
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
      const amount = parseSafeDemoAmount(body.amountMon, "0.05");
      const r = assertBytes32(body.r, "r");
      const s = assertBytes32(body.s, "s");
      // v2: payout target is enforced strictly on-chain as getLockedRecoveryAddress(msg.sender)
      const data = encodeFunctionData({
        abi: ZERO_DRAIN_VAULT_ABI,
        functionName: "emergencyWithdrawWithRawP256",
        args: [amount, BigInt(body.deadline), r, s],
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
