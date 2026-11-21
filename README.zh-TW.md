<p align="center">
  <img src="web/public/zerodrain-logo.svg" width="84" height="84" alt="ZeroDrain Logo" />
</p>

<h1 align="center">ZeroDrain 零盜盾</h1>

<p align="center">
  <strong>針對 DeFi 前端 DNS 劫持的亞秒級鏈上熔斷 × 原生 EIP-7951 (<code>0x0100</code>) 硬體 Passkey 防火牆</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <a href="./README.zh-CN.md">简体中文</a> | <strong>繁體中文</strong>
</p>

<p align="center">
  <a href="https://zerodrain-monad.pages.dev"><strong>公網實機 Demo（HTTPS）</strong></a> ·
  <a href="https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>已驗證合約 v2（MonadVision）</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>Monadscan</strong></a>
</p>

---

## 核心安全設計（`ZeroDrainVault` v2 加固版）
ZeroDrain 將前端劫持防護直接下沉至智能合約層，**對已預先註冊 Passkey 的用戶絕不凍結資金（避免誤報 DoS）**：

1. **亞秒級鏈上降級熔斷（`NORMAL` -> `PASSKEY_ONLY`）**
   - 在互動演練沙盒中，哨兵拉取託管的 372-byte 靜態操作腳本檔案（`/bundles/vault-action.clean.js` 對比模擬劫持載荷 `/bundles/vault-action.hijacked.js`）即時計算真實 SHA-256，結合 Monad 官方 RPC `debug_traceCall (callTracer)` 追蹤提款目標地址。
   - 一旦偵測到雜湊漂移或收款人遭竄改，透過 `eth_sendRawTransactionSync` 於 **<1 秒（1–2 個 Monad 區塊）** 內呼叫 `tripBreaker()` 切入 `PASSKEY_ONLY`，惡意 `withdraw(drainer, amount)` 立即於鏈上 Revert（`VaultInPasskeyOnlyMode`）。
2. **熔斷期凍結密鑰變更（`PasskeyLockedDuringBreaker`）**
   - 合約進入 `PASSKEY_ONLY` 狀態後，`registerPasskey()` 與 `setRecoveryAddress()` **強制在鏈上 Revert**，阻斷被劫持前端在攻擊期間誘騙用戶覆寫 Passkey 或竄改救援地址的繞過路徑。
3. **鎖定放款目標 + 原生 `0x0100` (EIP-7951) 逃生艙**
   - `emergencyWithdrawWithWebAuthn()` 與 `emergencyWithdrawWithRawP256()` **不在逃生交易 calldata 中接受任意前端收款人參數**，合約僅向 `getLockedRecoveryAddress(msg.sender)`（預設本人地址，或 `NORMAL` 期合約級預設的恢復地址）放款。
   - 經由 Monad 原生 **`0x0100` 預編譯（僅 6,900 gas）** 完成硬體簽名驗證。

## 安全模型、已知邊界與主網演進路線（透明說明）
| 維度 | 黑客松公網演練沙盒 (`pages.dev` + 測試網 v2) | 生產主網部署要求 |
| :--- | :--- | :--- |
| **SRI 範圍與重置信任錨** | 沙盒錨定 372-byte 操作腳本 fixture（`/bundles/vault-action.clean.js`）演示真實位元組級 SHA-256 校驗；`/api/sentinel/reset` 嚴格比對當前託管檔案等於編譯期規範雜湊，不一致則**拒絕重置（HTTP 409）**，防止遭替換的載荷自我合法化。 | 由獨立域名的 M-of-N 質押哨兵網路校驗完整前端建置清單（全部 JS chunks + HTML）。 |
| **恢復地址（`setRecoveryAddress`）** | 目前僅合約層介面（UI 未暴露），熔斷期凍結；但 `NORMAL` 期尚未加時間鎖與 Passkey 二次確認，因此防竄改僅覆蓋緊急提款 calldata，不覆蓋 `NORMAL` 期遭誘導呼叫 setter。 | 變更恢復地址前強制 **24–48h Timelock + 既有 Passkey 簽名核准**（或限定僅可提回本人）。 |
| **未綁定 Passkey 用戶** | 已綁定 Passkey 用戶永不被凍結；未綁定者在熔斷期間需待 `restoreNormalMode()` 恢復。 | 首次存款強制綁定 Passkey，或提供帶簽名認證的緊急註冊通道。 |
| **控制平面與限流** | 全部寫介面實施 Same-Origin CSRF（`403`）、嚴格 `application/json`（`415`）、參數校驗（`400`）、預設關閉鑑權開關與單隔離體 best-effort 限流；測試網顯式開啟 `PUBLIC_DEMO_MODE=true` 方便評委共用測試。 | 生產設 `PUBLIC_DEMO_MODE=false`（公網僅唯讀），移除伺服器端私鑰，合約 `admin` 移交 **Safe 多簽 + Timelock**，啟用 Cloudflare Edge WAF Rate Limiting / Durable Objects。 |
| **WebAuthn、本機密鑰與 CSP** | **Plan A**：硬體 WebAuthn（`requireUV=false` 校驗用戶存在並依賴瀏覽器 RP ID 綁定）。**Plan B（演示備援）**：不可匯出 `extractable: false` 的 WebCrypto `CryptoKey` 存於 IndexedDB（`localStorage` 零私鑰）。靜態匯出 CSP 含 `'unsafe-inline'` 供 Next.js 水合腳本運作。 | 視場景開啟 `requireUV=true` + 鏈上 origin 白名單、於獨立 IPFS 域名託管硬體逃生前端，並升級邊緣 nonce/hash CSP。 |
| **防禦邊界** | 協議層金庫提款（`ZeroDrainVault.sol`）。 | 同套 `0x0100` 模組可無縫掛載為 **EIP-7702 Wallet Guard Hook** 防護外部 ERC-20 `approve`。 |

## 鏈上可驗證部署（Monad Testnet `10143`）
| 項目 | 連結 / 資訊 |
| :--- | :--- |
| **公網共享沙盒 Demo（手機/桌面自適應，`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 已驗證合約** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **部署交易雜湊** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **鏈上錨定合法 JS SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry 安全/分叉測試與 CI** | `--fork-url https://testnet-rpc.monad.xyz` **15/15 全部通過**（100% 行與函式覆蓋；鎖定 Foundry `v1.9.0` / OZ `v5.7.0` / `forge-std` `v1.17.0`；**非第三方正式審計**） |
| **開源授權** | MIT License（[`LICENSE`](./LICENSE)） |
