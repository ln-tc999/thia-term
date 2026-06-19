'use client'

import { motion } from 'framer-motion'
import { FileText, ShieldCheck, Link2 } from 'lucide-react'

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
  },
}

const steps = [
  {
    step: '01',
    icon: FileText,
    title: 'Create your link',
    desc: 'Pick a token and amount, or leave it open. Copy the link. Done.',
    featured: false,
  },
  {
    step: '02',
    icon: ShieldCheck,
    title: 'Payer gets screened',
    desc: 'Before any funds move, we run KYC identity verification and check against OFAC, UN, and EU sanctions lists.',
    featured: true,
  },
  {
    step: '03',
    icon: Link2,
    title: 'Funds settle on-chain',
    desc: 'Payment settles on HashKey Chain. Immutable on-chain record attached. No chasing, no reconciliation.',
    featured: false,
  },
]

export default function HowItWorksSection() {
  return (
    <section id="how-it-works" className="bg-[#F8FAFC] py-24 border-y border-slate-100">
      <div className="container mx-auto px-6">
        <motion.div
          className="max-w-xl mb-16"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        >
          <h2 className="text-4xl font-extrabold text-slate-900 mb-3 tracking-tight">
            How it works
          </h2>
          <p className="text-lg text-slate-500">Three steps to send or receive crypto payments.</p>
        </motion.div>

        <motion.div
          className="grid md:grid-cols-3 gap-6"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={containerVariants}
        >
          {steps.map((s, i) => (
            <motion.div
              key={i}
              className={`relative rounded-2xl p-7 border ${s.featured ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-slate-200'}`}
              variants={cardVariants}
              whileHover={{ y: -4, boxShadow: s.featured ? '0 20px 40px rgba(15,27,45,0.3)' : '0 20px 40px rgba(0,0,0,0.08)' }}
              transition={{ duration: 0.2 }}
            >
              <div className={`text-xs font-mono font-semibold mb-4 ${s.featured ? 'text-slate-500' : 'text-slate-300'}`}>
                {s.step}
              </div>
              <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-5 ${s.featured ? 'bg-white/10' : 'bg-emerald-50'}`}>
                <s.icon className={`h-6 w-6 ${s.featured ? 'text-white' : 'text-emerald-600'}`} />
              </div>
              <h3 className={`text-lg font-bold mb-2 ${s.featured ? 'text-white' : 'text-slate-900'}`}>{s.title}</h3>
              <p className={`text-sm leading-relaxed ${s.featured ? 'text-slate-400' : 'text-slate-500'}`}>{s.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
