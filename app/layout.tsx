import { DM_Sans } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import { Analytics } from '@vercel/analytics/next'
import { Toaster } from '@/components/ui/toaster'
import { Toaster as SonnerToaster } from 'sonner'
import { WalletProvider } from '@/components/providers/wallet-provider'
import { GoogleOneTap } from '@/components/google-one-tap'
import AiChat from '@/components/ai-chat'
import Script from 'next/script'
import './globals.css'

const dmSans = DM_Sans({
  subsets: ['latin'],
  variable: '--font-dm-sans',
  weight: ['300', '400', '500', '600', '700', '800'],
})

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/favicon.png" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="On-chain invoicing and agent payments platform built natively on HashKey Chain. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <title>FlowLink — Agent Payments on HashKey Chain</title>
        {/* Open Graph */}
        <meta property="og:type" content="website" />
        <meta property="og:title" content="FlowLink — Agent Payments on HashKey Chain" />
        <meta property="og:description" content="On-chain invoicing and agent payments platform built natively on HashKey Chain. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <meta property="og:image" content="/og-image.svg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="FlowLink" />
        {/* Twitter / X */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="FlowLink — Agent Payments on HashKey Chain" />
        <meta name="twitter:description" content="On-chain invoicing and agent payments platform built natively on HashKey Chain. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <meta name="twitter:image" content="/og-image.svg" />
      </head>
      <body className={`font-sans ${dmSans.variable} ${GeistMono.variable}`}>
        <Script src="https://accounts.google.com/gsi/client" strategy="beforeInteractive" />
        <WalletProvider>
          <GoogleOneTap />
          {children}
          <AiChat />
          <Toaster />
          <SonnerToaster position="bottom-right" richColors />
          <Analytics />
        </WalletProvider>
      </body>
    </html>
  )
}
