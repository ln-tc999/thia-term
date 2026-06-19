import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SidebarLayout } from "@/components/layout/sidebar";
import { AuthGate } from "@/components/auth-gate";
import { Providers } from "./providers";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "ProofLink Dashboard",
    template: "%s | ProofLink",
  },
  description:
    "Compliance-as-infrastructure for stablecoin and AI agent payments. Monitor transactions, manage policies, and review compliance in real time.",
  applicationName: "ProofLink",
  keywords: ["compliance", "stablecoin", "payments", "AI agents", "ProofLink"],
  icons: {
    icon: "/favicon.ico",
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d1117" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${inter.variable} font-sans antialiased`}
      >
        <Providers>
          <AuthGate>
            <SidebarLayout>{children}</SidebarLayout>
          </AuthGate>
        </Providers>
      </body>
    </html>
  );
}
