"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Cpu,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Lock,
  Radio,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wallet,
  Zap,
} from "lucide-react";
import { createWalletClient, custom, encodeFunctionData, parseEther, type Address, type Hex } from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import { DRAINER_ADDRESS } from "@/lib/manifest";
import { EXPLORER_URL, monadTestnet, MONADSCAN_URL, publicClient, VAULT_ADDRESS } from "@/lib/monad";
import {
  createHardwareWebAuthnPasskey,
  createWebCryptoP256Key,
  loadStoredWebAuthn,
  loadStoredWebCrypto,
  signHardwareWebAuthnChallenge,
  signWebCryptoP256Challenge,
  type PasskeyMode,
  type StoredWebAuthnCredential,
  type StoredWebCryptoCredential,
} from "@/lib/passkey";

interface VaultStatusResponse {
  ok: boolean;
  chainId: number;
  vaultAddress: Address;
  demoAddress: Address;
  sentinelAddress: Address;
  activeUser: Address;
  blockNumber: string;
  gasPriceGwei: string;
  precompile0x0100Active: boolean;
  mode: "NORMAL" | "PASSKEY_ONLY";
  trustedHash: Hex;
  maliciousHash: Hex;
  trippedBlock: string;
  trippedTime: string;
  tripReason: string;
  tripCount: string;
  emergencyRecoveryCount: string;
  tvlMon: string;
  user: {
    address: Address;
    vaultBalanceWei: string;
    vaultBalanceMon: string;
    walletBalanceMon: string;
    passkeyRegistered: boolean;
    passkeyQx: Hex;
    passkeyQy: Hex;
    nonce: string;
  };
}

interface ManifestData {
  hijacked: boolean;
  version: string;
  dnsProvider: string;
  bundleName: string;
  sriHash: Hex;
  withdrawRecipientOverride: string | null;
}

interface SentinelInspection {
  threatDetected: boolean;
  sriCheck: {
    trustedHash: Hex;
    liveHash: Hex;
    mismatch: boolean;
    dnsProvider: string;
    bundleName: string;
  };
  calldataDiff: {
    functionName: string;
    expectedRecipient: string;
    actualRecipient: string;
    amountMon: string;
    recipientMismatch: boolean;
    traceMethod: string;
    traceLatencyMs: number;
    traceSummary: Record<string, unknown>;
  };
  breakerTx: {
    txHash: string;
    blockNumber: string;
    gasUsed: string;
    latencyMs: number;
    usedSyncRpc: boolean;
    alreadyTripped?: boolean;
  } | null;
}

interface AuditLogEntry {
  id: string;
  time: string;
  level: "safe" | "alert" | "info" | "blocked";
  title: string;
  detail: string;
  txHash?: string;
  latencyMs?: number;
}

function shortAddr(addr?: string) {
  if (!addr || addr.length < 12) return addr || "--";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortHash(hash?: string) {
  if (!hash || hash.length < 18) return hash || "--";
  return `${hash.slice(0, 12)}...${hash.slice(-8)}`;
}

function nowTime() {
  return new Date().toLocaleTimeString("zh-Hant", { hour12: false });
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export default function ZeroDrainWarRoom() {
  const [walletMode, setWalletMode] = useState<"demo" | "metamask">("demo");
  const [connectedWallet, setConnectedWallet] = useState<Address | null>(null);
  const [passkeyMode, setPasskeyMode] = useState<PasskeyMode>("webauthn");
  const [storedWebAuthn, setStoredWebAuthn] = useState<StoredWebAuthnCredential | null>(null);
  const [storedWebCrypto, setStoredWebCrypto] = useState<StoredWebCryptoCredential | null>(null);

  const [status, setStatus] = useState<VaultStatusResponse | null>(null);
  const [manifest, setManifest] = useState<ManifestData | null>(null);
  const [hijacked, setHijacked] = useState(false);
  const [inspection, setInspection] = useState<SentinelInspection | null>(null);
  const [blockedAlert, setBlockedAlert] = useState<{
    errorName: string;
    details: string;
    attemptedRecipient: string;
  } | null>(null);
  const [lastRecoveryProof, setLastRecoveryProof] = useState<{
    method: string;
    txHash: string;
    latencyMs: number;
    gasUsed: string;
    safeRecipient: string;
    amountMon: string;
  } | null>(null);

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [bannerMsg, setBannerMsg] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);

  const pushLog = useCallback((entry: Omit<AuditLogEntry, "id" | "time">) => {
    setLogs((prev) => [
      { ...entry, id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, time: nowTime() },
      ...prev.slice(0, 14),
    ]);
  }, []);

  const activeUserAddress = useMemo(() => {
    if (walletMode === "metamask" && connectedWallet) return connectedWallet;
    return status?.demoAddress ?? null;
  }, [walletMode, connectedWallet, status?.demoAddress]);

  const fetchStatus = useCallback(async () => {
    try {
      const qs = walletMode === "metamask" && connectedWallet ? `?user=${connectedWallet}` : "";
      const res = await fetch(`/api/vault/status${qs}`, { cache: "no-store" });
      const data = (await res.json()) as VaultStatusResponse;
      if (data.ok) {
        setStatus(data);
      }
    } catch {
      // ignore polling hiccup
    }
  }, [walletMode, connectedWallet]);

  const fetchManifest = useCallback(async (isHijacked: boolean) => {
    try {
      const res = await fetch(`/api/manifest?hijacked=${isHijacked ? "1" : "0"}`, { cache: "no-store" });
      const data = (await res.json()) as ManifestData;
      setManifest(data);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    setStoredWebAuthn(loadStoredWebAuthn());
    setStoredWebCrypto(loadStoredWebCrypto());
  }, []);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 2500);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  useEffect(() => {
    fetchManifest(hijacked);
  }, [hijacked, fetchManifest]);

  const isTripped = status?.mode === "PASSKEY_ONLY";

  // Check if local stored key matches on-chain registered public key
  const localKeyMatchesChain = useMemo(() => {
    if (!status?.user.passkeyRegistered) return false;
    const local = passkeyMode === "webauthn" ? storedWebAuthn : storedWebCrypto;
    if (!local) return false;
    return (
      local.qx.toLowerCase() === status.user.passkeyQx.toLowerCase() &&
      local.qy.toLowerCase() === status.user.passkeyQy.toLowerCase()
    );
  }, [status?.user, passkeyMode, storedWebAuthn, storedWebCrypto]);

  // Connect MetaMask & switch/add Monad Testnet (10143)
  const handleConnectMetaMask = async () => {
    if (!window.ethereum) {
      setBannerMsg({ type: "err", text: "未偵測到瀏覽器錢包插件，請直接使用「極速免錢包演練模式」體驗真實上鏈！" });
      return;
    }
    try {
      setBusyAction("connect");
      const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as Address[];
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x279f" }],
        });
      } catch {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x279f",
              chainName: "Monad Testnet",
              nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
              rpcUrls: ["https://testnet-rpc.monad.xyz", "https://rpc-testnet.monadinfra.com"],
              blockExplorerUrls: ["https://testnet.monadvision.com"],
            },
          ],
        });
      }
      setConnectedWallet(accounts[0]);
      setWalletMode("metamask");
      setBannerMsg({ type: "ok", text: `已連接 MetaMask (${shortAddr(accounts[0])}) 至 Monad Testnet (10143)` });
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "錢包連接失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  const getBrowserWalletClient = () => {
    if (!window.ethereum || !connectedWallet) throw new Error("請先連接瀏覽器錢包");
    return createWalletClient({
      account: connectedWallet,
      chain: monadTestnet,
      transport: custom(window.ethereum),
    });
  };

  // Step 1: Deposit 0.1 MON
  const handleDeposit = async () => {
    setBusyAction("deposit");
    setBannerMsg(null);
    try {
      if (walletMode === "demo") {
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "deposit", amountMon: "0.1" }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        pushLog({
          level: "safe",
          title: "存入 0.10 MON 至受保護金庫",
          detail: `Block #${data.blockNumber} · ${data.usedSyncRpc ? "eth_sendRawTransactionSync" : "standard"}`,
          txHash: data.txHash,
          latencyMs: data.latencyMs,
        });
        setBannerMsg({ type: "ok", text: `成功存入 0.10 MON！（實測上鏈確認耗時 ${data.latencyMs} ms）` });
      } else {
        const t0 = Date.now();
        const wc = getBrowserWalletClient();
        const hash = await wc.writeContract({
          address: VAULT_ADDRESS,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "deposit",
          value: parseEther("0.1"),
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const latencyMs = Date.now() - t0;
        pushLog({
          level: "safe",
          title: "存入 0.10 MON 至受保護金庫 (MetaMask)",
          detail: `Block #${receipt.blockNumber.toString()}`,
          txHash: hash,
          latencyMs,
        });
        setBannerMsg({ type: "ok", text: `MetaMask 存款 0.10 MON 成功！（${latencyMs} ms）` });
      }
      await fetchStatus();
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "存款失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  // Step 2: Bind TouchID/FaceID Passkey (Plan A) or WebCrypto P-256 (Plan B) on-chain
  const handleBindPasskey = async () => {
    setBusyAction("passkey");
    setBannerMsg(null);
    try {
      let qx: Hex;
      let qy: Hex;
      let label = "";

      if (passkeyMode === "webauthn") {
        const cred = await createHardwareWebAuthnPasskey(activeUserAddress || "MonadUser");
        setStoredWebAuthn(cred);
        qx = cred.qx;
        qy = cred.qy;
        label = "TouchID / FaceID WebAuthn (secp256r1)";
      } else {
        const cred = await createWebCryptoP256Key();
        setStoredWebCrypto(cred);
        qx = cred.qx;
        qy = cred.qy;
        label = "WebCrypto 本地 P-256 備援密鑰";
      }

      if (walletMode === "demo") {
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "registerPasskey", qx, qy }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        pushLog({
          level: "info",
          title: `已於鏈上綁定 ${label}`,
          detail: `qx=${shortHash(qx)} · Block #${data.blockNumber}`,
          txHash: data.txHash,
          latencyMs: data.latencyMs,
        });
        setBannerMsg({ type: "ok", text: `${label} 公鑰已寫入 Monad 鏈上（${data.latencyMs} ms）！` });
      } else {
        const t0 = Date.now();
        const wc = getBrowserWalletClient();
        const hash = await wc.writeContract({
          address: VAULT_ADDRESS,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "registerPasskey",
          args: [qx, qy],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const latencyMs = Date.now() - t0;
        pushLog({
          level: "info",
          title: `已於鏈上綁定 ${label} (MetaMask)`,
          detail: `qx=${shortHash(qx)} · Block #${receipt.blockNumber.toString()}`,
          txHash: hash,
          latencyMs,
        });
        setBannerMsg({ type: "ok", text: `硬體 Passkey 公鑰已註冊上鏈（${latencyMs} ms）！` });
      }
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "綁定硬體密鑰失敗";
      setBannerMsg({
        type: "err",
        text: `${msg}（若目前瀏覽器不支援生物辨識，可切換下方「WebCrypto P-256 備援模式」）`,
      });
    } finally {
      setBusyAction(null);
    }
  };

  // Step 3: Toggle Name.com DNS Hijack -> triggers Real Sub-Second Sentinel Inspection & On-Chain Breaker!
  const handleToggleHijack = async () => {
    const nextHijacked = !hijacked;
    setHijacked(nextHijacked);
    setBlockedAlert(null);
    setLastRecoveryProof(null);

    if (!nextHijacked) {
      setInspection(null);
      setBannerMsg({ type: "warn", text: "已關閉模擬劫持。點擊「重置演練」可將鏈上合約切回 NORMAL 模式。" });
      return;
    }

    setBusyAction("hijack");
    setBannerMsg({ type: "warn", text: "☢️ 模擬 Name.com DNS 劫持已注入！ZeroDrain 亞秒哨兵正在偵測並觸發鏈上熔斷..." });

    try {
      const res = await fetch("/api/sentinel/inspect-and-trip", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          hijacked: true,
          userAddress: activeUserAddress,
          amountMon: "0.05",
          autoTrip: true,
        }),
      });
      const data = (await res.json()) as SentinelInspection & { ok: boolean; error?: string };
      if (!data.ok) throw new Error(data.error || "Sentinel error");

      setInspection(data);
      if (data.breakerTx && !data.breakerTx.alreadyTripped) {
        pushLog({
          level: "alert",
          title: `🚨 偵測 DNS 前端劫持！已於 ${data.breakerTx.latencyMs} ms 鏈上熔斷`,
          detail: `SRI 漂移 + ${data.calldataDiff.traceMethod} 抓獲收款地址竄改 -> ${shortAddr(DRAINER_ADDRESS)} · Block #${data.breakerTx.blockNumber}`,
          txHash: data.breakerTx.txHash,
          latencyMs: data.breakerTx.latencyMs,
        });
        setBannerMsg({
          type: "ok",
          text: `🚨 哨兵偵測到惡意 Drainer 注入，已於 ${data.breakerTx.latencyMs} ms 在 Monad 鏈上切入 PASSKEY_ONLY 防護模式！現在點「一鍵提款」實測攔截效果！`,
        });
      } else if (data.breakerTx?.alreadyTripped) {
        setBannerMsg({
          type: "warn",
          text: "合約已處於 PASSKEY_ONLY 熔斷保護中！現在點擊左側「一鍵提款」即可親眼見證盜幣交易在鏈上 Revert！",
        });
      }
      await fetchStatus();
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "哨兵觸發失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  // Step 4: Attempt Standard Withdraw (clean if NORMAL, REAL ON-CHAIN REVERT if PASSKEY_ONLY!)
  const handleWithdraw = async () => {
    setBusyAction("withdraw");
    setBannerMsg(null);
    setBlockedAlert(null);
    const targetRecipient: Address = hijacked ? DRAINER_ADDRESS : (activeUserAddress as Address);

    try {
      if (walletMode === "demo") {
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "withdraw", hijacked, amountMon: "0.05" }),
        });
        const data = await res.json();
        if (data.blockedOnChain) {
          setBlockedAlert({
            errorName: data.errorName || "VaultInPasskeyOnlyMode",
            details: data.error,
            attemptedRecipient: data.attemptedRecipient || DRAINER_ADDRESS,
          });
          pushLog({
            level: "blocked",
            title: `🛡️ 惡意 Drainer 提款遭合約強制 Revert 攔截！`,
            detail: `錯誤碼: ${data.errorName} · 企圖盜轉目標: ${shortAddr(data.attemptedRecipient)} · 資產損失: 0 MON`,
          });
          setBannerMsg({
            type: "ok",
            text: `🛡️ 攔截成功！被劫持的提款（目標 ${shortAddr(DRAINER_ADDRESS)}）已遭合約 Revert 阻斷！請點下方「TouchID 硬體逃生取回」！`,
          });
          return;
        }
        if (!data.ok) throw new Error(data.error);
        pushLog({
          level: "safe",
          title: `正常提款 0.05 MON 成功`,
          detail: `收款地址: ${shortAddr(data.recipient)} · Block #${data.blockNumber}`,
          txHash: data.txHash,
          latencyMs: data.latencyMs,
        });
        setBannerMsg({ type: "ok", text: `正常模式提款成功（${data.latencyMs} ms）` });
      } else {
        // MetaMask mode: simulate first to show exact custom revert error cleanly
        try {
          await publicClient.simulateContract({
            account: connectedWallet!,
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "withdraw",
            args: [targetRecipient, parseEther("0.05")],
          });
        } catch (simErr) {
          const msg = simErr instanceof Error ? simErr.message : "VaultInPasskeyOnlyMode";
          setBlockedAlert({
            errorName: "VaultInPasskeyOnlyMode",
            details: msg.slice(0, 180),
            attemptedRecipient: targetRecipient,
          });
          pushLog({
            level: "blocked",
            title: "🛡️ 惡意 Drainer 提款遭合約強制 Revert 攔截！(MetaMask)",
            detail: `企圖盜轉目標: ${shortAddr(targetRecipient)} · 資產損失: 0 MON`,
          });
          return;
        }
        const t0 = Date.now();
        const wc = getBrowserWalletClient();
        const hash = await wc.writeContract({
          address: VAULT_ADDRESS,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "withdraw",
          args: [targetRecipient, parseEther("0.05")],
        });
        const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        pushLog({
          level: "safe",
          title: "正常提款 0.05 MON 成功 (MetaMask)",
          detail: `Block #${receipt.blockNumber.toString()}`,
          txHash: hash,
          latencyMs: Date.now() - t0,
        });
      }
      await fetchStatus();
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "提款操作失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  // Step 5: Hardware Escape Hatch via Monad Native EIP-7951 (0x0100) Precompile!
  const handleHardwareEscape = async () => {
    if (!activeUserAddress) return;
    setBusyAction("escape");
    setBannerMsg(null);
    try {
      // 1. Ensure user has a matching local key bound on-chain
      let currentWebAuthn = storedWebAuthn;
      let currentWebCrypto = storedWebCrypto;

      if (!localKeyMatchesChain) {
        setBannerMsg({
          type: "warn",
          text: "偵測到本機尚未綁定對應 Passkey，請先點擊左側「🔑 綁定硬體 Passkey」完成一次性上鏈註冊！",
        });
        setBusyAction(null);
        return;
      }

      // 2. Fetch deterministic recovery challenge straight from deployed Monad contract
      const chRes = await fetch(
        `/api/vault/challenge?user=${activeUserAddress}&safeRecipient=${activeUserAddress}&amountMon=0.05`,
        { cache: "no-store" }
      );
      const chData = await chRes.json();
      if (!chData.ok) throw new Error(chData.error);

      // 3. Sign locally on hardware (Plan A: TouchID/FaceID WebAuthn, Plan B: WebCrypto P-256)
      if (passkeyMode === "webauthn") {
        if (!currentWebAuthn) throw new Error("找不到本地 WebAuthn 憑證");
        const signed = await signHardwareWebAuthnChallenge({
          credentialId: currentWebAuthn.id,
          challenge: chData.challenge as Hex,
        });

        if (walletMode === "demo") {
          const res = await fetch("/api/demo/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "emergencyWithdrawWebAuthn",
              amountMon: "0.05",
              deadline: chData.deadline,
              auth: signed,
            }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);

          setLastRecoveryProof({
            method: "WebAuthn TouchID/FaceID -> Monad 0x0100 (EIP-7951)",
            txHash: data.txHash,
            latencyMs: data.latencyMs,
            gasUsed: data.gasUsed,
            safeRecipient: activeUserAddress,
            amountMon: "0.05",
          });
          pushLog({
            level: "safe",
            title: "✅ TouchID/FaceID 經 Monad 0x0100 預編譯鏈上驗簽通過！",
            detail: `安全取回 0.05 MON 至 ${shortAddr(activeUserAddress)} · Block #${data.blockNumber} · Gas=${data.gasUsed}`,
            txHash: data.txHash,
            latencyMs: data.latencyMs,
          });
          setBannerMsg({
            type: "ok",
            text: `🎉 硬體生物辨識已由 Monad 原生 0x0100 預編譯驗證通過！0.05 MON 安全取回本機地址（耗時 ${data.latencyMs} ms）！`,
          });
        } else {
          const t0 = Date.now();
          const wc = getBrowserWalletClient();
          const hash = await wc.writeContract({
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "emergencyWithdrawWithWebAuthn",
            args: [
              activeUserAddress,
              parseEther("0.05"),
              BigInt(chData.deadline),
              {
                r: signed.r,
                s: signed.s,
                challengeIndex: BigInt(signed.challengeIndex),
                typeIndex: BigInt(signed.typeIndex),
                authenticatorData: signed.authenticatorData,
                clientDataJSON: signed.clientDataJSON,
              },
            ],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
          const latencyMs = Date.now() - t0;
          setLastRecoveryProof({
            method: "WebAuthn TouchID/FaceID -> Monad 0x0100 (EIP-7951)",
            txHash: hash,
            latencyMs,
            gasUsed: receipt.gasUsed.toString(),
            safeRecipient: activeUserAddress,
            amountMon: "0.05",
          });
          pushLog({
            level: "safe",
            title: "✅ TouchID/FaceID 經 0x0100 鏈上驗簽通過 (MetaMask)",
            detail: `安全取回 0.05 MON · Block #${receipt.blockNumber.toString()}`,
            txHash: hash,
            latencyMs,
          });
        }
      } else {
        if (!currentWebCrypto) throw new Error("找不到本地 WebCrypto P-256 密鑰");
        const { r, s } = await signWebCryptoP256Challenge({
          privateJwk: currentWebCrypto.privateJwk,
          challenge: chData.challenge as Hex,
        });

        if (walletMode === "demo") {
          const res = await fetch("/api/demo/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "emergencyWithdrawRawP256",
              amountMon: "0.05",
              deadline: chData.deadline,
              r,
              s,
            }),
          });
          const data = await res.json();
          if (!data.ok) throw new Error(data.error);

          setLastRecoveryProof({
            method: "WebCrypto P-256 -> Monad 0x0100 verifyNative (6,900 gas)",
            txHash: data.txHash,
            latencyMs: data.latencyMs,
            gasUsed: data.gasUsed,
            safeRecipient: activeUserAddress,
            amountMon: "0.05",
          });
          pushLog({
            level: "safe",
            title: "✅ P-256 經 Monad 0x0100 verifyNative 驗簽通過！",
            detail: `安全取回 0.05 MON 至 ${shortAddr(activeUserAddress)} · Block #${data.blockNumber}`,
            txHash: data.txHash,
            latencyMs: data.latencyMs,
          });
          setBannerMsg({
            type: "ok",
            text: `🎉 P-256 簽名已由 Monad 原生 0x0100 預編譯驗證通過！0.05 MON 安全取回（耗時 ${data.latencyMs} ms）！`,
          });
        } else {
          const t0 = Date.now();
          const wc = getBrowserWalletClient();
          const hash = await wc.writeContract({
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "emergencyWithdrawWithRawP256",
            args: [activeUserAddress, parseEther("0.05"), BigInt(chData.deadline), r, s],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
          const latencyMs = Date.now() - t0;
          setLastRecoveryProof({
            method: "WebCrypto P-256 -> Monad 0x0100 verifyNative",
            txHash: hash,
            latencyMs,
            gasUsed: receipt.gasUsed.toString(),
            safeRecipient: activeUserAddress,
            amountMon: "0.05",
          });
          pushLog({
            level: "safe",
            title: "✅ P-256 經 0x0100 verifyNative 驗簽通過 (MetaMask)",
            detail: `安全取回 0.05 MON · Block #${receipt.blockNumber.toString()}`,
            txHash: hash,
            latencyMs,
          });
        }
      }

      await fetchStatus();
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "硬體逃生簽名或交易失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  // Reset demo cleanly back to NORMAL
  const handleResetDemo = async () => {
    setBusyAction("reset");
    setBannerMsg(null);
    try {
      const res = await fetch("/api/sentinel/reset", { method: "POST" });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setHijacked(false);
      setInspection(null);
      setBlockedAlert(null);
      setLastRecoveryProof(null);
      pushLog({
        level: "info",
        title: "🔄 協議 DNS 已清理，合約重置為 NORMAL 模式",
        detail: `Block #${data.blockNumber} · ${data.latencyMs} ms`,
        txHash: data.txHash,
        latencyMs: data.latencyMs,
      });
      setBannerMsg({ type: "ok", text: `已重置為 NORMAL 安全狀態（${data.latencyMs} ms），可重新演練！` });
      await fetchStatus();
    } catch (err) {
      setBannerMsg({ type: "err", text: err instanceof Error ? err.message : "重置失敗" });
    } finally {
      setBusyAction(null);
    }
  };

  // Preview encoded calldata shown in War Room even before hitting attack
  const previewCalldata = useMemo(() => {
    if (!activeUserAddress) return "0x";
    return encodeFunctionData({
      abi: ZERO_DRAIN_VAULT_ABI,
      functionName: "withdraw",
      args: [hijacked ? DRAINER_ADDRESS : activeUserAddress, parseEther("0.05")],
    });
  }, [activeUserAddress, hijacked]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-4 sm:px-6">
      {/* ==================== TOP COMMAND BAR ==================== */}
      <header
        className={`mb-4 rounded-2xl border bg-[#12101c]/90 p-4 backdrop-blur-md transition-all ${
          isTripped ? "alert-pulse border-red-500/80" : "border-violet-500/25"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-xl border ${
                isTripped
                  ? "border-red-500/60 bg-red-500/20 text-red-400"
                  : "border-violet-400/40 bg-violet-500/20 text-violet-300"
              }`}
            >
              {isTripped ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold tracking-tight text-white">ZeroDrain 零盜盾</h1>
                <span className="rounded-md bg-violet-500/20 px-2 py-0.5 text-xs font-semibold text-violet-200 border border-violet-400/30">
                  Monad Testnet #10143
                </span>
                <span className="hidden sm:inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-300 border border-emerald-400/25">
                  <Cpu className="h-3 w-3" />
                  0x0100 EIP-7951 {status?.precompile0x0100Active ? "ACTIVE" : "..."}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                DeFi 前端 DNS 劫持亞秒級鏈上熔斷 × 原生硬體 Passkey (6,900 gas) 防火牆
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Live Block & Mode Status */}
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs">
              <Radio className="h-3.5 w-3.5 animate-pulse text-violet-400" />
              <span className="text-zinc-400">Block</span>
              <span className="font-mono font-bold text-white">
                #{status ? Number(status.blockNumber).toLocaleString() : "---"}
              </span>
              <span className="text-zinc-600">|</span>
              <span className="font-mono text-zinc-300">{status?.gasPriceGwei || "100"} gwei</span>
            </div>

            <div
              className={`flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold ${
                isTripped
                  ? "border-red-500/60 bg-red-500/20 text-red-300"
                  : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isTripped ? "animate-ping bg-red-400" : "bg-emerald-400"
                }`}
              />
              {isTripped ? "PASSKEY_ONLY 熔斷保護中" : "NORMAL 正常運行"}
            </div>

            {/* Giant Red Attack Simulator Button */}
            <button
              onClick={handleToggleHijack}
              disabled={busyAction !== null}
              className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 ${
                hijacked
                  ? "border border-red-400 bg-red-600 text-white shadow-lg shadow-red-600/30 hover:bg-red-500"
                  : "border border-red-500/50 bg-red-500/15 text-red-200 hover:bg-red-600 hover:text-white"
              }`}
            >
              <AlertTriangle className="h-4 w-4" />
              {busyAction === "hijack"
                ? "哨兵亞秒熔斷中..."
                : hijacked
                ? "☢️ DNS 劫持進行中（點擊關閉）"
                : "☢️ 模擬 Name.com DNS 劫持"}
            </button>

            <button
              onClick={handleResetDemo}
              disabled={busyAction !== null}
              className="flex items-center gap-1.5 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-200 hover:bg-white/10 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {busyAction === "reset" ? "重置中..." : "重置演練"}
            </button>

            <a
              href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-xl border border-violet-400/30 bg-violet-500/15 px-3 py-2 text-xs font-semibold text-violet-200 hover:bg-violet-500/25"
            >
              MonadVision 已驗證合約
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>

        {/* 4-Step Live Stage Walkthrough Bar */}
        <div className="mt-3 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-xs lg:grid-cols-4">
          {[
            {
              step: "1",
              text: "存入 MON & 綁定 TouchID Passkey",
              done: Boolean(
                status && Number(status.user.vaultBalanceMon) > 0 && status.user.passkeyRegistered
              ),
            },
            {
              step: "2",
              text: "點紅色按鈕注入 Name.com DNS 劫持",
              done: Boolean(isTripped),
            },
            {
              step: "3",
              text: "點提款見證 Drainer 遭合約 Revert",
              done: Boolean(blockedAlert),
            },
            {
              step: "4",
              text: "按 TouchID 經 0x0100 預編譯救回資金",
              done: Boolean(lastRecoveryProof),
            },
          ].map((item) => (
            <div
              key={item.step}
              className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                item.done
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
                  : "border-white/10 bg-white/[0.03] text-zinc-300"
              }`}
            >
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                  item.done ? "bg-emerald-500 text-black" : "bg-violet-500/30 text-violet-200"
                }`}
              >
                {item.done ? "✓" : item.step}
              </span>
              <span className="truncate font-medium">{item.text}</span>
            </div>
          ))}
        </div>
      </header>

      {/* Status Notification Banner */}
      {bannerMsg && (
        <div
          className={`mb-4 flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm font-medium ${
            bannerMsg.type === "ok"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : bannerMsg.type === "warn"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          <span>{bannerMsg.text}</span>
          <button onClick={() => setBannerMsg(null)} className="ml-4 text-xs opacity-70 hover:opacity-100">
            ✕
          </button>
        </div>
      )}

      {/* ==================== SPLIT-SCREEN MAIN STAGE ==================== */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* LEFT PANE (5 cols ~45%): Target DeFi Liquid Staking Vault */}
        <section className="flex flex-col gap-4 lg:col-span-5">
          <div className="rounded-2xl border border-white/10 bg-[#141220] p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-violet-400">
                    受保護的目標協議前端
                  </span>
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                    8.4% APY
                  </span>
                </div>
                <h2 className="mt-0.5 text-lg font-bold text-white">Monad Liquid Staking Vault</h2>
              </div>

              {/* Wallet Mode Toggle */}
              <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5 text-xs">
                <button
                  onClick={() => setWalletMode("demo")}
                  className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                    walletMode === "demo" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  ⚡ 極速演練
                </button>
                <button
                  onClick={handleConnectMetaMask}
                  className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                    walletMode === "metamask" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  🦊 MetaMask
                </button>
              </div>
            </div>

            {/* Subtle attacker payload notice so judges see what was silently swapped */}
            {hijacked && (
              <div className="mb-4 rounded-xl border border-red-500/40 bg-red-950/40 px-3 py-2 text-xs text-red-200">
                <div className="flex items-center gap-1.5 font-bold text-red-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  [演練上帝視角] 前端 UI 看起來毫無破綻，但惡意 JS 已暗中竄改提款收款人！
                </div>
                <div className="mt-1 font-mono text-[11px] text-red-300/90">
                  withdraw(recipient = {DRAINER_ADDRESS}, 0.05 MON)
                </div>
              </div>
            )}

            {/* Account & Balance Summary */}
            <div className="mb-4 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Wallet className="h-3.5 w-3.5 text-violet-400" />
                  我的金庫質押餘額
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-white">
                  {status ? Number(status.user.vaultBalanceMon).toFixed(3) : "--"}{" "}
                  <span className="text-sm text-violet-300">MON</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-400">
                  地址: {shortAddr(activeUserAddress || "")}
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                  <Fingerprint className="h-3.5 w-3.5 text-emerald-400" />
                  硬體 Passkey 狀態
                </div>
                <div className="mt-1 text-base font-bold">
                  {localKeyMatchesChain ? (
                    <span className="text-emerald-400">✅ 本機硬體已綁定</span>
                  ) : status?.user.passkeyRegistered ? (
                    <span className="text-amber-300">⚠️ 鏈上已有舊金鑰（請重綁）</span>
                  ) : (
                    <span className="text-zinc-400">尚未綁定</span>
                  )}
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-400">
                  防重放 Nonce: #{status?.user.nonce ?? "0"} · 協議 TVL: {status ? Number(status.tvlMon).toFixed(2) : "--"} MON
                </div>
              </div>
            </div>

            {/* Action Buttons: Deposit & Bind Passkey */}
            <div className="mb-3 grid grid-cols-2 gap-2.5">
              <button
                onClick={handleDeposit}
                disabled={busyAction !== null}
                className="flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-lg shadow-violet-600/20 hover:bg-violet-500 cursor-pointer disabled:opacity-50"
              >
                <Zap className="h-4 w-4" />
                {busyAction === "deposit" ? "上鏈確認中..." : "存入 0.10 MON"}
              </button>

              <button
                onClick={handleBindPasskey}
                disabled={busyAction !== null}
                className="flex items-center justify-center gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/15 px-4 py-3 text-sm font-bold text-emerald-200 hover:bg-emerald-500/25 cursor-pointer disabled:opacity-50"
              >
                <KeyRound className="h-4 w-4" />
                {busyAction === "passkey"
                  ? "等待硬體授權..."
                  : passkeyMode === "webauthn"
                  ? "綁定 TouchID / FaceID"
                  : "綁定 P-256 備援密鑰"}
              </button>
            </div>

            {/* Standard Withdraw Button (Looks completely normal even when hijacked!) */}
            <button
              onClick={handleWithdraw}
              disabled={busyAction !== null}
              className="w-full rounded-xl border border-white/15 bg-white/10 px-4 py-3.5 text-sm font-bold text-white hover:bg-white/15 cursor-pointer disabled:opacity-50"
            >
              {busyAction === "withdraw"
                ? "交易送往 Monad Testnet..."
                : "💸 一鍵普通提款 0.05 MON（測試前端提款路徑）"}
            </button>

            {/* Real On-Chain Revert Proof Box */}
            {blockedAlert && (
              <div className="mt-4 rounded-xl border border-emerald-400/60 bg-emerald-950/40 p-3.5">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300">
                  <Shield className="h-5 w-5 shrink-0" />
                  盜幣交易已於 Monad 合約層強制攔截！資金零損失！
                </div>
                <div className="mt-2 space-y-1 font-mono text-xs text-zinc-200">
                  <div>
                    <span className="text-zinc-400">On-Chain Revert: </span>
                    <span className="font-bold text-red-300">{blockedAlert.errorName}</span>
                  </div>
                  <div>
                    <span className="text-zinc-400">遭阻斷的駭客收款地址: </span>
                    <span className="text-red-300">{blockedAlert.attemptedRecipient}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* HARDWARE ESCAPE HATCH CARD (Always visible, glows when tripped!) */}
          <div
            className={`rounded-2xl border p-5 transition-all ${
              isTripped
                ? "border-emerald-400/70 bg-gradient-to-br from-emerald-950/50 via-[#131823] to-violet-950/40 shadow-2xl shadow-emerald-500/15"
                : "border-white/10 bg-[#141220]/80"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className={`h-5 w-5 ${isTripped ? "text-emerald-400" : "text-violet-400"}`} />
                <h3 className="text-base font-bold text-white">
                  硬體逃生艙（EIP-7951 `0x0100` 鏈上驗簽）
                </h3>
              </div>
              <button
                onClick={() => setPasskeyMode((m) => (m === "webauthn" ? "webcrypto" : "webauthn"))}
                className="rounded-lg border border-white/15 bg-black/40 px-2 py-1 text-[11px] font-medium text-zinc-300 hover:text-white cursor-pointer"
                title="若無生物辨識設備可切換為 WebCrypto 本地 P-256，同樣由 Monad 0x0100 原生預編譯驗證"
              >
                {passkeyMode === "webauthn" ? "模式: TouchID/FaceID" : "模式: WebCrypto P-256 備援"}
              </button>
            </div>

            <p className="mt-2 text-xs leading-relaxed text-zinc-300">
              熔斷不會凍結您的資產，而是降級為 <strong className="text-emerald-300">PASSKEY_ONLY</strong>{" "}
              安全模式：安全收款地址與金額直接透過密碼學鎖死在硬體簽名挑戰中，即便前端仍被劫持，駭客也無法竄改收款人。
            </p>

            <div className="mt-3 rounded-xl border border-white/10 bg-black/40 px-3 py-2 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-zinc-400">硬體鎖定安全收款人:</span>
                <span className="font-bold text-emerald-300">{shortAddr(activeUserAddress || "")}</span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-zinc-400">鏈上驗簽預編譯:</span>
                <span className="text-violet-300">0x0000...0100 (secp256r1 · 6,900 gas)</span>
              </div>
            </div>

            <button
              onClick={handleHardwareEscape}
              disabled={busyAction !== null}
              className={`mt-3 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3.5 text-sm font-bold transition-all cursor-pointer disabled:opacity-50 ${
                isTripped
                  ? "bg-emerald-500 text-black shadow-lg shadow-emerald-500/30 hover:bg-emerald-400"
                  : "border border-emerald-500/40 bg-emerald-500/20 text-emerald-200 hover:bg-emerald-500/30"
              }`}
            >
              <Fingerprint className="h-5 w-5" />
              {busyAction === "escape"
                ? "等待 TouchID / 0x0100 鏈上驗證..."
                : passkeyMode === "webauthn"
                ? "👆 按下 TouchID / FaceID 安全取回 0.05 MON"
                : "🔐 使用 WebCrypto P-256 過 0x0100 取回 0.05 MON"}
            </button>

            {lastRecoveryProof && (
              <div className="mt-3 rounded-xl border border-emerald-400/50 bg-emerald-500/15 p-3 text-xs">
                <div className="flex items-center justify-between font-bold text-emerald-300">
                  <span className="flex items-center gap-1.5">
                    <CheckCircle2 className="h-4 w-4" />
                    Monad 0x0100 預編譯驗簽成功！資產已安全取回
                  </span>
                  <span className="font-mono">{lastRecoveryProof.latencyMs} ms</span>
                </div>
                <div className="mt-1.5 space-y-0.5 font-mono text-[11px] text-emerald-100/90">
                  <div>驗證路徑: {lastRecoveryProof.method}</div>
                  <div>實際總 Gas: {Number(lastRecoveryProof.gasUsed).toLocaleString()} gas</div>
                  <a
                    href={`${EXPLORER_URL}/tx/${lastRecoveryProof.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-300 underline hover:text-violet-200"
                  >
                    查看 MonadVision 鏈上交易: {shortHash(lastRecoveryProof.txHash)}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT PANE (7 cols ~55%): ZeroDrain Sub-Second Security War Room */}
        <section className="flex flex-col gap-4 lg:col-span-7">
          {/* Card 1 & 2 Grid: SRI Integrity + Pre-Tx Trace Calldata Diff */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {/* Card 1: Frontend SRI Hash Comparator */}
            <div
              className={`rounded-2xl border bg-[#141220] p-4 ${
                hijacked || inspection?.sriCheck.mismatch ? "border-red-500/60" : "border-white/10"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  ① 前端 SRI 完整性指紋監控
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    hijacked || inspection?.sriCheck.mismatch
                      ? "bg-red-500/20 text-red-300"
                      : "bg-emerald-500/20 text-emerald-300"
                  }`}
                >
                  {hijacked || inspection?.sriCheck.mismatch ? "❌ HASH 漂移警報" : "✅ 指紋一致"}
                </span>
              </div>
              <div className="space-y-2 font-mono text-xs">
                <div className="rounded-lg bg-black/40 p-2.5">
                  <div className="text-[10px] text-zinc-400">鏈上註冊合法雜湊 (trustedFrontendHash)</div>
                  <div className="mt-0.5 break-all text-emerald-300">
                    {shortHash(status?.trustedHash)}
                  </div>
                </div>
                <div
                  className={`rounded-lg p-2.5 ${
                    hijacked ? "bg-red-950/50 border border-red-500/40" : "bg-black/40"
                  }`}
                >
                  <div className="text-[10px] text-zinc-400">
                    即時偵測前端雜湊 ({manifest?.bundleName || "..."})
                  </div>
                  <div className={`mt-0.5 break-all ${hijacked ? "font-bold text-red-300" : "text-zinc-200"}`}>
                    {shortHash(manifest?.sriHash)}
                  </div>
                </div>
                <div className="text-[11px] text-zinc-400">
                  DNS 來源:{" "}
                  <span className={hijacked ? "font-bold text-red-300" : "text-zinc-200"}>
                    {manifest?.dnsProvider || "cloudflare-dnssec"}
                  </span>
                </div>
              </div>
            </div>

            {/* Card 2: Pre-Tx Call Tracer Diff */}
            <div
              className={`rounded-2xl border bg-[#141220] p-4 ${
                hijacked ? "border-red-500/60" : "border-white/10"
              }`}
            >
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  ② 交易前追蹤模擬（Calldata Diff）
                </span>
                <span className="rounded bg-violet-500/20 px-2 py-0.5 font-mono text-[10px] text-violet-200">
                  {inspection?.calldataDiff.traceMethod || "debug_traceCall"}
                </span>
              </div>
              <div className="space-y-2 font-mono text-xs">
                <div className="rounded-lg bg-black/40 p-2.5">
                  <div className="flex justify-between text-[11px]">
                    <span className="text-zinc-400">預期收款人:</span>
                    <span className="text-emerald-300">{shortAddr(activeUserAddress || "")}</span>
                  </div>
                  <div className="mt-1.5 flex justify-between text-[11px]">
                    <span className="text-zinc-400">實際 Calldata 收款人:</span>
                    <span className={hijacked ? "font-bold text-red-400" : "text-emerald-300"}>
                      {hijacked ? `${shortAddr(DRAINER_ADDRESS)} ⚠️ DRAINER!` : shortAddr(activeUserAddress || "")}
                    </span>
                  </div>
                </div>
                <div className="rounded-lg bg-black/40 p-2 text-[10px] text-zinc-400">
                  <div className="mb-0.5 flex justify-between">
                    <span>Encoded withdraw() Calldata</span>
                    {inspection && (
                      <span className="text-violet-300">{inspection.calldataDiff.traceLatencyMs} ms</span>
                    )}
                  </div>
                  <div className="truncate text-zinc-300">{previewCalldata}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Sub-Second Circuit Breaker Telemetry */}
          <div className="rounded-2xl border border-violet-500/25 bg-[#141220] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity className="h-4 w-4 text-violet-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  ③ Monad 亞秒鏈上熔斷遙測（MIP-12 300ms / 600ms Finality）
                </span>
              </div>
              <span className="font-mono text-[11px] text-zinc-400">
                哨兵: {shortAddr(status?.sentinelAddress)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-[11px] text-zinc-400">最近熔斷確認延遲</div>
                <div className="mt-1 font-mono text-2xl font-extrabold text-violet-300">
                  {inspection?.breakerTx && inspection.breakerTx.latencyMs > 0
                    ? `${inspection.breakerTx.latencyMs} ms`
                    : isTripped
                    ? "< 600 ms"
                    : "待機中"}
                </div>
                <div className="text-[10px] text-zinc-500">eth_sendRawTransactionSync</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-[11px] text-zinc-400">熔斷生效區塊</div>
                <div className="mt-1 font-mono text-xl font-bold text-white">
                  {status && status.trippedBlock !== "0"
                    ? `#${Number(status.trippedBlock).toLocaleString()}`
                    : "--"}
                </div>
                <div className="text-[10px] text-zinc-500">1–2 Monad Blocks</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-[11px] text-zinc-400">累計成功熔斷次數</div>
                <div className="mt-1 font-mono text-2xl font-bold text-red-300">
                  {status?.tripCount ?? "0"}
                </div>
                <div className="text-[10px] text-zinc-500">鏈上永久計數器</div>
              </div>

              <div className="rounded-xl border border-white/10 bg-black/40 p-3">
                <div className="text-[11px] text-zinc-400">0x0100 硬體逃生成功</div>
                <div className="mt-1 font-mono text-2xl font-bold text-emerald-300">
                  {status?.emergencyRecoveryCount ?? "0"}
                </div>
                <div className="text-[10px] text-zinc-500">6,900 gas 原生驗簽</div>
              </div>
            </div>

            {inspection?.breakerTx?.txHash && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-500/35 bg-red-500/10 px-3 py-2 font-mono text-xs">
                <span className="text-red-200">
                  🚨 熔斷上鏈證據 Tx: {shortHash(inspection.breakerTx.txHash)}
                </span>
                <div className="flex gap-3">
                  <a
                    href={`${EXPLORER_URL}/tx/${inspection.breakerTx.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-300 underline"
                  >
                    MonadVision <ExternalLink className="h-3 w-3" />
                  </a>
                  <a
                    href={`${MONADSCAN_URL}/tx/${inspection.breakerTx.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-violet-300 underline"
                  >
                    Monadscan <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Card 4: Live On-Chain Audit Trail */}
          <div className="flex-1 rounded-2xl border border-white/10 bg-[#141220] p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-300">
                  ④ 實時鏈上攻防審計流（Real Monad Testnet Transactions）
                </span>
              </div>
              <span className="font-mono text-[11px] text-zinc-500">{logs.length} 筆紀錄</span>
            </div>

            {logs.length === 0 ? (
              <div className="rounded-xl border border-dashed border-white/10 bg-black/25 p-6 text-center text-xs text-zinc-400">
                點擊左側「存入 0.10 MON」與「綁定 TouchID」，接著開啟頂部「☢️ 模擬 Name.com DNS 劫持」，所有真實 Monad Testnet 交易與攔截日誌將即時顯示於此。
              </div>
            ) : (
              <div className="max-h-[260px] space-y-2 overflow-y-auto pr-1">
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-xl border px-3 py-2 text-xs ${
                      log.level === "alert"
                        ? "border-red-500/40 bg-red-950/35"
                        : log.level === "blocked"
                        ? "border-emerald-400/50 bg-emerald-950/35"
                        : log.level === "safe"
                        ? "border-emerald-500/25 bg-black/40"
                        : "border-violet-500/25 bg-black/40"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-white">{log.title}</span>
                      <div className="flex items-center gap-2 font-mono text-[11px] text-zinc-400">
                        {log.latencyMs ? (
                          <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-violet-200">
                            {log.latencyMs} ms
                          </span>
                        ) : null}
                        <span>{log.time}</span>
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-zinc-300">
                      <span>{log.detail}</span>
                      {log.txHash && (
                        <a
                          href={`${EXPLORER_URL}/tx/${log.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-violet-300 underline hover:text-violet-200"
                        >
                          {shortHash(log.txHash)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ==================== BOTTOM ARCHITECTURE & BUSINESS MODEL STRIP ==================== */}
      <footer className="mt-4 grid grid-cols-1 gap-3 rounded-2xl border border-white/10 bg-[#12101c]/80 p-4 text-xs md:grid-cols-3">
        <div className="rounded-xl border border-white/5 bg-black/30 p-3">
          <div className="font-bold text-violet-300">⚡ 為何只能建在 Monad？</div>
          <p className="mt-1 leading-relaxed text-zinc-400">
            依賴 MIP-12 <strong>300ms 出塊 / 600ms 最終確定性</strong> 與{" "}
            <code className="text-zinc-200">eth_sendRawTransactionSync</code> 實現 1 秒內熔斷生效（以太坊 12s 鏈來不及止損），並直連原生{" "}
            <code className="text-zinc-200">0x0100</code> EIP-7951 預編譯，僅 6,900 gas 即可在鏈上驗證 TouchID/FaceID。
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-black/30 p-3">
          <div className="font-bold text-emerald-300">🛡️ 兩層清晰防禦邊界（零假陽性 DoS）</div>
          <p className="mt-1 leading-relaxed text-zinc-400">
            ① <strong>協議層（本機實測）</strong>：鎖死質押/金庫合約的提款外流，降級至{" "}
            <code className="text-zinc-200">PASSKEY_ONLY</code> 永不凍結用戶資金；②{" "}
            <strong>錢包層延伸</strong>：同套 <code className="text-zinc-200">0x0100</code> 模組可無縫掛載為{" "}
            <strong>EIP-7702 Wallet Guard Hook</strong> 攔截惡意 ERC-20 approve。
          </p>
        </div>
        <div className="rounded-xl border border-white/5 bg-black/30 p-3">
          <div className="font-bold text-amber-300">💼 可持續商業模型（B2B + 保險飛輪）</div>
          <p className="mt-1 leading-relaxed text-zinc-400">
            DeFi 協議按 TVL 階梯付月費接入 3 行合約修飾器 + 去中心化白帽哨兵質押 MON 搶單報警分潤 + 與鏈上保險合作提供接入協議保費折扣。合約地址：
            <a
              href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noreferrer"
              className="ml-1 font-mono text-violet-300 underline"
            >
              {shortAddr(VAULT_ADDRESS)}
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
