import { DM_Sans } from 'next/font/google'
import { GeistMono } from 'geist/font/mono'
import SessionProvider from '@/components/providers/session-provider'
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
        <link rel="icon" href="/logo/favicon-32x32.png" sizes="32x32" type="image/png" />
        <link rel="icon" href="/logo/favicon-16x16.png" sizes="16x16" type="image/png" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" sizes="180x180" />
        <link rel="manifest" href="/site.webmanifest" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="description" content="On-chain invoicing and agent payments platform. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <title>Thia-Term — Payment Infrastructure for Agents</title>
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Thia-Term — Payment Infrastructure for Agents" />
        <meta property="og:description" content="Payment infrastructure for AI agents powered by T3N. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <meta property="og:image" content="/og-image.svg" />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:site_name" content="Thia-Term" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="Thia-Term — Payment Infrastructure for Agents" />
        <meta name="twitter:description" content="On-chain invoicing and agent payments platform. Create invoices, deploy AI agents, build on-chain reputation via ProofLink." />
        <meta name="twitter:image" content="/og-image.svg" />
      </head>
      <body className={`font-sans ${dmSans.variable} ${GeistMono.variable}`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  )
}
