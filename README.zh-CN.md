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
  <a href="https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>已验证合约（MonadVision）</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>Monadscan</strong></a>
</p>

---

## 解决的核心痛点
2026 年多起真实 DNS / 域名商劫持事件（如 Name.com 劫持波及头部 DeFi 协议前端）证明：**即便智能合约 100% 安全，黑客劫持官网前端并暗中替换提款 Calldata 依然能够盗走用户资产。**

## 解决方案：不冻结资金的两道链上防线
ZeroDrain 将前端劫持防护直接下沉至智能合约层，且**熔断绝不锁死用户资金（消除误报 DoS 风险）**：

1. **亚秒级链上降级熔断（`NORMAL` -> `PASSKEY_ONLY`）**
   - 哨兵持续比对前端 SHA-256 SRI 完整性哈希与合约内注册的 `trustedFrontendHash`，并通过 Monad 官方 RPC `debug_traceCall (callTracer)` 追踪真实收款地址。
   - 一旦检测到劫持或收款人被篡改，立即通过 `eth_sendRawTransactionSync` 在 **<1 秒（1–2 个 Monad 区块）** 内调用 `tripBreaker()` 切入 `PASSKEY_ONLY` 安全模式。
   - 所有被劫持的普通提款 `withdraw(drainer, amount)` 均会在链上强制 Revert（`VaultInPasskeyOnlyMode`），**盗币损失为 0 MON**。
2. **原生 EIP-7951 (`0x0100`) 硬件生物识别逃生舱**
   - 熔断期间用户随时可使用本机 **TouchID / FaceID（WebAuthn `secp256r1`）**（或 WebCrypto P-256 备用模式）安全取回资产。
   - 合约将 `chainId`、合约地址、用户地址、`safeRecipient`、`amount`、`nonce` 与 `deadline` 绑定进硬件签名挑战，经由 Monad 原生 **`0x0100` 预编译（仅 6,900 gas）** 在链上验签——即便前端仍处于被劫持状态，黑客也无法篡改收款人。

## 为什么必须建在 Monad 上？
- **MIP-12 300ms 出块 / 600ms 最终确定性 + `eth_sendRawTransactionSync`**：实现前端劫持后 1 秒内链上止损（12 秒出块链来不及拦截）。
- **原生 EIP-7951 (`0x0100`) P-256 预编译**：实链确认原生激活（`isNativeP256PrecompileActive() == true`），仅需 6,900 gas 完成链上硬件验签。
- **针对 Monad 特性深度优化**：3 节点 RPC Fallback、`debug_traceCall (callTracer)` 追踪、严格控制 `+10%` Gas Limit 缓冲适配 Monad `gas_limit` 计费机制。

## 两层防御边界与商业模型
- **防御边界**：
  - *协议层（本次实机交付）*：直接嵌入 DeFi 协议质押/金库合约（`ZeroDrainVault.sol`）阻断恶意资金流出。
  - *钱包层（生态延伸）*：同套 `0x0100` 策略模块可无缝挂载为 **EIP-7702 Wallet Guard Hook** 拦截外部 ERC-20 `approve` / `Permit2`。
- **商业模型**：B2B DeFi 安全护盾月度订阅（按 TVL 分级）+ 去中心化白帽哨兵质押报警分润 + 链上保险保费折扣合作。

## 链上可验证部署（Monad Testnet `10143`）
| 项目 | 链接 / 信息 |
| :--- | :--- |
| **公网实机 Demo（支持手机/桌面、`简 / 繁 / EN`）** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` 已验证合约** | [`0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4`](https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4) |
| **部署交易哈希** | `0x764908a23a8c121423cb0b2fffc598bf13ad0c91039ca665e5712f1d65bcb0a1` |
| **Foundry Fork 测试** | `--fork-url https://testnet-rpc.monad.xyz` 8/8 全部通过 |

## 30 秒快速体验
1. 打开 **https://zerodrain-monad.pages.dev**（默认「免钱包演练」模式，手机浏览器打开即可真实上链，亦支持连接 MetaMask）。
2. **第 1 步**：一键绑定本机 **TouchID / FaceID** 硬件密钥上链（无生物识别可切换 WebCrypto P-256 备用模式）。
3. **第 2 步**：点击「**模拟 Name.com DNS 劫持攻击**」→ 实时查看 SRI 漂移、`debug_traceCall` 追踪与亚秒级链上熔断。
4. **第 3 步**：点击被劫持的「提款」按钮 → 亲眼见证链上 `VaultInPasskeyOnlyMode` Revert 拦截（损失 0 MON）。
5. **第 4 步**：按下 **TouchID / FaceID** → 经 Monad `0x0100` 原生预编译验签通过，安全取回资产。
