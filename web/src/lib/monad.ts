import { createPublicClient, defineChain, fallback, http, type Address } from "viem";

export const MONAD_TESTNET_RPCS = [
  "https://testnet-rpc.monad.xyz",
  "https://rpc-testnet.monadinfra.com",
  "https://rpc.ankr.com/monad_testnet",
] as const;

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [...MONAD_TESTNET_RPCS] },
    public: { http: [...MONAD_TESTNET_RPCS] },
  },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
    monadscan: { name: "Monadscan", url: "https://testnet.monadscan.com" },
  },
  testnet: true,
});

export const VAULT_ADDRESS = (
  process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xF81E520E4512387a906D22C700d282aF6D3247ab"
) as Address;

export const EXPLORER_URL = "https://testnet.monadvision.com";
export const MONADSCAN_URL = "https://testnet.monadscan.com";

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: fallback(
    MONAD_TESTNET_RPCS.map((url) =>
      http(url, {
        retryCount: 2,
        retryDelay: 250,
        timeout: 8_000,
      })
    ),
    { rank: false }
  ),
});
