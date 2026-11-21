<p align="center">
  <img src="web/public/zerodrain-logo.svg" width="84" height="84" alt="ZeroDrain Logo" />
</p>

<h1 align="center">ZeroDrain 零盗盾</h1>

<p align="center">
  <strong>针对 DeFi 前端 DNS 劫持的亚秒级链上熔断 × 原生 EIP-7951 (<code>0x0100</code>) 硬件 Passkey 防火墙</strong>
</p>

<p align="center">
  <a href="./README.md">English</a> | <strong>简体中文</strong> | <a href="./README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://zerodrain-monad.pages.dev"><strong>公网实机 Demo（HTTPS）</strong></a> ·
  <a href="https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>已验证合约 v2（MonadVision）</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>Monadscan</strong></a>
</p>

---

## 核心安全设计（`ZeroDrainVault` v2 加固版）
ZeroDrain 将前端劫持防护直接下沉至智能合约层，且**熔断绝不冻结用户资金（消除误报 DoS 风险）**：

1. **亚秒级链上降级熔断（`NORMAL` -> `PASSKEY_ONLY`）**
   - 哨兵拉取实际托管的静态 JS 文件字节（`/bundles/vault-action.clean.js` 对比模拟劫持载荷 `/bundles/vault-action.hijacked.js`）实时计算真实 SHA-256，结合 Monad 官方 RPC `debug_traceCall (callTracer)` 追踪提款目标地址。
   - 一旦检测到哈希漂移或收款人被篡改，通过 `eth_sendRawTransactionSync` 在 **<1 秒（1–2 个 Monad 区块）** 内调用 `tripBreaker()` 切入 `PASSKEY_ONLY`，恶意 `withdraw(drainer, amount)` 立即在链上 Revert（`VaultInPasskeyOnlyMode`）。
2. **熔断期冻结密钥变更（`PasskeyLockedDuringBreaker`）**
   - 合约进入 `PASSKEY_ONLY` 状态后，`registerPasskey()` 与 `setRecoveryAddress()` **强制在链上 Revert**，彻底阻断被劫持前端在攻击期间诱骗用户覆盖 Passkey 或篡改救援地址的绕过路径。
3. **仅向本人放款 + 原生 `0x0100` (EIP-7951) 逃生舱（化解签名前 WYSIWYS 篡改）**
   - `emergencyWithdrawWithWebAuthn()` 与 `emergencyWithdrawWithRawP256()` **移除前端任意传入收款人参数**，合约强制仅向 `msg.sender`（或在 `NORMAL` 期预绑定的冷钱包）打款；即使前端在签名前说谎，数学上也无法将资金导流给黑客。
   - 经由 Monad 原生 **`0x0100` 预编译（仅 6,900 gas）** 完成硬件签名验证。

## 安全模型与生产信任假设（透明说明）
| 维度 | 黑客松公网演练沙盒 (`pages.dev`) | 生产主网部署要求 |
| :--- | :--- | :--- |
| **SRI 劫持演示** | 透明标示为交互式攻击演练沙盒：对真实托管的静态 JS 文件做真实字节级 SHA-256 计算与链上比对。 | 由去中心化 M-of-N 质押哨兵网络独立监控真实生产 CDN/DNS 资产与交易池。 |
| **管理重置权限** | API 强制实施 Same-Origin CSRF 校验与常时间 `ADMIN_RESET_TOKEN` Bearer 鉴权；演示环境显式开启 `PUBLIC_DEMO_MODE=true` 方便评委自主测试（仅含一次性测试网 MON）。 | 关闭 `PUBLIC_DEMO_MODE`，移除服务端管理员密钥，合约 `admin` 交由 **Safe 多签 + Timelock** 托管。 |
| **本地密钥隔离** | **Plan A**：硬件 WebAuthn（TouchID / FaceID 安全芯片）。**Plan B（演示备用）**：采用不可导出 `extractable: false` 的 WebCrypto `CryptoKey` 存于 IndexedDB（`localStorage` 零私钥）。 | 生产环境强制硬件生物识别/硬件钱包，并在独立 IPFS 域名托管应急逃生前端。 |
| **防御边界** | 协议层金库/质押提款（`ZeroDrainVault.sol`）。 | 同套 `0x0100` 模块可无缝挂载为 **EIP-7702 Wallet Guard Hook** 防护外部 ERC-20 `approve`。 |

## 链上可验证部署（Monad Testnet `10143`）
| 项目 | 链接 / 信息 |
| :--- | :--- |
| **公网实机 Demo（手机/桌面自适应，`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 已验证合约** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **部署交易哈希** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **链上锚定合法 JS SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry Fork 测试** | `--fork-url https://testnet-rpc.monad.xyz` 9/9 全部通过（含熔断期禁改 Passkey 专项测试） |
