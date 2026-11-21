<p align="center">
  <img src="web/public/zerodrain-logo.svg" width="84" height="84" alt="ZeroDrain Logo" />
</p>

<h1 align="center">ZeroDrain</h1>

<p align="center">
  <strong>Sub-Second Anti-Hijack On-Chain Circuit Breaker &amp; Native EIP-7951 (<code>0x0100</code>) Passkey Firewall on Monad</strong>
</p>

<p align="center">
  <strong>English</strong> | <a href="./README.zh-CN.md">简体中文</a> | <a href="./README.zh-TW.md">繁體中文</a>
</p>

<p align="center">
  <a href="https://zerodrain-monad.pages.dev"><strong>Live Demo (HTTPS)</strong></a> ·
  <a href="https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>Verified Contract v2 (MonadVision)</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab"><strong>Monadscan</strong></a>
</p>

---

## Problem
Recent DNS/registrar hijacking incidents (e.g., Name.com attacks affecting live DeFi frontends) proved that **even when smart contracts are 100% bug-free, a compromised frontend on the legitimate domain can silently swap withdrawal calldata to drain user funds.**

## Solution: Hardened On-Chain Defense (`ZeroDrainVault` v2)
ZeroDrain enforces frontend hijack protection at the smart contract layer **without freezing user funds**:

1. **Sub-Second Degraded Circuit Breaker (`NORMAL` -> `PASSKEY_ONLY`)**
   - The Sentinel fetches actual served JS bundle bytes (`/bundles/vault-action.clean.js` vs simulated hijacked payload `/bundles/vault-action.hijacked.js`), verifies live SHA-256 integrity against on-chain `trustedFrontendHash`, and runs Monad `debug_traceCall (callTracer)` to inspect real withdrawal recipients.
   - On drift or recipient tampering, it calls `tripBreaker()` via `eth_sendRawTransactionSync`, switching the vault to `PASSKEY_ONLY` in **<1 second (1–2 Monad blocks)**.
   - Any hijacked `withdraw(drainer, amount)` call immediately **reverts on-chain** (`VaultInPasskeyOnlyMode`).
2. **Incident Key-Lock Invariant (`PasskeyLockedDuringBreaker`)**
   - While in `PASSKEY_ONLY` mode, both `registerPasskey()` and `setRecoveryAddress()` **strictly revert on-chain**. A hijacked frontend cannot trick a victim into overwriting their hardware key during an active incident.
3. **Self-Only / Pre-Bound Payout + Native `0x0100` (EIP-7951) Escape Hatch**
   - `emergencyWithdrawWithWebAuthn()` and `emergencyWithdrawWithRawP256()` **do not accept an arbitrary frontend-supplied recipient**. Payout is enforced strictly on-chain to `msg.sender` (or a cold wallet pre-bound during `NORMAL` mode), neutralizing pre-signing WYSIWYS recipient tampering even on a compromised UI.
   - Hardware signatures are verified natively via Monad's **`0x0100` precompile (6,900 gas)**.

## Security Model & Production Trust Assumptions
We explicitly distinguish our **Hackathon Interactive Sandbox** from **Production Mainnet Deployment**:

| Control Surface | Live Hackathon Sandbox (`pages.dev`) | Production Mainnet Requirement |
| :--- | :--- | :--- |
| **Attack Simulation & SRI** | Interactive attack sandbox hashing actual served JS files (`/bundles/vault-action.*.js`) to demonstrate real SHA-256 drift + on-chain breaker without attacking live DNS. | Independent M-of-N bonded sentinels monitoring production CDN/DNS bundles and mempool traces. |
| **Admin Reset (`restoreNormalMode`)** | API enforces Same-Origin CSRF checks + constant-time `ADMIN_RESET_TOKEN` Bearer auth; `PUBLIC_DEMO_MODE=true` is enabled so hackathon judges can self-test freely using disposable Testnet MON. | Disable `PUBLIC_DEMO_MODE`, remove server-held admin keys, and assign `admin` strictly to a **Safe Multisig + Timelock**. |
| **Client Key Storage** | **Plan A**: Hardware WebAuthn (`TouchID / FaceID` in Secure Enclave). **Plan B (Demo Fallback)**: Non-extractable WebCrypto `CryptoKey` (`extractable: false`, IndexedDB only; zero private keys in `localStorage`). | Require hardware-backed WebAuthn / hardware wallets and host the Escape Hatch on an independent static/IPFS origin. |
| **Defense Boundary** | Protocol-level vault withdrawals (`ZeroDrainVault.sol`). | Pair with an **EIP-7702 Wallet Guard Hook** using the same `0x0100` module for external ERC-20 `approve` / `Permit2` protection. |

## Verified Deployments (Monad Testnet `10143`)
| Artifact | Reference |
| :--- | :--- |
| **Live Web App (Mobile & Desktop, `简 / 繁 / EN`)** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 Contract** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **Deployment Tx** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **Anchored Clean Bundle SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry Fork Tests** | 9/9 passing on `--fork-url https://testnet-rpc.monad.xyz` |

## Project Structure & Local Verification
- `contracts/` — Foundry project (`ZeroDrainVault.sol`, OpenZeppelin `WebAuthn` & `P256`, 9 Monad Testnet fork tests). Install deps via `forge install --no-git OpenZeppelin/openzeppelin-contracts foundry-rs/forge-std` and run `forge test --fork-url https://testnet-rpc.monad.xyz`.
- `web/` — Next.js 15 static frontend (`zh-CN` / `zh-TW` / `en`, responsive, `ox` WebAuthnP256 + non-extractable WebCrypto fallback) + Cloudflare Pages Functions (`web/functions/api/`).
- `.monskills` — MONSKILLS provenance metadata (`chain=monad-testnet`).
