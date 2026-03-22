// dashboard/src/app/layout.tsx
import type { Metadata } from "next";
import { JetBrains_Mono, Rajdhani } from "next/font/google";
import "./globals.css";
import { WsProvider } from "@/components/ws-provider/ws-provider";
import { NavTabs } from "@/components/nav/nav-tabs";
import { WsConnectionBannerClient } from "@/components/connection-banner/ws-connection-banner-client";

const rajdhani = Rajdhani({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "cc2cc — Neural Relay",
  description: "Real-time dashboard for Claude-to-Claude communications",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${rajdhani.variable} ${jetbrainsMono.variable} min-h-screen font-sans antialiased`}
        style={{ background: "#020c1b", color: "#c8d8e8" }}
      >
        <WsProvider>
          {/* Top header */}
          <header
            className="relative sticky top-0 z-50 overflow-hidden"
            style={{
              background: "#070f1e",
              borderBottom: "1px solid #1a3356",
            }}
          >
            {/* Scanline overlay */}
            <div
              className="pointer-events-none absolute inset-0"
              style={{
                background:
                  "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,212,255,0.012) 2px, rgba(0,212,255,0.012) 4px)",
              }}
              aria-hidden="true"
            />
            <div className="relative flex h-12 items-center gap-4 px-4">
              {/* Brand */}
              <span className="font-mono text-sm font-bold tracking-widest nr-glow-cyan" style={{ color: "#00d4ff" }}>
                <span style={{ color: "#2a5480" }}>[</span>
                cc2cc
                <span style={{ color: "#2a5480" }}>]</span>
              </span>
              <div
                className="h-4 w-px"
                style={{ background: "#1a3356" }}
                aria-hidden="true"
              />
              <NavTabs />
              <div className="ml-auto">
                <WsConnectionBannerClient />
              </div>
            </div>
          </header>

          <main className="flex-1">{children}</main>
        </WsProvider>
      </body>
    </html>
  );
}
