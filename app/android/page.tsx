'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { ArrowLeft, Smartphone, ArrowRight, CheckCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export default function AndroidComingSoon() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email) return
    setSubmitting(true)
    // Simulate a brief delay — no backend needed
    await new Promise((r) => setTimeout(r, 600))
    setSubmitting(false)
    setEmail('')
    toast.success("You're on the list!", {
      description: "We'll notify you when the FlowLink mobile app launches.",
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 relative overflow-hidden flex flex-col">
      {/* Background grid */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(rgba(16,185,129,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(16,185,129,0.04) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      {/* Radial glow */}
      <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[500px] bg-emerald-500/10 rounded-full blur-[120px] pointer-events-none" />

      {/* Nav */}
      <nav className="relative z-10 flex items-center justify-between px-6 py-5 border-b border-white/5">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/flowlink-logo-final.png" alt="FlowLink" width={120} height={32} className="h-7 w-auto" />
        </Link>
        <Button asChild variant="ghost" size="sm" className="text-slate-400 hover:text-white">
          <Link href="/">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back
          </Link>
        </Button>
      </nav>

      {/* Main content */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="max-w-xl w-full"
        >
          {/* Icon */}
          <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-8">
            <Smartphone className="h-9 w-9 text-emerald-400" />
          </div>

          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-sm font-medium mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Coming Soon
          </div>

          {/* Headline */}
          <h1 className="text-4xl sm:text-5xl font-black text-white mb-4 tracking-tight leading-[1.1]">
            Mobile App{' '}
            <span className="text-emerald-400">Launching Soon</span>
          </h1>
          <p className="text-lg text-slate-400 leading-relaxed mb-10">
            Take FlowLink on the go. Create payment links, track compliance, and manage crypto payments from your phone — available on iOS and Android.
          </p>

          {/* Feature pills */}
          <div className="flex flex-wrap justify-center gap-3 mb-10">
            {['Payment Links', 'KYC & AML', 'QR Codes', 'Real-time Alerts', 'Multi-Chain'].map((f) => (
              <span
                key={f}
                className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-sm text-slate-300"
              >
                <CheckCircle className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                {f}
              </span>
            ))}
          </div>

          {/* Email capture */}
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
            <Input
              type="email"
              required
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="flex-1 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus-visible:ring-emerald-500 h-11"
            />
            <Button
              type="submit"
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold h-11 px-6 shrink-0"
            >
              {submitting ? 'Saving…' : 'Notify me'}
              {!submitting && <ArrowRight className="ml-1.5 h-4 w-4" />}
            </Button>
          </form>
          <p className="text-xs text-slate-600 mt-3">No spam. We'll only email you when the app is ready.</p>
        </motion.div>
      </div>

      {/* Footer */}
      <div className="relative z-10 text-center py-6 border-t border-white/5 text-xs text-slate-600">
        © {new Date().getFullYear()} FlowLink · Built on HashKey Chain
      </div>
    </div>
  )
}
