'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useInView } from 'framer-motion'

// Parses a stat string into a numeric target and surrounding text
function parseStat(stat: string): { prefix: string; value: number; suffix: string } {
  const match = stat.match(/^([^0-9]*)([0-9,.]+)(.*)$/)
  if (!match) return { prefix: '', value: 0, suffix: stat }
  const value = parseFloat(match[2].replace(/,/g, ''))
  return { prefix: match[1], value, suffix: match[3] }
}

function AnimatedCounter({ stat, duration = 1800 }: { stat: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-80px' })
  const [displayed, setDisplayed] = useState<string>('0')
  const { prefix, value, suffix } = parseStat(stat)

  useEffect(() => {
    if (!inView) return
    let start: number | null = null
    let frame: number

    const step = (timestamp: number) => {
      if (!start) start = timestamp
      const elapsed = timestamp - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      const current = value * eased

      // Format to match the original (preserve decimal places)
      const original = stat.replace(/^[^0-9]*/, '').replace(/[^0-9.,].*$/, '')
      const decimals = original.includes('.') ? (original.split('.')[1]?.length ?? 0) : 0
      setDisplayed(
        decimals > 0
          ? current.toFixed(decimals)
          : Math.floor(current).toLocaleString()
      )

      if (progress < 1) {
        frame = requestAnimationFrame(step)
      }
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
  }, [inView, value, duration, stat])

  return (
    <span ref={ref}>
      {prefix}{displayed}{suffix}
    </span>
  )
}

const stats = [
  { stat: '< 1s', label: 'Settlement time', sub: 'on HashKey Chain' },
  { stat: '3', label: 'Screening checks', sub: 'per payment' },
  { stat: '6', label: 'Networks supported', sub: 'more coming soon' },
  { stat: '100%', label: 'On-chain records', sub: 'immutable audit trail' },
]

const partners = [
  { name: 'HashKey', label: 'Built on HashKey Chain' },
  { name: 'USDC', label: 'USDC Native' },
  { name: 'Wagmi', label: 'Powered by Wagmi' },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
}

export default function StatsBar() {
  return (
    <>
      {/* ── SOCIAL PROOF BAR ── */}
      <motion.section
        className="bg-slate-50 border-y border-slate-100"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-60px' }}
        transition={{ duration: 0.6 }}
      >
        <div className="container mx-auto px-6 py-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6">
            <p className="text-sm text-slate-500 font-medium">
              Crypto payment infrastructure built on HashKey Chain
            </p>
            <motion.div
              className="flex items-center gap-8"
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              variants={containerVariants}
            >
              {partners.map((partner) => (
                <motion.div
                  key={partner.name}
                  className="flex items-center gap-2 group cursor-default"
                  variants={itemVariants}
                  whileHover={{ y: -1 }}
                  transition={{ duration: 0.15 }}
                >
                  <div className="w-6 h-6 rounded bg-slate-200 group-hover:bg-emerald-100 group-hover:text-emerald-700 flex items-center justify-center text-xs font-bold text-slate-600 transition-colors duration-150">
                    {partner.name[0]}
                  </div>
                  <span className="text-sm font-semibold text-slate-600 group-hover:text-slate-900 transition-colors duration-150">{partner.name}</span>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </div>
      </motion.section>

      {/* ── STATS BAR ── */}
      <section className="bg-white border-b border-slate-100">
        <div className="container mx-auto px-6 py-12">
          <motion.div
            className="grid grid-cols-2 md:grid-cols-4 gap-8 md:divide-x divide-slate-100"
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: '-80px' }}
            variants={containerVariants}
          >
            {stats.map((item) => (
              <motion.div
                key={item.label}
                className="text-center md:px-8 first:pl-0 last:pr-0 group cursor-default"
                variants={itemVariants}
                whileHover={{ scale: 1.03 }}
                transition={{ duration: 0.15 }}
              >
                <div className="text-3xl font-extrabold text-slate-900 mb-0.5 group-hover:text-emerald-600 transition-colors duration-200">
                  {/* Only animate purely numeric stats */}
                  {/^[<>]/.test(item.stat) ? item.stat : <AnimatedCounter stat={item.stat} />}
                </div>
                <div className="text-sm font-medium text-slate-600">{item.label}</div>
                <div className="text-xs text-slate-400 mt-0.5">{item.sub}</div>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>
    </>
  )
}
