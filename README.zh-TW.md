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
  <a href="https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>已驗證合約（MonadVision）</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>Monadscan</strong></a>
</p>

---

## 解決的核心痛點
2026 年多起真實 DNS / 網域商劫持事件（如 Name.com 劫持波及頭部 DeFi 協議前端）證明：**即便智能合約 100% 安全，駭客劫持官網前端並暗中替換提款 Calldata 依然能夠盜走用戶資產。**

## 解決方案：不凍結資金的兩道鏈上防線
ZeroDrain 將前端劫持防護直接下沉至智能合約層，且**熔斷絕不鎖死用戶資金（消除誤報 DoS 風險）**：

1. **亞秒級鏈上降級熔斷（`NORMAL` -> `PASSKEY_ONLY`）**
   - 哨兵持續比對前端 SHA-256 SRI 完整性雜湊與合約內註冊的 `trustedFrontendHash`，並透過 Monad 官方 RPC `debug_traceCall (callTracer)` 追蹤真實收款地址。
   - 一旦偵測到劫持或收款人遭竄改，立即透過 `eth_sendRawTransactionSync` 於 **<1 秒（1–2 個 Monad 區塊）** 內呼叫 `tripBreaker()` 切入 `PASSKEY_ONLY` 安全模式。
   - 所有被劫持的普通提款 `withdraw(drainer, amount)` 均會在鏈上強制 Revert（`VaultInPasskeyOnlyMode`），**盜幣損失為 0 MON**。
2. **原生 EIP-7951 (`0x0100`) 硬體生物辨識逃生艙**
   - 熔斷期間用戶隨時可使用本機 **TouchID / FaceID（WebAuthn `secp256r1`）**（或 WebCrypto P-256 備援模式）安全取回資產。
   - 合約將 `chainId`、合約地址、用戶地址、`safeRecipient`、`amount`、`nonce` 與 `deadline` 綁定進硬體簽名挑戰，經由 Monad 原生 **`0x0100` 預編譯（僅 6,900 gas）** 在鏈上驗簽——即便前端仍處於被劫持狀態，駭客也無法竄改收款人。

## 為什麼必須建在 Monad 上？
- **MIP-12 300ms 出塊 / 600ms 最終確定性 + `eth_sendRawTransactionSync`**：實現前端劫持後 1 秒內鏈上止損（12 秒出塊鏈來不及攔截）。
- **原生 EIP-7951 (`0x0100`) P-256 預編譯**：實鏈確認原生啟用（`isNativeP256PrecompileActive() == true`），僅需 6,900 gas 完成鏈上硬體驗簽。
- **針對 Monad 特性深度優化**：3 節點 RPC Fallback、`debug_traceCall (callTracer)` 追蹤、嚴格控制 `+10%` Gas Limit 緩衝適配 Monad `gas_limit` 計費機制。

## 兩層防禦邊界與商業模型
- **防禦邊界**：
  - *協議層（本次實機交付）*：直接嵌入 DeFi 協議質押/金庫合約（`ZeroDrainVault.sol`）阻斷惡意資金流出。
  - *錢包層（生態延伸）*：同套 `0x0100` 策略模組可無縫掛載為 **EIP-7702 Wallet Guard Hook** 攔截外部 ERC-20 `approve` / `Permit2`。
- **商業模型**：B2B DeFi 安全護盾月度訂閱（按 TVL 分級）+ 去中心化白帽哨兵質押報警分潤 + 鏈上保險保費折價合作。

## 鏈上可驗證部署（Monad Testnet `10143`）
| 項目 | 連結 / 資訊 |
| :--- | :--- |
| **公網實機 Demo（支援手機/桌面、`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` 已驗證合約** | [`0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4`](https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4) |
| **部署交易雜湊** | `0x764908a23a8c121423cb0b2fffc598bf13ad0c91039ca665e5712f1d65bcb0a1` |
| **Foundry Fork 測試** | `--fork-url https://testnet-rpc.monad.xyz` 8/8 全部通過 |

## 30 秒快速體驗
1. 打開 **https://zerodrain-monad.pages.dev**（預設「免錢包演練」模式，手機瀏覽器打開即可真實上鏈，亦支援連接 MetaMask）。
2. **第 1 步**：一鍵綁定本機 **TouchID / FaceID** 硬體密鑰上鏈（無生物辨識可切換 WebCrypto P-256 備援模式）。
3. **第 2 步**：點擊「**模擬 Name.com DNS 劫持攻擊**」→ 即時查看 SRI 漂移、`debug_traceCall` 追蹤與亞秒級鏈上熔斷。
4. **第 3 步**：點擊被劫持的「提款」按鈕 → 親眼見證鏈上 `VaultInPasskeyOnlyMode` Revert 攔截（損失 0 MON）。
5. **第 4 步**：按下 **TouchID / FaceID** → 經 Monad `0x0100` 原生預編譯驗簽通過，安全取回資產。
