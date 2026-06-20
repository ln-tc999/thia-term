'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { Button } from '@/components/ui/button'
import {
  Shield,
  ArrowRight,
  Lock,
  UserCheck,
  Ban,
  FileCheck,
  CheckCircle,
} from 'lucide-react'

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number], delay },
})

export default function HeroSection() {
  return (
    <section className="relative overflow-hidden pt-16 bg-white">
      {/* Subtle fintech background image */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=1600&q=80&auto=format&fit=crop"
          alt=""
          className="w-full h-full object-cover opacity-[0.04]"
          aria-hidden="true"
        />
        {/* Fade out toward center so text area stays clean */}
        <div className="absolute inset-0 bg-gradient-to-r from-white via-white/70 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-white/60" />
      </div>
      <div className="container mx-auto px-6 py-20 lg:py-28">
        <div className="grid lg:grid-cols-2 gap-16 items-center">

          {/* ── LEFT — copy ── */}
          <div className="space-y-8">
            {/* Badge */}
            <motion.div {...fadeUp(0)}>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-100 text-emerald-700 text-sm font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Now live on HashKey Chain
              </div>
            </motion.div>

            <div className="space-y-4">
              <motion.h1
                className="text-5xl lg:text-7xl font-black text-slate-900 leading-[1.05] tracking-tight"
                {...fadeUp(0)}
              >
                Invoice, pay, and{' '}
                <span className="text-emerald-600">automate</span>
                {' '}— on HashKey Chain
              </motion.h1>
              <motion.p
                className="text-xl text-slate-500 leading-relaxed max-w-xl"
                {...fadeUp(0.15)}
              >
                Invoices, payment links, payroll, and AI agents that pay automatically. Compliance built in.
              </motion.p>
            </div>

            {/* CTAs */}
            <motion.div
              className="flex flex-col sm:flex-row items-start sm:items-center gap-4"
              {...fadeUp(0.3)}
            >
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button asChild size="lg" className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-base px-8 h-12 shadow-sm">
                  <Link href="/login">
                    Get Started Free
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </motion.div>
              <Link
                href="/#how-it-works"
                className="group flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900 transition-colors font-medium"
              >
                See how it works
                <ArrowRight className="h-3.5 w-3.5 group-hover:translate-x-0.5 transition-transform" />
              </Link>
            </motion.div>

            {/* Trust bar */}
            <motion.div
              className="flex flex-wrap items-center gap-x-6 gap-y-2 pt-2 text-sm text-slate-400 border-t border-slate-100 pt-6"
              {...fadeUp(0.4)}
            >
              <span>Invoices & payment links</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span>AI agent payments</span>
              <span className="w-1 h-1 rounded-full bg-slate-300" />
              <span>KYC & sanctions screening</span>
            </motion.div>
          </div>

          {/* ── RIGHT — product mockup ── */}
          <motion.div
            className="relative flex justify-center lg:justify-end"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number], delay: 0.4 }}
          >
            {/* Light background panel */}
            <div className="absolute inset-0 bg-slate-50 rounded-3xl" />

            {/* Side image */}
            <div className="absolute inset-0 rounded-3xl overflow-hidden opacity-20">
              <img
                src="/image6.jpeg"
                alt=""
                className="w-full h-full object-cover"
              />
            </div>

            <div className="relative w-full max-w-md py-8 px-4">
              {/* Browser chrome card */}
              <div className="relative bg-white rounded-2xl shadow-[0_8px_40px_-8px_rgba(0,0,0,0.12)] border border-slate-200 overflow-hidden">

                {/* Browser bar */}
                <div className="bg-slate-50 border-b border-slate-200 px-4 py-3 flex items-center gap-3">
                  <div className="flex gap-1.5 shrink-0">
                    <div className="w-3 h-3 rounded-full bg-red-400" />
                    <div className="w-3 h-3 rounded-full bg-yellow-400" />
                    <div className="w-3 h-3 rounded-full bg-green-400" />
                  </div>
                  <div className="flex-1 bg-white border border-slate-200 rounded-md px-3 py-1 flex items-center gap-1.5">
                    <Lock className="h-3 w-3 text-slate-400 shrink-0" />
                    <span className="text-xs font-mono font-semibold text-slate-600 truncate">
                      thia-term.vercel.app/pay/ernest-korkua
                    </span>
                  </div>
                </div>

                {/* Payment UI */}
                <div className="p-5 space-y-4">
                  {/* Merchant header */}
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 font-bold text-sm shrink-0">
                      EK
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-800">Ernest Korkua</div>
                      <div className="text-xs text-slate-400">0x4f2a...93b1 · HashKey Chain</div>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5 text-xs text-green-700 bg-green-50 px-2.5 py-1 rounded-full border border-green-200 shrink-0">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                      Active
                    </div>
                  </div>

                  {/* Amount */}
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                    <div className="text-xs text-slate-400 mb-1 uppercase tracking-wide font-medium">Amount requested</div>
                    <div className="text-4xl font-black text-slate-900">
                      500 <span className="text-xl font-semibold text-slate-400">USDC</span>
                    </div>
                    <div className="text-xs text-slate-400 mt-1">≈ $500.00 USD · HashKey Chain</div>
                  </div>

                  {/* Compliance checks */}
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Compliance Status</div>
                    {[
                      { icon: UserCheck, label: 'KYC Verification', status: 'Passed' },
                      { icon: Ban,       label: 'Sanctions Screening', status: 'Clear' },
                      { icon: FileCheck, label: 'AML Check', status: 'Clear' },
                    ].map((check) => (
                      <div key={check.label} className="flex items-center gap-2.5 py-1.5 px-3 rounded-lg bg-green-50 border border-green-100">
                        <check.icon className="h-4 w-4 text-green-600 shrink-0" />
                        <span className="text-sm text-slate-700 flex-1 font-medium">{check.label}</span>
                        <span className="text-xs font-semibold text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                          ✓ {check.status}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Pay CTA */}
                  <button className="w-full bg-emerald-600 hover:bg-emerald-700 text-white py-3 rounded-xl font-bold text-sm transition-colors">
                    Pay 500 USDC
                  </button>
                </div>
              </div>

              {/* Floating badge — top right */}
              <motion.div
                className="absolute -top-3 -right-3 bg-white rounded-xl shadow-lg border border-slate-100 px-3.5 py-2 flex items-center gap-2"
                initial={{ opacity: 0, scale: 0.8, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
              >
                <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                  <CheckCircle className="h-4 w-4 text-green-600" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">Verified in 0.3s</div>
                  <div className="text-xs text-slate-400">Real-time screening</div>
                </div>
              </motion.div>

              {/* Floating badge — bottom left */}
              <motion.div
                className="absolute -bottom-3 -left-3 bg-white rounded-xl shadow-lg border border-slate-100 px-3.5 py-2 flex items-center gap-2"
                initial={{ opacity: 0, scale: 0.8, y: -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.5, delay: 0.85, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
              >
                <div className="w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                  <Shield className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-900">AML Screened</div>
                  <div className="text-xs text-slate-400">Real-time</div>
                </div>
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}
