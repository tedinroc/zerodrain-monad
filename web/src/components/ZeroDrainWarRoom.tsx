"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cpu,
  ExternalLink,
  Fingerprint,
  Globe,
  KeyRound,
  Lock,
  Plus,
  RotateCcw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Wallet,
  Zap,
} from "lucide-react";
import {
  BaseError,
  ContractFunctionRevertedError,
  createWalletClient,
  custom,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { ZERO_DRAIN_VAULT_ABI } from "@/lib/abi";
import {
  DICTIONARIES,
  LOCALE_LABELS,
  detectInitialLocale,
  type Locale,
} from "@/lib/i18n";
import { DRAINER_ADDRESS } from "@/lib/manifest";
import { EXPLORER_URL, monadTestnet, publicClient, VAULT_ADDRESS } from "@/lib/monad";
import {
  createHardwareWebAuthnPasskey,
  createWebCryptoP256Key,
  loadStoredWebAuthn,
  loadStoredWebCrypto,
  signHardwareWebAuthnChallenge,
  signWebCryptoP256Challenge,
  type NonExtractableWebCryptoHandle,
  type PasskeyMode,
  type StoredWebAuthnCredential,
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
  tripCount: string;
  emergencyRecoveryCount: string;
  tvlMon: string;
  user: {
    address: Address;
    lockedRecoveryAddress?: Address;
    vaultBalanceWei: string;
    vaultBalanceMon: string;
    walletBalanceMon: string;
    passkeyRegistered: boolean;
    passkeyQx: Hex;
    passkeyQy: Hex;
    nonce: string;
  };
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
    expectedRecipient: string;
    actualRecipient: string;
    recipientMismatch: boolean;
    traceMethod: string;
    traceLatencyMs: number;
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

interface AuditEntry {
  id: string;
  time: string;
  kind: "safe" | "alert" | "blocked" | "info";
  label: string;
  txHash?: string;
  latencyMs?: number;
}

function shortAddr(addr?: string) {
  if (!addr || addr.length < 12) return addr || "--";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function shortHash(hash?: string) {
  if (!hash || hash.length < 16) return hash || "--";
  return `${hash.slice(0, 10)}...${hash.slice(-6)}`;
}

function timeStamp() {
  return new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

declare global {
  interface Window {
    ethereum?: {
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
    };
  }
}

export default function ZeroDrainWarRoom() {
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const t = DICTIONARIES[locale];

  const [walletMode, setWalletMode] = useState<"demo" | "metamask">("demo");
  const [connectedWallet, setConnectedWallet] = useState<Address | null>(null);
  const [passkeyMode, setPasskeyMode] = useState<PasskeyMode>("webauthn");
  const [storedWebAuthn, setStoredWebAuthn] = useState<StoredWebAuthnCredential | null>(null);
  const [storedWebCrypto, setStoredWebCrypto] = useState<NonExtractableWebCryptoHandle | null>(null);

  const [status, setStatus] = useState<VaultStatusResponse | null>(null);
  const [hijacked, setHijacked] = useState(false);
  const [inspection, setInspection] = useState<SentinelInspection | null>(null);
  const [blockedAlert, setBlockedAlert] = useState<{
    errorName: string;
    attemptedRecipient: string;
  } | null>(null);
  const [recoveryProof, setRecoveryProof] = useState<{
    txHash: string;
    latencyMs: number;
    gasUsed: string;
  } | null>(null);

  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "ok" | "err" | "warn"; text: string } | null>(null);
  const [logs, setLogs] = useState<AuditEntry[]>([]);
  const [showJudgeDetails, setShowJudgeDetails] = useState(false);

  const fetchIdRef = useRef(0);
  const prevModeRef = useRef<"NORMAL" | "PASSKEY_ONLY" | null>(null);

  useEffect(() => {
    const initial = detectInitialLocale();
    setLocale(initial);
    if (typeof document !== "undefined") {
      document.documentElement.lang = initial;
    }
    setStoredWebAuthn(loadStoredWebAuthn());
    void loadStoredWebCrypto().then((k) => setStoredWebCrypto(k));
  }, []);

  const changeLocale = (next: Locale) => {
    setLocale(next);
    if (typeof window !== "undefined") {
      localStorage.setItem("zerodrain_locale", next);
      document.documentElement.lang = next;
    }
  };

  const pushLog = useCallback((entry: Omit<AuditEntry, "id" | "time">) => {
    setLogs((prev) => [
      { ...entry, id: `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`, time: timeStamp() },
      ...prev.slice(0, 9),
    ]);
  }, []);

  const activeUserAddress = useMemo(() => {
    if (walletMode === "metamask" && connectedWallet) return connectedWallet;
    return status?.demoAddress ?? null;
  }, [walletMode, connectedWallet, status?.demoAddress]);

  const fetchStatus = useCallback(async () => {
    const reqId = ++fetchIdRef.current;
    try {
      const qs = walletMode === "metamask" && connectedWallet ? `?user=${connectedWallet}` : "";
      const res = await fetch(`/api/vault/status${qs}`, { cache: "no-store" });
      const data = (await res.json()) as VaultStatusResponse;
      if (reqId !== fetchIdRef.current) return; // Discard stale out-of-order response
      if (data.ok) {
        if (prevModeRef.current === "PASSKEY_ONLY" && data.mode === "NORMAL") {
          setHijacked(false);
          setInspection(null);
          setBlockedAlert(null);
        }
        prevModeRef.current = data.mode;
        setStatus(data);
      }
    } catch {
      // ignore transient network hiccup
    }
  }, [walletMode, connectedWallet]);

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  const isTripped = status?.mode === "PASSKEY_ONLY";
  const hasBalance = Boolean(status && Number(status.user.vaultBalanceMon) >= 0.05);

  const localKeyMatchesChain = useMemo(() => {
    if (!status?.user.passkeyRegistered) return false;
    const local = passkeyMode === "webauthn" ? storedWebAuthn : storedWebCrypto;
    if (!local) return false;
    return (
      local.qx.toLowerCase() === status.user.passkeyQx.toLowerCase() &&
      local.qy.toLowerCase() === status.user.passkeyQy.toLowerCase()
    );
  }, [status?.user, passkeyMode, storedWebAuthn, storedWebCrypto]);

  // Compute current active spotlight step (1..4, or 5 = completed!)
  const activeStep: 1 | 2 | 3 | 4 | 5 = useMemo(() => {
    if (recoveryProof) return 5;
    if (blockedAlert && isTripped) return 4;
    if (isTripped) return 3;
    if (localKeyMatchesChain && hasBalance) return 2;
    return 1;
  }, [recoveryProof, blockedAlert, isTripped, localKeyMatchesChain, hasBalance]);

  const getBrowserWalletClient = () => {
    if (!window.ethereum || !connectedWallet) throw new Error("Wallet not connected");
    return createWalletClient({
      account: connectedWallet,
      chain: monadTestnet,
      transport: custom(window.ethereum),
    });
  };

  const handleConnectMetaMask = async () => {
    if (!window.ethereum) {
      setToast({ type: "warn", text: t.toastNoMetaMask });
      return;
    }
    try {
      setBusy("connect");
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
      setToast({ type: "ok", text: t.toastMetaMaskConnected(shortAddr(accounts[0])) });
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Connect failed" });
    } finally {
      setBusy(null);
    }
  };

  const handleDeposit = async () => {
    setBusy("deposit");
    setToast(null);
    try {
      if (walletMode === "demo") {
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "deposit", amountMon: "0.1" }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        pushLog({ kind: "safe", label: t.logDeposit, txHash: data.txHash, latencyMs: data.latencyMs });
        setToast({ type: "ok", text: t.toastDepositOk(data.latencyMs) });
      } else {
        const t0 = Date.now();
        const wc = getBrowserWalletClient();
        const hash = await wc.writeContract({
          address: VAULT_ADDRESS,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "deposit",
          value: parseEther("0.1"),
        });
        await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const ms = Date.now() - t0;
        pushLog({ kind: "safe", label: t.logDeposit, txHash: hash, latencyMs: ms });
        setToast({ type: "ok", text: t.toastDepositOk(ms) });
      }
      await fetchStatus();
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Deposit failed" });
    } finally {
      setBusy(null);
    }
  };

  // Step 1: 1-Click Bind Hardware Key (+ auto-deposit 0.1 MON in Demo mode if balance < 0.05)
  const handleStep1Setup = async () => {
    setBusy("bind");
    setToast(null);
    try {
      let qx: Hex;
      let qy: Hex;
      if (passkeyMode === "webauthn") {
        const cred = await createHardwareWebAuthnPasskey(activeUserAddress || "Monad");
        setStoredWebAuthn(cred);
        qx = cred.qx;
        qy = cred.qy;
      } else {
        const cred = await createWebCryptoP256Key();
        setStoredWebCrypto(cred);
        qx = cred.qx;
        qy = cred.qy;
      }

      if (walletMode === "demo") {
        // Ensure vault has >= 0.05 MON automatically for frictionless judge testing
        if (!hasBalance) {
          const depRes = await fetch("/api/demo/action", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "deposit", amountMon: "0.1" }),
          });
          const depData = await depRes.json();
          if (depData.ok) {
            pushLog({ kind: "safe", label: t.logDeposit, txHash: depData.txHash, latencyMs: depData.latencyMs });
          }
        }
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "registerPasskey", qx, qy }),
        });
        const data = await res.json();
        if (!data.ok) throw new Error(data.error);
        pushLog({
          kind: "info",
          label: passkeyMode === "webauthn" ? t.logBindWebAuthn : t.logBindWebCrypto,
          txHash: data.txHash,
          latencyMs: data.latencyMs,
        });
        setToast({ type: "ok", text: t.toastBindOk(data.latencyMs) });
      } else {
        const t0 = Date.now();
        const wc = getBrowserWalletClient();
        const hash = await wc.writeContract({
          address: VAULT_ADDRESS,
          abi: ZERO_DRAIN_VAULT_ABI,
          functionName: "registerPasskey",
          args: [qx, qy],
        });
        await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
        const ms = Date.now() - t0;
        pushLog({
          kind: "info",
          label: passkeyMode === "webauthn" ? t.logBindWebAuthn : t.logBindWebCrypto,
          txHash: hash,
          latencyMs: ms,
        });
        setToast({
          type: "ok",
          text: hasBalance ? t.toastBindOk(ms) : t.toastBindNeedDeposit(ms),
        });
      }
      await fetchStatus();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Bind failed";
      setToast({ type: "err", text: `${msg} ${t.toastBindHintFallback}` });
    } finally {
      setBusy(null);
    }
  };

  // Step 2: Simulate Name.com DNS Hijack -> Sub-Second Sentinel Trip!
  const handleTriggerHijack = async () => {
    setBusy("hijack");
    setToast(null);
    setHijacked(true);
    setBlockedAlert(null);
    setRecoveryProof(null);

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
      if (!data.ok) throw new Error(data.error || "Sentinel failed");

      setInspection(data);
      if (data.breakerTx && !data.breakerTx.alreadyTripped) {
        pushLog({
          kind: "alert",
          label: t.logTripped(data.breakerTx.latencyMs),
          txHash: data.breakerTx.txHash,
          latencyMs: data.breakerTx.latencyMs,
        });
        setToast({ type: "ok", text: t.toastTrippedOk(data.breakerTx.latencyMs) });
      } else {
        setToast({ type: "warn", text: t.toastAlreadyTripped });
      }
      await fetchStatus();
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Hijack simulation failed" });
    } finally {
      setBusy(null);
    }
  };

  // Step 3: Attempt Hijacked Withdraw -> On-Chain Revert!
  const handleTryHijackedWithdraw = async () => {
    setBusy("withdraw");
    setToast(null);
    const targetRecipient: Address = hijacked || isTripped ? DRAINER_ADDRESS : (activeUserAddress as Address);

    try {
      if (walletMode === "demo") {
        const res = await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "withdraw", hijacked: true, amountMon: "0.05" }),
        });
        const data = await res.json();
        if (data.blockedOnChain) {
          setBlockedAlert({
            errorName: data.errorName || "VaultInPasskeyOnlyMode",
            attemptedRecipient: data.attemptedRecipient || DRAINER_ADDRESS,
          });
          pushLog({ kind: "blocked", label: t.logBlocked });
          setToast({ type: "ok", text: t.toastBlockedOk });
          return;
        }
        if (!data.ok) throw new Error(data.error);
        pushLog({ kind: "safe", label: t.logNormalWithdraw, txHash: data.txHash, latencyMs: data.latencyMs });
      } else {
        try {
          await publicClient.simulateContract({
            account: connectedWallet!,
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "withdraw",
            args: [targetRecipient, parseEther("0.05")],
          });
        } catch (simErr) {
          // F-04: Decode the actual EVM revert selector instead of assuming VaultInPasskeyOnlyMode
          let errorName: string | null = null;
          if (simErr instanceof BaseError) {
            const revertErr = simErr.walk((e) => e instanceof ContractFunctionRevertedError);
            if (revertErr instanceof ContractFunctionRevertedError && revertErr.data?.errorName) {
              errorName = revertErr.data.errorName;
            }
          }
          if (isTripped && errorName === "VaultInPasskeyOnlyMode") {
            setBlockedAlert({
              errorName,
              attemptedRecipient: targetRecipient,
            });
            pushLog({ kind: "blocked", label: t.logBlocked });
            setToast({ type: "ok", text: t.toastBlockedOk });
            return;
          }
          throw new Error(
            errorName
              ? `Preflight simulation reverted with ${errorName} (not circuit breaker)`
              : simErr instanceof Error
              ? simErr.message
              : "Withdraw simulation failed"
          );
        }
      }
      await fetchStatus();
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Withdraw test failed" });
    } finally {
      setBusy(null);
    }
  };

  // Step 4: Hardware Escape via Monad 0x0100 Precompile!
  const handleHardwareEscape = async () => {
    if (!activeUserAddress) return;
    if (!localKeyMatchesChain) {
      setToast({ type: "warn", text: t.toastNeedBind });
      return;
    }
    setBusy("escape");
    setToast(null);

    try {
      // In Demo mode, ensure vault has >= 0.05 MON if another concurrent tester emptied it
      if (walletMode === "demo" && !hasBalance) {
        await fetch("/api/demo/action", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "deposit", amountMon: "0.1" }),
        });
      }

      const chRes = await fetch(
        `/api/vault/challenge?user=${activeUserAddress}&amountMon=0.05`,
        { cache: "no-store" }
      );
      const chData = await chRes.json();
      if (!chData.ok) throw new Error(chData.error);

      if (passkeyMode === "webauthn") {
        if (!storedWebAuthn) throw new Error("Missing Passkey");
        const signed = await signHardwareWebAuthnChallenge({
          credentialId: storedWebAuthn.id,
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
          setRecoveryProof({ txHash: data.txHash, latencyMs: data.latencyMs, gasUsed: data.gasUsed });
          pushLog({ kind: "safe", label: t.logEscapedWebAuthn, txHash: data.txHash, latencyMs: data.latencyMs });
          setToast({ type: "ok", text: t.toastRecoveredOk(data.latencyMs) });
        } else {
          const t0 = Date.now();
          const wc = getBrowserWalletClient();
          const hash = await wc.writeContract({
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "emergencyWithdrawWithWebAuthn",
            args: [
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
          const ms = Date.now() - t0;
          setRecoveryProof({ txHash: hash, latencyMs: ms, gasUsed: receipt.gasUsed.toString() });
          pushLog({ kind: "safe", label: t.logEscapedWebAuthn, txHash: hash, latencyMs: ms });
          setToast({ type: "ok", text: t.toastRecoveredOk(ms) });
        }
      } else {
        if (!storedWebCrypto) throw new Error("Missing WebCrypto key");
        const { r, s } = await signWebCryptoP256Challenge({
          privateKey: storedWebCrypto.privateKey,
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
          setRecoveryProof({ txHash: data.txHash, latencyMs: data.latencyMs, gasUsed: data.gasUsed });
          pushLog({ kind: "safe", label: t.logEscapedWebCrypto, txHash: data.txHash, latencyMs: data.latencyMs });
          setToast({ type: "ok", text: t.toastRecoveredOk(data.latencyMs) });
        } else {
          const t0 = Date.now();
          const wc = getBrowserWalletClient();
          const hash = await wc.writeContract({
            address: VAULT_ADDRESS,
            abi: ZERO_DRAIN_VAULT_ABI,
            functionName: "emergencyWithdrawWithRawP256",
            args: [parseEther("0.05"), BigInt(chData.deadline), r, s],
          });
          const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 250 });
          const ms = Date.now() - t0;
          setRecoveryProof({ txHash: hash, latencyMs: ms, gasUsed: receipt.gasUsed.toString() });
          pushLog({ kind: "safe", label: t.logEscapedWebCrypto, txHash: hash, latencyMs: ms });
          setToast({ type: "ok", text: t.toastRecoveredOk(ms) });
        }
      }
      await fetchStatus();
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Escape failed" });
    } finally {
      setBusy(null);
    }
  };

  const handleReset = async () => {
    setBusy("reset");
    setToast(null);
    try {
      const res = await fetch("/api/sentinel/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error);
      setHijacked(false);
      setInspection(null);
      setBlockedAlert(null);
      setRecoveryProof(null);
      pushLog({ kind: "info", label: t.logReset, txHash: data.txHash, latencyMs: data.latencyMs });
      setToast({ type: "ok", text: t.toastResetOk(data.latencyMs) });
      await fetchStatus();
    } catch (err) {
      setToast({ type: "err", text: err instanceof Error ? err.message : "Reset failed" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-dvh pb-10">
      {/* ==================== COMPACT STICKY HEADER ==================== */}
      <header className="sticky top-0 z-30 border-b border-white/10 bg-[#09080f]/85 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
          {/* Brand + Live Status Dot */}
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                isTripped
                  ? "border-red-500/60 bg-red-500/20 text-red-400"
                  : "border-violet-400/35 bg-violet-500/20 text-violet-300"
              }`}
            >
              {isTripped ? <ShieldAlert className="h-5 w-5" /> : <ShieldCheck className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-center sm:gap-2">
                <span className="truncate text-sm font-bold tracking-tight text-white sm:text-lg">
                  {t.brandName}
                </span>
                <span
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold sm:text-[11px] ${
                    isTripped
                      ? "bg-red-500/20 text-red-300 border border-red-500/40"
                      : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isTripped ? "animate-ping bg-red-400" : "bg-emerald-400"
                    }`}
                  />
                  {isTripped ? t.modeTripped : t.modeNormal}
                </span>
              </div>
              <p className="hidden text-xs text-zinc-400 md:block">{t.tagline}</p>
            </div>
          </div>

          {/* Right Controls: Language + Reset + Explorer */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            {/* Clean 3-Language Switcher */}
            <div className="flex items-center rounded-lg border border-white/10 bg-white/[0.04] p-0.5 text-xs">
              <Globe className="mx-1.5 hidden h-3.5 w-3.5 text-zinc-400 sm:block" />
              {(["zh-CN", "zh-TW", "en"] as Locale[]).map((loc) => (
                <button
                  key={loc}
                  onClick={() => changeLocale(loc)}
                  className={`rounded-md px-2 py-1 font-semibold transition cursor-pointer ${
                    locale === loc
                      ? "bg-violet-600 text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {LOCALE_LABELS[loc]}
                </button>
              ))}
            </div>

            <button
              onClick={handleReset}
              disabled={busy !== null}
              title={t.resetBtn}
              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-white/10 cursor-pointer disabled:opacity-50"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{busy === "reset" ? t.resettingBtn : t.resetBtn}</span>
            </button>

            <a
              href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
              target="_blank"
              rel="noopener noreferrer"
              title={t.explorerBtn}
              className="inline-flex items-center gap-1 rounded-lg border border-violet-400/30 bg-violet-500/15 px-2.5 py-1.5 text-xs font-semibold text-violet-200 hover:bg-violet-500/25"
            >
              <span className="hidden sm:inline">{t.explorerBtn}</span>
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-7">
        {/* ==================== MINIMAL 4-STEP PROGRESS TRACK ==================== */}
        <nav aria-label="Demo steps" className="mb-5 grid grid-cols-4 gap-1.5 sm:gap-3">
          {t.steps.map((label, idx) => {
            const stepNum = (idx + 1) as 1 | 2 | 3 | 4;
            const isDone = activeStep > stepNum;
            const isCurrent = activeStep === stepNum;
            return (
              <div
                key={label}
                className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-2 text-center text-[11px] font-semibold transition sm:justify-start sm:px-3.5 sm:py-2.5 sm:text-xs ${
                  isDone
                    ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                    : isCurrent
                    ? stepNum === 2 || stepNum === 3
                      ? "border-red-500/60 bg-red-500/15 text-red-200"
                      : "border-violet-400/70 bg-violet-500/15 text-white"
                    : "border-white/10 bg-white/[0.02] text-zinc-500"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                    isDone
                      ? "bg-emerald-500 text-black"
                      : isCurrent
                      ? stepNum === 2 || stepNum === 3
                        ? "bg-red-500 text-white"
                        : "bg-violet-500 text-white"
                      : "bg-white/10 text-zinc-400"
                  }`}
                >
                  {isDone ? <Check className="h-3.5 w-3.5" /> : stepNum}
                </span>
                <span className="hidden truncate sm:inline">{label.replace(/^\d+\.\s*/, "")}</span>
              </div>
            );
          })}
        </nav>

        {/* Subtle Single-Line Toast */}
        {toast && (
          <div
            className={`mb-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs font-medium sm:text-sm ${
              toast.type === "ok"
                ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-200"
                : toast.type === "warn"
                ? "border-amber-500/35 bg-amber-500/10 text-amber-200"
                : "border-red-500/35 bg-red-500/10 text-red-200"
            }`}
          >
            <span>{toast.text}</span>
            <button onClick={() => setToast(null)} className="shrink-0 opacity-70 hover:opacity-100 cursor-pointer">
              ✕
            </button>
          </div>
        )}

        {/* ==================== CLEAN 2-COLUMN HERO STAGE (MOBILE-FIRST STACK) ==================== */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          {/* PRIMARY HERO CARD (Left 7 cols on Desktop, Top on Mobile) */}
          <section
            className={`rounded-3xl border bg-[#13111d] p-5 sm:p-7 lg:col-span-7 transition-all ${
              isTripped && !recoveryProof ? "alert-glow border-red-500/70" : "border-white/10"
            }`}
          >
            {/* Vault Header + Wallet Switch */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wider text-violet-400">
                  {t.vaultLabel}
                </div>
                <h1 className="mt-0.5 text-xl font-bold text-white sm:text-2xl">{t.vaultTitle}</h1>
              </div>

              <div className="flex rounded-xl border border-white/10 bg-black/40 p-1 text-xs">
                <button
                  onClick={() => setWalletMode("demo")}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold transition cursor-pointer ${
                    walletMode === "demo" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <Zap className="h-3.5 w-3.5" />
                  {t.demoWallet}
                </button>
                <button
                  onClick={handleConnectMetaMask}
                  className={`flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-semibold transition cursor-pointer ${
                    walletMode === "metamask" ? "bg-violet-600 text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <Wallet className="h-3.5 w-3.5" />
                  {t.metamaskWallet}
                </button>
              </div>
            </div>

            {/* Clean Key Numbers Strip */}
            <div className="mt-5 grid grid-cols-2 gap-3 rounded-2xl border border-white/10 bg-black/35 p-4">
              <div>
                <div className="text-xs text-zinc-400">{t.vaultBalance}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="font-mono text-2xl font-bold text-white sm:text-3xl">
                    {status ? Number(status.user.vaultBalanceMon).toFixed(2) : "--"}
                  </span>
                  <span className="text-sm font-semibold text-violet-300">MON</span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-[11px] text-zinc-500">
                    {shortAddr(activeUserAddress || "")}
                  </span>
                  <button
                    onClick={handleDeposit}
                    disabled={busy !== null}
                    className="inline-flex items-center gap-0.5 rounded-md bg-white/10 px-1.5 py-0.5 text-[11px] font-semibold text-violet-200 hover:bg-violet-500/30 cursor-pointer disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3" />
                    {busy === "deposit" ? t.depositing : "0.1"}
                  </button>
                </div>
              </div>

              <div className="border-l border-white/10 pl-4">
                <div className="text-xs text-zinc-400">{t.passkeyStatus}</div>
                <div className="mt-1.5 flex items-center gap-1.5 text-base font-bold sm:text-lg">
                  <Fingerprint
                    className={`h-5 w-5 ${localKeyMatchesChain ? "text-emerald-400" : "text-zinc-500"}`}
                  />
                  {localKeyMatchesChain ? (
                    <span className="text-emerald-400">{t.passkeyBound}</span>
                  ) : status?.user.passkeyRegistered ? (
                    <span className="text-amber-300">{t.passkeyOutdated}</span>
                  ) : (
                    <span className="text-zinc-400">{t.passkeyUnbound}</span>
                  )}
                </div>
                <div className="mt-1.5 font-mono text-[11px] text-zinc-500">
                  {passkeyMode === "webauthn" ? "TouchID / FaceID" : "WebCrypto P-256"} · Nonce #{status?.user.nonce ?? "0"}
                </div>
              </div>
            </div>

            {/* X-Ray Hijack Callout (only shown during attack) */}
            {(hijacked || isTripped) && !recoveryProof && (
              <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-red-500/40 bg-red-950/35 px-4 py-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
                <div>
                  <div className="font-bold text-red-200">{t.hijackBannerTitle}</div>
                  <div className="mt-0.5 font-mono text-[11px] text-red-300/90">
                    {t.hijackBannerDesc}
                  </div>
                </div>
              </div>
            )}

            {/* Blocked On-Chain Proof Banner (Step 3 -> 4 transition) */}
            {blockedAlert && !recoveryProof && (
              <div className="mt-4 rounded-2xl border border-emerald-400/50 bg-emerald-950/40 p-4">
                <div className="flex items-center gap-2 text-sm font-bold text-emerald-300 sm:text-base">
                  <Shield className="h-5 w-5 shrink-0" />
                  {t.blockedTitle}
                </div>
                <p className="mt-1 text-xs text-zinc-300">{t.blockedSub}</p>
                <div className="mt-2.5 flex flex-wrap gap-2 font-mono text-[11px]">
                  <span className="rounded-lg bg-red-500/20 px-2 py-1 text-red-200">
                    {t.blockedRevertLabel}: {blockedAlert.errorName}
                  </span>
                  <span className="rounded-lg bg-emerald-500/20 px-2 py-1 font-bold text-emerald-200">
                    {t.blockedLossValue}
                  </span>
                </div>
              </div>
            )}

            {/* ==================== SINGLE FOCUSED HERO ACTION AREA ==================== */}
            <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4 sm:p-5">
              {/* STEP 1: Bind Hardware Key (and guide MetaMask users cleanly to fund 0.1 MON if vault is empty) */}
              {activeStep === 1 && (
                <div>
                  {localKeyMatchesChain && !hasBalance ? (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-zinc-300">{t.step1DepositHint}</p>
                      <button
                        onClick={handleDeposit}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-violet-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="h-5 w-5" />
                        {busy === "deposit" ? t.depositing : t.step1DepositBtn}
                      </button>
                      {walletMode === "metamask" &&
                        status &&
                        Number(status.user.walletBalanceMon) < 0.11 && (
                          <div className="mt-3 rounded-xl border border-amber-400/35 bg-amber-950/30 p-3 text-xs text-amber-200">
                            <p className="leading-relaxed">
                              {t.step1LowWalletHint(status.user.walletBalanceMon)}
                            </p>
                            <button
                              onClick={() => setWalletMode("demo")}
                              className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-400/30 cursor-pointer"
                            >
                              <Zap className="h-3.5 w-3.5" />
                              {t.switchToDemoBtn}
                            </button>
                          </div>
                        )}
                    </>
                  ) : (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-zinc-300">{t.step1Hint}</p>
                      <button
                        onClick={handleStep1Setup}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-violet-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                      >
                        <KeyRound className="h-5 w-5" />
                        {busy === "bind"
                          ? t.step1Busy
                          : passkeyMode === "webauthn"
                          ? t.step1BtnWebAuthn
                          : t.step1BtnWebCrypto}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* STEP 2: Trigger DNS Hijack */}
              {activeStep === 2 && (
                <div>
                  <p className="mb-4 text-sm leading-relaxed text-zinc-300">{t.step2Hint}</p>
                  <button
                    onClick={handleTriggerHijack}
                    disabled={busy !== null}
                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-red-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-red-600/30 transition hover:bg-red-500 cursor-pointer disabled:opacity-50"
                  >
                    <AlertTriangle className="h-5 w-5" />
                    {busy === "hijack" ? t.step2Busy : t.step2Btn}
                  </button>
                </div>
              )}

              {/* STEP 3: Try Hijacked Withdraw -> Observe On-Chain Revert */}
              {activeStep === 3 && (
                <div>
                  <p className="mb-4 text-sm leading-relaxed text-zinc-300">{t.step3Hint}</p>
                  <button
                    onClick={handleTryHijackedWithdraw}
                    disabled={busy !== null}
                    className="flex w-full items-center justify-center gap-2.5 rounded-2xl border border-amber-400/50 bg-amber-500/20 px-5 py-4 text-base font-bold text-amber-100 transition hover:bg-amber-500/30 cursor-pointer disabled:opacity-50"
                  >
                    <ShieldAlert className="h-5 w-5 text-amber-300" />
                    {busy === "withdraw" ? t.step3Busy : t.step3Btn}
                  </button>
                </div>
              )}

              {/* STEP 4: Hardware Escape via Monad 0x0100 (v2 freezes Passkey mutation during PASSKEY_ONLY!) */}
              {activeStep === 4 && (
                <div>
                  {!localKeyMatchesChain ? (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-amber-200">{t.step4NeedBindHint}</p>
                      <button
                        onClick={handleReset}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-violet-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                      >
                        <RotateCcw className="h-5 w-5" />
                        {busy === "reset" ? t.resettingBtn : t.replayBtn}
                      </button>
                    </>
                  ) : !hasBalance && walletMode === "metamask" ? (
                    <>
                      <p className="mb-4 text-sm leading-relaxed text-zinc-300">{t.step1DepositHint}</p>
                      <button
                        onClick={handleDeposit}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-violet-600 px-5 py-4 text-base font-bold text-white shadow-lg shadow-violet-600/25 transition hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                      >
                        <Plus className="h-5 w-5" />
                        {busy === "deposit" ? t.depositing : t.step1DepositBtn}
                      </button>
                      {status && Number(status.user.walletBalanceMon) < 0.11 && (
                        <div className="mt-3 rounded-xl border border-amber-400/35 bg-amber-950/30 p-3 text-xs text-amber-200">
                          <p className="leading-relaxed">
                            {t.step1LowWalletHint(status.user.walletBalanceMon)}
                          </p>
                          <button
                            onClick={() => setWalletMode("demo")}
                            className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-amber-400/20 px-3 py-1.5 font-semibold text-amber-100 hover:bg-amber-400/30 cursor-pointer"
                          >
                            <Zap className="h-3.5 w-3.5" />
                            {t.switchToDemoBtn}
                          </button>
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <p className="mb-3 text-sm leading-relaxed text-zinc-300">{t.step4Hint}</p>
                      <div className="mb-4 flex items-center justify-between rounded-xl border border-emerald-500/30 bg-black/40 px-3.5 py-2.5 font-mono text-xs">
                        <span className="flex items-center gap-1.5 text-zinc-400">
                          <Lock className="h-3.5 w-3.5 text-emerald-400" />
                          {t.safeRecipientLocked}
                        </span>
                        <span className="font-bold text-emerald-300">
                          {shortAddr(status?.user.lockedRecoveryAddress || activeUserAddress || "")}
                        </span>
                      </div>
                      <button
                        onClick={handleHardwareEscape}
                        disabled={busy !== null}
                        className="flex w-full items-center justify-center gap-2.5 rounded-2xl bg-emerald-500 px-5 py-4 text-base font-bold text-black shadow-lg shadow-emerald-500/25 transition hover:bg-emerald-400 cursor-pointer disabled:opacity-50"
                      >
                        <Fingerprint className="h-5 w-5" />
                        {busy === "escape"
                          ? t.step4Busy
                          : passkeyMode === "webauthn"
                          ? t.step4BtnWebAuthn
                          : t.step4BtnWebCrypto}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* STEP 5: Completed Celebration Proof */}
              {activeStep === 5 && recoveryProof && (
                <div className="text-center">
                  <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                  <h2 className="text-lg font-bold text-emerald-300">{t.recoveredTitle}</h2>
                  <p className="mt-1 text-xs text-zinc-300">{t.recoveredSub}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2 font-mono text-xs">
                    <span className="rounded-lg bg-violet-500/20 px-2.5 py-1 text-violet-200">
                      {recoveryProof.latencyMs} ms
                    </span>
                    <span className="rounded-lg bg-emerald-500/20 px-2.5 py-1 text-emerald-200">
                      0x0100 · 6,900 gas
                    </span>
                    <a
                      href={`${EXPLORER_URL}/tx/${recoveryProof.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1 text-zinc-200 hover:bg-white/10"
                    >
                      {t.viewTx} {shortHash(recoveryProof.txHash)}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                  <button
                    onClick={handleReset}
                    disabled={busy !== null}
                    className="mt-4 inline-flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-500 cursor-pointer disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    {t.replayBtn}
                  </button>
                </div>
              )}

              {/* Discrete Passkey Fallback Switcher (Always accessible cleanly) */}
              {activeStep !== 5 && (
                <div className="mt-3.5 flex items-center justify-between border-t border-white/5 pt-3 text-[11px] text-zinc-500">
                  <button
                    onClick={() => setPasskeyMode((m) => (m === "webauthn" ? "webcrypto" : "webauthn"))}
                    className="underline decoration-zinc-600 underline-offset-2 hover:text-zinc-300 cursor-pointer"
                  >
                    {passkeyMode === "webauthn" ? t.switchToFallback : t.switchToBiometric}
                  </button>
                  {activeStep === 3 && localKeyMatchesChain && (
                    <button
                      onClick={handleHardwareEscape}
                      disabled={busy !== null}
                      className="font-semibold text-emerald-400 hover:text-emerald-300 cursor-pointer"
                    >
                      {t.steps[3]} →
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* SECONDARY LIVE PROOF PANEL (Right 5 cols on Desktop, Below on Mobile) */}
          <aside className="flex flex-col gap-4 lg:col-span-5">
            <div className="rounded-3xl border border-white/10 bg-[#13111d] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-white">{t.proofTitle}</h2>
                  <p className="mt-0.5 text-xs text-zinc-400">{t.proofSub}</p>
                </div>
                <span className="rounded-lg border border-white/10 bg-black/40 px-2 py-1 font-mono text-[11px] text-zinc-300">
                  #{status ? Number(status.blockNumber).toLocaleString() : "---"}
                </span>
              </div>

              {/* 4 Clean Signal Rows */}
              <div className="mt-4 divide-y divide-white/5 rounded-2xl border border-white/10 bg-black/30">
                {/* Row 1: SRI Fingerprint */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-300">{t.rowSriTitle}</div>
                    <div
                      className={`mt-0.5 truncate text-xs ${
                        hijacked || isTripped ? "font-semibold text-red-300" : "text-emerald-300"
                      }`}
                    >
                      {hijacked || isTripped ? t.rowSriDrift : t.rowSriOk}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                    {shortHash(
                      hijacked || isTripped
                        ? inspection?.sriCheck.liveHash || status?.maliciousHash
                        : status?.trustedHash
                    )}
                  </span>
                </div>

                {/* Row 2: Pre-Tx Call Trace */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-300">{t.rowTraceTitle}</div>
                    <div
                      className={`mt-0.5 truncate font-mono text-xs ${
                        hijacked || isTripped ? "font-bold text-red-300" : "text-emerald-300"
                      }`}
                    >
                      {hijacked || isTripped ? t.rowTraceHijacked : t.rowTraceOk}
                    </div>
                  </div>
                  {inspection?.calldataDiff.traceLatencyMs ? (
                    <span className="shrink-0 rounded-md bg-violet-500/20 px-2 py-0.5 font-mono text-[11px] text-violet-200">
                      {inspection.calldataDiff.traceLatencyMs} ms
                    </span>
                  ) : null}
                </div>

                {/* Row 3: Sub-Second Breaker */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-300">{t.rowBreakerTitle}</div>
                    <div
                      className={`mt-0.5 truncate text-xs ${
                        isTripped ? "font-bold text-red-300" : "text-zinc-400"
                      }`}
                    >
                      {isTripped ? t.rowBreakerTripped : t.rowBreakerStandby}
                    </div>
                  </div>
                  <span className="shrink-0 font-mono text-xs font-bold text-violet-300">
                    {inspection?.breakerTx && inspection.breakerTx.latencyMs > 0
                      ? `${inspection.breakerTx.latencyMs} ms`
                      : isTripped
                      ? "< 600 ms"
                      : "300 ms"}
                  </span>
                </div>

                {/* Row 4: Native 0x0100 Precompile */}
                <div className="flex items-center justify-between gap-3 px-3.5 py-3">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-zinc-300">{t.rowPrecompileTitle}</div>
                    <div className="mt-0.5 text-xs text-emerald-300">{t.rowPrecompileActive}</div>
                  </div>
                  <Cpu className="h-4 w-4 shrink-0 text-emerald-400" />
                </div>
              </div>

              {/* Compact 3-Metric Strip */}
              <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2.5">
                  <div className="font-mono text-lg font-bold text-red-300">{status?.tripCount ?? "0"}</div>
                  <div className="text-[11px] text-zinc-500">{t.metricTrips}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2.5">
                  <div className="font-mono text-lg font-bold text-emerald-300">
                    {status?.emergencyRecoveryCount ?? "0"}
                  </div>
                  <div className="text-[11px] text-zinc-500">{t.metricRecoveries}</div>
                </div>
                <div className="rounded-xl border border-white/5 bg-black/30 px-2 py-2.5">
                  <div className="font-mono text-lg font-bold text-violet-300">
                    {status?.gasPriceGwei ?? "100"}
                  </div>
                  <div className="text-[11px] text-zinc-500">{t.metricGas} (gwei)</div>
                </div>
              </div>
            </div>

            {/* Compact Live Audit Trail Card */}
            <div className="rounded-3xl border border-white/10 bg-[#13111d] p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  {t.auditTitle}
                </span>
                <span className="font-mono text-[11px] text-zinc-500">{t.chainBadge}</span>
              </div>

              {logs.length === 0 ? (
                <p className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-center text-xs text-zinc-500">
                  {t.auditEmpty}
                </p>
              ) : (
                <ul className="space-y-2">
                  {logs.slice(0, 5).map((item) => (
                    <li
                      key={item.id}
                      className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
                        item.kind === "alert"
                          ? "border-red-500/35 bg-red-950/30 text-red-100"
                          : item.kind === "blocked"
                          ? "border-emerald-400/45 bg-emerald-950/30 text-emerald-100"
                          : "border-white/5 bg-black/30 text-zinc-200"
                      }`}
                    >
                      <span className="truncate font-medium">{item.label}</span>
                      <div className="flex shrink-0 items-center gap-2 font-mono text-[11px]">
                        {item.latencyMs ? (
                          <span className="text-violet-300">{item.latencyMs}ms</span>
                        ) : null}
                        {item.txHash ? (
                          <a
                            href={`${EXPLORER_URL}/tx/${item.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-0.5 text-zinc-400 hover:text-white"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-zinc-500">{item.time}</span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>

        {/* ==================== COLLAPSIBLE JUDGE DETAILS ACCORDION ==================== */}
        <section className="mt-5 rounded-2xl border border-white/10 bg-[#13111d]/80">
          <button
            onClick={() => setShowJudgeDetails((v) => !v)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left text-xs font-semibold text-zinc-300 hover:text-white cursor-pointer sm:text-sm"
          >
            <span>{t.detailsToggle}</span>
            {showJudgeDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          {showJudgeDetails && (
            <div className="grid grid-cols-1 gap-3 border-t border-white/10 p-4 text-xs sm:p-5 md:grid-cols-3">
              <div className="rounded-xl border border-white/5 bg-black/30 p-3.5">
                <div className="font-bold text-violet-300">{t.whyMonadTitle}</div>
                <p className="mt-1.5 leading-relaxed text-zinc-400">{t.whyMonadBody}</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/30 p-3.5">
                <div className="font-bold text-emerald-300">{t.boundaryTitle}</div>
                <p className="mt-1.5 leading-relaxed text-zinc-400">{t.boundaryBody}</p>
              </div>
              <div className="rounded-xl border border-white/5 bg-black/30 p-3.5">
                <div className="font-bold text-amber-300">{t.businessTitle}</div>
                <p className="mt-1.5 leading-relaxed text-zinc-400">{t.businessBody}</p>
                <a
                  href={`${EXPLORER_URL}/address/${VAULT_ADDRESS}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-violet-300 underline"
                >
                  {shortAddr(VAULT_ADDRESS)} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
