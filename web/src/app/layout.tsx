import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroDrain 零盜盾 | Monad Sub-Second Anti-Hijack & EIP-7951 Passkey Firewall",
  description:
    "Sub-second on-chain circuit breaker & native EIP-7951 (0x0100) Passkey hardware firewall against DeFi frontend/DNS hijacking on Monad.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-Hant" className="dark">
      <body className="antialiased selection:bg-violet-500/30 selection:text-violet-100">
        {children}
      </body>
    </html>
  );
}
