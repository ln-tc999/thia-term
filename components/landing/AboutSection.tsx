"use client"

import { useRef } from "react"
import Link from "next/link"
import { motion, useInView } from "framer-motion"
import { ArrowRight } from "lucide-react"


const stats = [
  { label: "Built on HashKey Chain" },
  { label: "Agent-to-Agent Ready" },
  { label: "ProofLink Verified" },
]

export function AboutSection() {
  const sectionRef = useRef<HTMLDivElement>(null)
  const inView = useInView(sectionRef, { once: true, margin: "-150px" })

  return (
    <section
      id="about"
      ref={sectionRef}
      className="relative overflow-hidden py-32"
      style={{
        background:
          "linear-gradient(160deg, #0f2420 0%, #1a3530 50%, #2a5248 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 50%, rgba(52,211,153,0.08) 0%, transparent 70%)",
        }}
      />

      <div className="relative z-10 container mx-auto px-8 max-w-6xl">
        <div className="grid lg:grid-cols-2 gap-20 items-center">
          {/* Left: text */}
          <div>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="text-xs font-mono text-emerald-400/70 tracking-[0.2em] uppercase mb-6"
            >
              / About FlowLink
            </motion.p>
            <motion.h2
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
              transition={{ duration: 0.7, delay: 0.1, ease: "easeOut" }}
              className="text-4xl md:text-5xl font-light text-white leading-tight mb-8"
            >
              Payment infrastructure for
              <br />
              <span className="text-emerald-300">the agent economy</span>
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.7, delay: 0.2, ease: "easeOut" }}
              className="text-white/45 leading-relaxed mb-10 text-base"
            >
              As AI agents become economic actors, they need payment infrastructure
              that builds trust over time. FlowLink records every transaction on
              HashKey Chain, the only regulated blockchain for institutional finance,
              creating a reputation layer that agents carry into every interaction.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y: 20 }}
              transition={{ duration: 0.7, delay: 0.3, ease: "easeOut" }}
              className="flex gap-4 flex-wrap"
            >
              <Link
                href="/auth/signin"
                className="inline-flex items-center gap-2 bg-white text-[#1a3530] font-semibold text-sm px-6 py-3 rounded-full hover:bg-white/90 transition-all duration-200"
              >
                Get Started Free <ArrowRight className="w-4 h-4" />
              </Link>
              <a
                href="#how-it-works"
                className="inline-flex items-center gap-2 border border-white/25 text-white/70 text-sm px-6 py-3 rounded-full hover:bg-white/5 transition-all duration-200"
              >
                See how it works
              </a>
            </motion.div>
          </div>

          {/* Right: stats */}
          <div className="grid grid-cols-1 gap-6">
            {stats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, x: 30 }}
                animate={inView ? { opacity: 1, x: 0 } : { opacity: 0, x: 30 }}
                transition={{ duration: 0.7, delay: 0.15 + i * 0.12, ease: "easeOut" }}
                className="flex items-center p-6 rounded-2xl border border-white/8 bg-white/[0.03]"
              >
                <span className="text-white/70 text-base font-light">{stat.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
