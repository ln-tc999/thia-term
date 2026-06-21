"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence, useInView } from "framer-motion"
import { CheckCircle, Shield, FileText, ArrowRight } from "lucide-react"

const steps = [
  {
    id: 0,
    label: "Initiate",
    icon: FileText,
    content: {
      title: "Payment Initiated",
      body: (
        <div className="space-y-4">
          <div className="flex items-center justify-between py-3 border-b border-white/8">
            <span className="text-white/50 text-sm">Recipient</span>
            <span className="text-white text-sm font-medium">DevStudio GmbH</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-white/8">
            <span className="text-white/50 text-sm">Amount</span>
            <span className="text-white text-sm font-medium">12,500 USDC</span>
          </div>
          <div className="flex items-center justify-between py-3 border-b border-white/8">
            <span className="text-white/50 text-sm">Invoice</span>
            <span className="text-white text-sm font-mono">INV-2026-0892</span>
          </div>
          <div className="flex items-center justify-between py-3">
            <span className="text-white/50 text-sm">Network</span>
            <span className="text-white text-sm font-medium">T3N</span>
          </div>
        </div>
      ),
    },
  },
  {
    id: 1,
    label: "Compliance",
    icon: Shield,
    content: {
      title: "ProofLink Engine Running",
      body: (
        <div className="space-y-3">
          {[
            { label: "Sanctions Screening", status: "Clear" },
            { label: "KYC Verification", status: "Passed" },
            { label: "Vault Policy Check", status: "Passed" },
            { label: "AML Monitoring", status: "No flags" },
          ].map((check, i) => (
            <motion.div
              key={check.label}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15, ease: "easeOut" }}
              className="flex items-center justify-between py-2.5 border-b border-white/8 last:border-0"
            >
              <span className="text-white/50 text-sm">{check.label}</span>
              <span className="flex items-center gap-1.5 text-emerald-400 text-xs font-medium">
                <CheckCircle className="w-3.5 h-3.5" />
                {check.status}
              </span>
            </motion.div>
          ))}
        </div>
      ),
    },
  },
  {
    id: 2,
    label: "Settled",
    icon: CheckCircle,
    content: {
      title: "Payment Settled On-Chain",
      body: (
        <div className="flex flex-col items-center justify-center py-4 gap-4">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 200, damping: 15 }}
            className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center"
          >
            <CheckCircle className="w-8 h-8 text-emerald-400" />
          </motion.div>
          <div className="text-center">
            <p className="text-white font-medium mb-1">Payment Settled</p>
            <p className="text-white/40 text-sm">12,500 USDC → DevStudio GmbH</p>
          </div>
          <div className="w-full rounded-xl bg-white/[0.03] border border-white/8 px-4 py-3 mt-2">
            <p className="text-xs font-mono text-white/30 text-center truncate">
              0x7a3f...4e9c · T3N
            </p>
          </div>
        </div>
      ),
    },
  },
  {
    id: 3,
    label: "Receipt",
    icon: FileText,
    content: {
      title: "Compliance Receipt Issued",
      body: (
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2.5 border-b border-white/8">
            <span className="text-white/50 text-sm">Invoice</span>
            <span className="text-white text-sm font-mono">INV-2026-0892</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b border-white/8">
            <span className="text-white/50 text-sm">Amount</span>
            <span className="text-white text-sm">12,500 USDC</span>
          </div>
          <div className="flex items-center justify-between py-2.5 border-b border-white/8">
            <span className="text-white/50 text-sm">ProofLink ID</span>
            <span className="text-emerald-400 text-xs font-mono">PL-20260113</span>
          </div>
          <div className="flex items-center justify-between py-2.5">
            <span className="text-white/50 text-sm">Audit Trail</span>
            <span className="text-white text-sm">On-chain ✓</span>
          </div>
        </div>
      ),
    },
  },
]

export function DemoSection() {
  const [activeStep, setActiveStep] = useState(0)
  const sectionRef = useRef<HTMLDivElement>(null)
  const inView = useInView(sectionRef, { once: true, margin: "-200px" })
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!inView) return
    timerRef.current = setTimeout(() => {
      setActiveStep((s) => (s + 1) % steps.length)
    }, 2400)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [activeStep, inView])

  const step = steps[activeStep]

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="relative py-32 overflow-hidden"
      style={{
        background: "linear-gradient(180deg, #2a5248 0%, #1a3530 50%, #0f2420 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 50% 40% at 50% 80%, rgba(52,211,153,0.07) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 container mx-auto px-8 max-w-5xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="text-center mb-16"
        >
          <p className="text-xs font-mono text-emerald-400/70 tracking-[0.2em] uppercase mb-5">
            / End-to-End Compliance Flow
          </p>
          <h2 className="text-4xl md:text-5xl font-light text-white tracking-tight">
            How It Works
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
          transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
          className="max-w-lg mx-auto"
        >
          {/* Step tabs */}
          <div className="flex gap-2 mb-6 p-1.5 bg-black/20 rounded-2xl border border-white/8">
            {steps.map((s, i) => (
              <button
                key={s.id}
                onClick={() => {
                  if (timerRef.current) clearTimeout(timerRef.current)
                  setActiveStep(i)
                }}
                className={`relative flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-xs font-medium transition-all duration-300 ${
                  activeStep === i
                    ? "bg-white/10 text-white shadow-sm"
                    : "text-white/30 hover:text-white/60"
                }`}
              >
                {i < activeStep && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                )}
                <span className="hidden sm:inline">{s.label}</span>
                <span className="sm:hidden">{i + 1}</span>
              </button>
            ))}
          </div>

          {/* Progress bar */}
          <div className="h-0.5 bg-white/8 rounded-full mb-8 overflow-hidden">
            <motion.div
              className="h-full bg-emerald-400 rounded-full"
              animate={{ width: `${((activeStep + 1) / steps.length) * 100}%` }}
              transition={{ duration: 0.5, ease: "easeInOut" }}
            />
          </div>

          {/* Content card */}
          <div className="bg-black/30 border border-white/10 rounded-2xl p-6 backdrop-blur-sm min-h-[280px]">
            <AnimatePresence mode="wait">
              <motion.div
                key={activeStep}
                initial={{ opacity: 0, y: 15 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -15 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
              >
                <div className="flex items-center gap-3 mb-6">
                  <div className="w-9 h-9 rounded-xl bg-emerald-500/15 flex items-center justify-center">
                    <step.icon className="w-4 h-4 text-emerald-400" />
                  </div>
                  <h3 className="text-white font-medium">{step.content.title}</h3>
                </div>
                {step.content.body}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current)
                setActiveStep((s) => Math.max(0, s - 1))
              }}
              disabled={activeStep === 0}
              className="text-xs text-white/30 hover:text-white/60 disabled:opacity-0 transition-all duration-200"
            >
              ← Previous
            </button>
            <div className="flex gap-1.5">
              {steps.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    if (timerRef.current) clearTimeout(timerRef.current)
                    setActiveStep(i)
                  }}
                  className={`h-1.5 rounded-full transition-all duration-300 ${
                    i === activeStep ? "bg-emerald-400 w-4" : "bg-white/20 w-1.5"
                  }`}
                />
              ))}
            </div>
            <button
              onClick={() => {
                if (timerRef.current) clearTimeout(timerRef.current)
                setActiveStep((s) => Math.min(steps.length - 1, s + 1))
              }}
              disabled={activeStep === steps.length - 1}
              className="text-xs text-white/30 hover:text-white/60 disabled:opacity-0 transition-all duration-200 flex items-center gap-1"
            >
              Next <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </motion.div>
      </div>
    </section>
  )
}
