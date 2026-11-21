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
  <a href="https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>Verified Contract (MonadVision)</strong></a> ·
  <a href="https://testnet.monadscan.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4"><strong>Monadscan</strong></a>
</p>

---

## Problem
Recent DNS/registrar hijacking incidents (e.g., Name.com attacks affecting live DeFi frontends) proved a painful reality: **even when smart contracts are 100% bug-free, a compromised frontend on the legitimate domain can silently swap withdrawal calldata to drain user funds.**

## Solution: Two-Layer On-Chain Defense (Zero False-Positive DoS)
ZeroDrain moves frontend hijack protection down to the smart contract layer **without freezing user funds**:

1. **Sub-Second Degraded Circuit Breaker (`NORMAL` -> `PASSKEY_ONLY`)**
   - A lightweight Sentinel monitors the frontend SHA-256 SRI hash against the contract's `trustedFrontendHash` and traces candidate withdrawal calls via Monad's `debug_traceCall (callTracer)`.
   - On drift or recipient tampering, it calls `tripBreaker()` via `eth_sendRawTransactionSync`, transitioning the vault into `PASSKEY_ONLY` mode in **<1 second (1–2 Monad blocks)**.
   - Any hijacked `withdraw(drainer, amount)` call immediately **reverts on-chain** with `VaultInPasskeyOnlyMode`.
2. **Native EIP-7951 (`0x0100`) Hardware Escape Hatch**
   - Instead of freezing assets (which creates a false-positive DoS vector), users can always recover funds via **TouchID / FaceID WebAuthn (`secp256r1`)** (or WebCrypto P-256 fallback).
   - The contract binds `chainId`, `vault`, `user`, `safeRecipient`, `amount`, `nonce`, and `deadline` into the hardware-signed challenge and verifies it on-chain through Monad's native **`0x0100` precompile (6,900 gas)**—so even a compromised UI cannot alter the payout address.

## Why Monad?
- **MIP-12 300ms blocks / 600ms finality + `eth_sendRawTransactionSync`**: Enables sub-second on-chain circuit breaking before victims sign drainer txs (impossible on 12s chains).
- **Native EIP-7951 (`0x0100`) P-256 precompile**: Verified live on Monad Testnet (`isNativeP256PrecompileActive() == true`, 6,900 gas).
- **Monad-tuned engineering**: 3-RPC fallback (`testnet-rpc.monad.xyz`, `rpc-testnet.monadinfra.com`, `rpc.ankr.com/monad_testnet`), `debug_traceCall (callTracer)`, and tight `+10%` gas limit buffers respecting Monad's `gas_limit` billing model.

## Defense Boundary & Business Model
- **Defense Boundary**:
  - *Protocol Layer (Live MVP)*: Protects protocol vaults/staking withdrawals (`ZeroDrainVault.sol`).
  - *Wallet Layer (Roadmap)*: The exact same `0x0100` policy module mounts cleanly as an **EIP-7702 Wallet Guard Hook** to protect external ERC-20 `approve` / `Permit2` flows.
- **Business Model**: TVL-tiered B2B security SaaS subscription + bonded sentinel alert bounties + DeFi insurance premium discounts.

## Verified Deployments (Monad Testnet `10143`)
| Artifact | Reference |
| :--- | :--- |
| **Live Web App (Mobile & Desktop, `简 / 繁 / EN`)** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` Contract** | [`0xbE9e6B77e05a0f345C06d77B1D841f8835B86Af4`](https://testnet.monadvision.com/address/0xbe9e6b77e05a0f345c06d77b1d841f8835b86af4) |
| **Deployment Tx** | `0x764908a23a8c121423cb0b2fffc598bf13ad0c91039ca665e5712f1d65bcb0a1` |
| **Foundry Fork Tests** | 8/8 passing on `--fork-url https://testnet-rpc.monad.xyz` |

## Project Structure
- `contracts/` — Foundry project (`ZeroDrainVault.sol`, OpenZeppelin `WebAuthn` & `P256`, Monad Testnet fork tests, deploy script)
- `web/` — Next.js 15 static frontend (responsive, 3-language i18n, `ox` WebAuthnP256) + native Cloudflare Pages Functions (`web/functions/api/`)
- `.monskills` — MONSKILLS provenance metadata (`chain=monad-testnet`)

## Quick 30-Second Walkthrough
1. Open **https://zerodrain-monad.pages.dev** (works out of the box in **Instant Demo** mode without MetaMask, or switch to MetaMask).
2. **Step 1**: Bind your **TouchID / FaceID** Passkey on-chain (or use the WebCrypto P-256 fallback).
3. **Step 2**: Click **Simulate Name.com DNS Hijack** -> watch SRI drift, `debug_traceCall`, and sub-second `tripBreaker()` execute live on Monad Testnet.
4. **Step 3**: Click **Try Hijacked Withdraw** -> verify `VaultInPasskeyOnlyMode` on-chain revert (**0 MON lost**).
5. **Step 4**: Click **Recover via TouchID / 0x0100** -> verify native EIP-7951 recovery on MonadVision.
