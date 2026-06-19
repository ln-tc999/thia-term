'use client'

import { motion } from 'framer-motion'
import { Shield, UserCheck, CheckCircle } from 'lucide-react'

const sectionVariants = {
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

const features = [
  {
    icon: UserCheck,
    title: 'KYC / AML screening',
    desc: 'Every payer is identity-verified before they can send funds. Automatic, not a manual review queue.',
    featured: true,
    image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400&q=70&auto=format&fit=crop',
  },
  {
    icon: Shield,
    title: 'Sanctions checks',
    desc: 'Real-time screening against OFAC, UN, and EU lists on every payment attempt. Flagged wallets are blocked before settlement.',
    image: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=400&q=70&auto=format&fit=crop',
  },
  {
    icon: CheckCircle,
    title: 'On-chain settlement',
    desc: 'Payments settle directly on HashKey Chain. Immutable record, no intermediaries, no reconciliation overhead.',
    image: 'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=400&q=70&auto=format&fit=crop',
  },
]

export default function FeaturesSection() {
  return (
    <section id="features" className="relative bg-white py-24 overflow-hidden">
      {/* Subtle tech texture behind features */}
      <div className="absolute inset-0 pointer-events-none">
        <img
          src="https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=1600&q=80&auto=format&fit=crop"
          alt=""
          className="w-full h-full object-cover opacity-[0.03]"
          aria-hidden="true"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-white via-transparent to-white" />
      </div>
      <div className="container mx-auto px-6 relative">
        <motion.div
          className="max-w-xl mb-14"
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] }}
        >
          <h2 className="text-4xl font-extrabold text-slate-900 mb-4 tracking-tight leading-tight">
            What's built in
          </h2>
          <p className="text-lg text-slate-500">
            Compliance tools are part of the product, not a separate integration.
          </p>
        </motion.div>

        <motion.div
          className="grid grid-cols-1 md:grid-cols-3 gap-5"
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          variants={sectionVariants}
        >
          {features.map((f) => (
            <motion.div
              key={f.title}
              className={`rounded-2xl p-7 border overflow-hidden relative ${f.featured ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-slate-200'}`}
              variants={cardVariants}
              whileHover={{ y: -4, boxShadow: f.featured ? '0 20px 40px rgba(15,27,45,0.3)' : '0 20px 40px rgba(0,0,0,0.08)' }}
              transition={{ duration: 0.2 }}
            >
              {/* Card background image */}
              <div className="absolute inset-0 pointer-events-none">
                <img
                  src={f.image}
                  alt=""
                  className={`w-full h-full object-cover ${f.featured ? 'opacity-[0.08]' : 'opacity-[0.05]'}`}
                  aria-hidden="true"
                />
              </div>
              <div className="relative">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-5 ${f.featured ? 'bg-white/10' : 'bg-emerald-50'}`}>
                  <f.icon className={`h-5 w-5 ${f.featured ? 'text-white' : 'text-emerald-600'}`} />
                </div>
                <h3 className={`text-base font-bold mb-2 ${f.featured ? 'text-white' : 'text-slate-900'}`}>{f.title}</h3>
                <p className={`text-sm leading-relaxed ${f.featured ? 'text-emerald-100' : 'text-slate-500'}`}>{f.desc}</p>
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}
