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
ZeroDrain 将前端劫持防护直接下沉至智能合约层，**对已预注册 Passkey 的用户绝不冻结资金（避免误报 DoS）**：

1. **亚秒级链上降级熔断（`NORMAL` -> `PASSKEY_ONLY`）**
   - 在交互演练沙盒中，哨兵拉取托管的 372-byte 静态操作脚本文档（`/bundles/vault-action.clean.js` 对比模拟劫持载荷 `/bundles/vault-action.hijacked.js`）实时计算真实 SHA-256，结合 Monad 官方 RPC `debug_traceCall (callTracer)` 追踪提款目标地址。
   - 一旦检测到哈希漂移或收款人被篡改，通过 `eth_sendRawTransactionSync` 发起 `tripBreaker()`，在健康 RPC 下**交易广播到链上收执可达亚秒级（~300–600ms，1–2 个 Monad 区块）**（注：端到端 API 总耗时另含前置 RPC 查询与 `debug_traceCall`）。恶意 `withdraw(drainer, amount)` 立即在链上 Revert（`VaultInPasskeyOnlyMode`）。
2. **熔断期冻结密钥变更（`PasskeyLockedDuringBreaker`）**
   - 合约进入 `PASSKEY_ONLY` 状态后，`registerPasskey()` 与 `setRecoveryAddress()` **强制在链上 Revert**，阻断被劫持前端在攻击期间诱骗用户覆盖 Passkey 或篡改救援地址的绕过路径。
3. **锁定放款目标 + 原生 `0x0100` (EIP-7951) 逃生舱**
   - `emergencyWithdrawWithWebAuthn()` 与 `emergencyWithdrawWithRawP256()` **不在逃生交易 calldata 中接受任意前端收款人参数**，合约仅向 `getLockedRecoveryAddress(msg.sender)`（默认本人地址，或 `NORMAL` 期合约级预设的恢复地址）放款。
   - 经由 Monad 原生 **`0x0100` 预编译（仅 6,900 gas）** 完成硬件签名验证。

## 安全模型、已知边界与主网演进路线（透明说明）
| 维度 | 黑客松公网演练沙盒 (`pages.dev` + 测试网 v2) | 生产主网部署要求 |
| :--- | :--- | :--- |
| **SRI 范围与重置信任锚** | 沙盒锚定 372-byte 操作脚本 fixture（`/bundles/vault-action.clean.js`）演示真实字节级 SHA-256 校验；`/api/sentinel/reset` 严格校验当前托管文件等于编译期规范哈希，不一致则**拒绝重置（HTTP 409）**，防止被替换的载荷自我合法化。 | 由独立域名的 M-of-N 质押哨兵网络校验完整前端构建清单（全部 JS chunks + HTML）。 |
| **密钥与恢复地址变更（`NORMAL` 期）** | `registerPasskey()` 与 `setRecoveryAddress()`（仅合约层，UI 未暴露）在熔断期冻结；但 `NORMAL` 期尚未加时间锁与旧 Passkey 审批，且若自定义恢复合约拒收 MON，熔断期可能卡住逃生直至 `restoreNormalMode()`。 | 对 `NORMAL` 期 Passkey 轮替与恢复地址变更强制 **24–48h Timelock + 既有 Passkey 签名批准**，并在自定义合约拒收 MON 时回退至 `msg.sender`。 |
| **未绑定 Passkey 用户** | 已绑定 Passkey 用户永不被冻结；未绑定者在熔断期间需待 `restoreNormalMode()` 恢复。 | 首次存款强制绑定 Passkey，或提供带签名认证的紧急注册通道。 |
| **控制平面、Nonce 锁与限流** | 全部写接口实施 Same-Origin CSRF（`403`）、严格 `application/json`（`415`）、参数校验（`400`）、默认关闭鉴权开关、无私钥只读 `GET /status` 与 `/challenge`，以及单隔离体 best-effort 限流与签名者 Nonce 锁；测试网显式开启 `PUBLIC_DEMO_MODE=true` 方便评委共用测试。 | 生产设 `PUBLIC_DEMO_MODE=false`（公网仅只读），移除服务端私钥，合约 `admin` 移交 **Safe 多签 + Timelock**，限流与 Nonce 序列化迁移至 Cloudflare Edge WAF / Durable Objects。 |
| **WebAuthn、本地密钥与 CSP** | **Plan A**：硬件 WebAuthn（`requireUV=false` 校验用户存在并依赖浏览器 RP ID 绑定）。**Plan B（演示备用）**：不可导出 `extractable: false` 的 WebCrypto `CryptoKey` 存于 IndexedDB（`localStorage` 零私钥）。静态导出 CSP 含 `'unsafe-inline'` 供 Next.js 水合脚本运行。 | 视场景开启 `requireUV=true` + 链上 origin 白名单、于独立 IPFS 域名托管硬件逃生前端，并升级边缘 nonce/hash CSP。 |
| **防御边界** | 协议层金库提款（`ZeroDrainVault.sol`）。 | 同套 `0x0100` 模块可无缝挂载为 **EIP-7702 Wallet Guard Hook** 防护外部 ERC-20 `approve`。 |

## 链上可验证部署（Monad Testnet `10143`）
| 项目 | 链接 / 信息 |
| :--- | :--- |
| **公网共享沙盒 Demo（手机/桌面自适应，`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 已验证合约** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **部署交易哈希** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **链上锚定合法 JS SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry 安全/分叉测试与 CI** | `--fork-url https://testnet-rpc.monad.xyz` **15/15 全部通过**（`ZeroDrainVault.sol` 本体 100% 行与函数覆盖；锁定 Foundry `v1.9.0` / OZ `v5.7.0` / `forge-std` `v1.17.0`；**非第三方正式审计**） |
| **开源协议** | MIT License（[`LICENSE`](./LICENSE)） |
