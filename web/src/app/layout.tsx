import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ZeroDrain | Monad Anti-Hijack & EIP-7951 Passkey Firewall",
  description:
    "Sub-second on-chain circuit breaker & native EIP-7951 (0x0100) Passkey firewall against DeFi frontend/DNS hijacking on Monad.",
  icons: { icon: "/zerodrain-logo.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#09080f",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="antialiased selection:bg-violet-500/30 selection:text-violet-100">
        {children}
      </body>
    </html>
  );
}
