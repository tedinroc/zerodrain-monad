# 🛡️ ZeroDrain（零盜盾）

**針對 DeFi 前端 DNS/CDN 劫持的亞秒級鏈上熔斷 × EIP-7951 (`0x0100`) 硬體 Passkey 防火牆** — Built for **Monad Blitz 廣州 (2026-11-21)**。

## 痛點與原創設計
2026 年真實發生的 Name.com DNS 劫持事件波及 Monad 頭部協議前端（如 Kintsu）：**底層智能合約 100% 安全，但用戶在真官網被惡意腳本誘導簽出盜幣交易**。

ZeroDrain 在合約層建立兩道防線，且**熔斷不凍結用戶資金（消除假陽性 DoS）**：
1. **亞秒級鏈上降級熔斷（`NORMAL → PASSKEY_ONLY`）**：哨兵實時監控前端 SHA-256 SRI 指紋並以 Monad 官方 RPC `debug_traceCall (callTracer)` 追蹤交易真實收款地址；一旦偵測劫持，透過 `eth_sendRawTransactionSync` 於 **<1 秒（1–2 個 Monad 區塊）** 內切入 `PASSKEY_ONLY` 模式，讓被劫持的 `withdraw(drainer, amount)` 直接在鏈上強制 `VaultInPasskeyOnlyMode` Revert！
2. **原生 `0x0100` (EIP-7951) 硬體生物辨識逃生艙**：熔斷期間，用戶隨時可用本機 **Mac TouchID / iPhone FaceID（WebAuthn secp256r1）** 簽署密碼學鎖死 `safeRecipient + amount + nonce + chainId` 的挑戰，由 Monad 原生 `0x0100` 預編譯（僅 `6,900` gas）在鏈上驗證並安全取回資產。

## 為何只能建在 Monad？
- **MIP-12 300ms 出塊 / 600ms 最終確定性 + `eth_sendRawTransactionSync`**：讓前端劫持發生後 1 秒內於鏈上生效止損（12 秒鏈來不及攔截）。
- **原生 EIP-7951 (`0x0100`) P-256 預編譯**：合約原生低成本驗證硬體 Passkey（`isNativeP256PrecompileActive() == true`）。
- **Monad `debug_traceCall (callTracer)` + 3 節點 RPC Fallback + 精準 `gas_limit`（+10% 緩衝）**。

## 兩層防禦邊界與商業模型
- **防禦邊界**：本場實機交付「協議金庫/質押層合約護盾」，同套 `0x0100` 驗證模組可無縫掛載為 **EIP-7702 Wallet Guard Hook** 防護外部 ERC-20 `approve`。
- **商業模型**：B2B DeFi 安全護盾訂閱（依 TVL 分級）+ 去中心化白帽哨兵報警激勵 + 鏈上保險保費折價合作。

## 鏈上可驗證證據（Monad Testnet `10143`）
- **公網實機戰情室（HTTPS，支援 TouchID / FaceID）**：[`https://zerodrain-monad.pages.dev`](https://zerodrain-monad.pages.dev)
- **已驗證合約 `ZeroDrainVault`**：[`0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4`](https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4)（[Monadscan](https://testnet.monadscan.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4)）
- **部署交易**：`0x764908a23a8c121423cb0b2fffc598bf13ad0c91039ca665e5712f1d65bcb0a1`
- **架構目錄**：`contracts/`（Foundry + OpenZeppelin `WebAuthn`/`P256`，8/8 Monad Testnet Fork 測試通過）、`web/`（Next.js 15 靜態匯出 + Cloudflare Pages Functions + Viem + `ox` WebAuthnP256）

## 30 秒體驗流程
1. 點擊「存入 0.10 MON」與「綁定 TouchID / FaceID」（無需插件即可用極速演練模式，亦支援 MetaMask）。
2. 點擊頂部紅色按鈕「**☢️ 模擬 Name.com DNS 劫持**」→ 右側戰情室 1 秒內顯示 SRI 漂移、Calldata Diff 並完成鏈上熔斷。
3. 點擊左側「一鍵提款」見證 Drainer 交易在鏈上 Revert，再按「**👆 TouchID / FaceID 安全取回**」經 Monad `0x0100` 驗簽救回資金。
