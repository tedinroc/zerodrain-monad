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
ZeroDrain enforces frontend hijack protection at the smart contract layer **without freezing funds for users with a pre-registered Passkey**:

1. **Sub-Second Degraded Circuit Breaker (`NORMAL` -> `PASSKEY_ONLY`)**
   - In the interactive sandbox, the Sentinel fetches the served 372-byte action bundle fixture (`/bundles/vault-action.clean.js` vs simulated hijacked payload `/bundles/vault-action.hijacked.js`), verifies live SHA-256 integrity against on-chain `trustedFrontendHash`, and runs Monad `debug_traceCall (callTracer)` to inspect real withdrawal recipients.
   - On drift or recipient tampering, it calls `tripBreaker()` via `eth_sendRawTransactionSync`, switching the vault to `PASSKEY_ONLY` in **<1 second (1–2 Monad blocks)**.
   - Any hijacked `withdraw(drainer, amount)` call immediately **reverts on-chain** (`VaultInPasskeyOnlyMode`).
2. **Incident Key-Lock Invariant (`PasskeyLockedDuringBreaker`)**
   - While in `PASSKEY_ONLY` mode, both `registerPasskey()` and `setRecoveryAddress()` **strictly revert on-chain**. A hijacked frontend cannot trick a victim into overwriting their hardware key or recovery address during an active incident.
3. **Locked Payout Target + Native `0x0100` (EIP-7951) Escape Hatch**
   - `emergencyWithdrawWithWebAuthn()` and `emergencyWithdrawWithRawP256()` **do not accept an arbitrary frontend-supplied recipient in emergency calldata**. Payout goes strictly on-chain to `getLockedRecoveryAddress(msg.sender)` (defaulting to `msg.sender`, or an optional contract-level recovery address set during `NORMAL` mode).
   - Hardware signatures are verified natively via Monad's **`0x0100` precompile (6,900 gas)**.

## Security Model, Known Limitations & Production Roadmap
We explicitly distinguish our **Hackathon Interactive Sandbox** from **Production Mainnet Requirements**:

| Control Surface | Hackathon Sandbox (`pages.dev` + Testnet v2) | Production Mainnet Requirement |
| :--- | :--- | :--- |
| **SRI Scope & Reset Trust Anchor** | Anchors a 372-byte static JS action bundle fixture (`/bundles/vault-action.clean.js`) to prove live byte-hashing + on-chain comparison. `/api/sentinel/reset` strictly validates live hash == compile-time canonical hash and **refuses reset (HTTP 409)** on mismatch (prevents trust-anchor self-legitimization). | Anchor full build asset manifests (all Next/JS/HTML chunks) monitored from independent origins by M-of-N bonded sentinels. |
| **Recovery Address (`setRecoveryAddress`)** | Contract-level only (no UI exposed); frozen in `PASSKEY_ONLY`. Because `NORMAL`-mode setting has no timelock or Passkey approval yet, a compromised UI during `NORMAL` mode could still try to induce a user to call the setter directly. | Enforce **24–48h Timelock + existing Passkey signature confirmation** (or self-only payout) before any `recoveryAddress` change takes effect. |
| **Unbound Users During Breaker** | Users who pre-registered a Passkey never have funds frozen; users without a Passkey must wait for `restoreNormalMode()`. | Enforce Passkey registration at first deposit or provide a signed recovery enrollment path. |
| **Control Plane, Keys & Rate Limiting** | All write APIs enforce Same-Origin CSRF (`403`), strict `application/json` (`415`), input validation (`400`), fail-closed `ADMIN_RESET_TOKEN` toggle, and best-effort per-isolate rate limiting. `PUBLIC_DEMO_MODE=true` is enabled exclusively on Testnet with EOA keys so judges can self-test freely. | Set `PUBLIC_DEMO_MODE=false` (public site strictly read-only), remove server-held keys, transfer `admin` to **Safe Multisig + Timelock**, and enable Cloudflare Edge WAF Rate Limiting / Durable Objects. |
| **WebAuthn, Client Keys & CSP** | **Plan A**: Hardware WebAuthn (`requireUV=false` checks User Presence; relies on browser RP ID binding). **Plan B (Demo Fallback)**: Non-extractable WebCrypto `CryptoKey` (`extractable: false`, IndexedDB only; zero private keys in `localStorage`). Static export CSP allows `'unsafe-inline'` for Next.js hydration. | Optionally enforce `requireUV=true` + on-chain origin allowlist, require hardware WebAuthn on an independent IPFS escape origin, and upgrade to nonce/hash-based edge CSP. |
| **Defense Boundary** | Protocol-level vault withdrawals (`ZeroDrainVault.sol`). | Pair with an **EIP-7702 Wallet Guard Hook** using the same `0x0100` module for external ERC-20 `approve` / `Permit2` protection. |

## Verified Deployments (Monad Testnet `10143`)
| Artifact | Reference |
| :--- | :--- |
| **Live Shared Sandbox (Mobile & Desktop, `简 / 繁 / EN`)** | https://zerodrain-monad.pages.dev |
| **`ZeroDrainVault` v2 Contract** | [`0xF81E520E4512387a906D22C700d282aF6D3247ab`](https://testnet.monadvision.com/address/0xF81E520E4512387a906D22C700d282aF6D3247ab) |
| **Deployment Tx** | `0x11dc6f20beec8e3b37ed8a25951836957edba8c1fc47a1900db3b6db82c461a5` |
| **Anchored Clean Bundle SHA-256** | `0x578f2ffb3fca186b9319a589d4f92909e77689fd2125623965d10f8fc7323207` |
| **Foundry Security & Fork Tests + CI** | 15/15 passing on `--fork-url https://testnet-rpc.monad.xyz` (100% line & function coverage; pinned Foundry `v1.9.0`, OZ `v5.7.0`, `forge-std` `v1.17.0`; **not a formal third-party audit**) |

## Project Structure & Local Verification
- `contracts/` — Foundry project (`ZeroDrainVault.sol`, OpenZeppelin `v5.7.0` `WebAuthn` & `P256`, 15 unit & Monad Testnet fork tests). Install pinned deps via `forge install --no-git foundry-rs/forge-std@v1.17.0 OpenZeppelin/openzeppelin-contracts@v5.7.0` and run `forge test --fork-url https://testnet-rpc.monad.xyz`.
- `web/` — Next.js 15 static frontend (`zh-CN` / `zh-TW` / `en`, responsive, `ox` WebAuthnP256 + non-extractable WebCrypto IndexedDB fallback, `_headers` security headers) + Cloudflare Pages Functions (`web/functions/api/`).
- `.github/workflows/ci.yml` — Continuous integration for Foundry (pinned) + Web (`tsc`, `eslint`, `next build`).
- `.monskills` — MONSKILLS provenance metadata (`chain=monad-testnet`).
- `LICENSE` — MIT License.
