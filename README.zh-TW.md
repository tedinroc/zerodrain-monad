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
ZeroDrain 將前端劫持防護直接下沉至智能合約層，且**熔斷絕不凍結用戶資金（消除誤報 DoS 風險）**：

1. **亞秒級鏈上降級熔斷（`NORMAL` -> `PASSKEY_ONLY`）**
   - 哨兵拉取實際託管的靜態 JS 檔案位元組（`/bundles/vault-action.clean.js` 對比模擬劫持載荷 `/bundles/vault-action.hijacked.js`）即時計算真實 SHA-256，結合 Monad 官方 RPC `debug_traceCall (callTracer)` 追蹤提款目標地址。
   - 一旦偵測到雜湊漂移或收款人遭竄改，透過 `eth_sendRawTransactionSync` 於 **<1 秒（1–2 個 Monad 區塊）** 內呼叫 `tripBreaker()` 切入 `PASSKEY_ONLY`，惡意 `withdraw(drainer, amount)` 立即於鏈上 Revert（`VaultInPasskeyOnlyMode`）。
2. **熔斷期凍結密鑰變更（`PasskeyLockedDuringBreaker`）**
   - 合約進入 `PASSKEY_ONLY` 狀態後，`registerPasskey()` 與 `setRecoveryAddress()` **強制在鏈上 Revert**，徹底阻斷被劫持前端在攻擊期間誘騙用戶覆寫 Passkey 或竄改救援地址的繞過路徑。
3. **僅向本人放款 + 原生 `0x0100` (EIP-7951) 逃生艙（化解簽署前 WYSIWYS 竄改）**
   - `emergencyWithdrawWithWebAuthn()` 與 `emergencyWithdrawWithRawP256()` **移除前端任意傳入收款人參數**，合約強制僅向 `msg.sender`（或在 `NORMAL` 期預綁定的冷錢包）打款；即便前端在簽署前說謊，數學上也無法將資金導流給駭客。
   - 經由 Monad 原生 **`0x0100` 預編譯（僅 6,900 gas）** 完成硬體簽名驗證。

## 安全模型與生產信任假設（透明說明）
| 維度 | 黑客松公網演練沙盒 (`pages.dev`) | 生產主網部署要求 |
| :--- | :--- | :--- |
| **SRI 劫持演示** | 透明標示為互動式攻擊演練沙盒：對真實託管的靜態 JS 檔案做真實位元組級 SHA-256 計算與鏈上比對。 | 由去中心化 M-of-N 質押哨兵網路獨立監控真實生產 CDN/DNS 資產與交易池。 |
| **管理重置權限** | 所有控制介面（`reset` / `inspect-and-trip` / `demo/action`）均強制實施 Same-Origin CSRF、嚴格 `application/json`（拒收 `text/plain` 簡單請求）、限流、安全標頭（`CSP`/`HSTS`/`X-Frame-Options`）及預設關閉的 `ADMIN_RESET_TOKEN` Bearer 鑑權；測試網演練環境顯式開啟 `PUBLIC_DEMO_MODE=true` 方便評委自主測試。 | 生產部署設 `PUBLIC_DEMO_MODE=false`（公網僅保留唯讀），移除伺服器端金鑰，常規期增加 Passkey 輪替延遲，合約 `admin` 交由 **Safe 多簽 + Timelock** 託管。 |
| **本機密鑰隔離** | **Plan A**：硬體 WebAuthn（TouchID / FaceID 安全晶片）。**Plan B（演示備援）**：採用不可匯出 `extractable: false` 的 WebCrypto `CryptoKey` 存於 IndexedDB（`localStorage` 零私鑰）。 | 生產環境強制硬體生物辨識/硬體錢包，並在獨立 IPFS 域名託管應急逃生前端。 |
| **防禦邊界** | 協議層金庫/質押提款（`ZeroDrainVault.sol`）。 | 同套 `0x0100` 模組可無縫掛載為 **EIP-7702 Wallet Guard Hook** 防護外部 ERC-20 `approve`。 |

## 鏈上可驗證部署（Monad Testnet `10143`）
| 項目 | 連結 / 資訊 |
| :--- | :--- |
| **公網實機 Demo（手機/桌面自適應，`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 已驗證合約** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **部署交易雜湊** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **鏈上錨定合法 JS SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry Fork 稽核測試與 CI** | `--fork-url https://testnet-rpc.monad.xyz` **15/15 全部通過** + GitHub Actions CI（`forge fmt` / `forge test` / `tsc` / `eslint` / `next build`） |
| **開源授權** | MIT License（[`LICENSE`](./LICENSE)） |
