"use client"

import { useEffect, useRef } from "react"

const layers = [
  {
    num: "01",
    title: "Human-to-Human",
    subtitle: "Business Stablecoin Payments",
    tag: "Live",
    tagStyle: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    live: true,
    dim: false,
    desc: "Create invoices, generate payment links, and receive stablecoin payments on HashKey Chain. Every settled payment is recorded on-chain and contributes to your verifiable payment reputation.",
  },
  {
    num: "02",
    title: "Human-to-Agent",
    subtitle: "AI-Assisted Transactions",
    tag: "Q1 2026",
    tagStyle: "bg-white/[0.08] text-white/50 border-white/15",
    live: false,
    dim: true,
    desc: "Register AI agents with dedicated wallets. Issue invoices on their behalf, let clients pay directly to agent wallets. Agents earn autonomously, every transaction logged on-chain.",
  },
  {
    num: "03",
    title: "Agent-to-Agent",
    subtitle: "Agents paying agents directly",
    tag: "Q1 2026",
    tagStyle: "bg-white/[0.08] text-white/50 border-white/15",
    live: false,
    dim: true,
    desc: "Agents with verified on-chain history pay each other directly. Thia-Term checks agent identity and payment reputation before each transaction — no human approval needed.",
  },
]

export function LayersSection() {
  const sectionRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view")
            observer.unobserve(entry.target)
          }
        })
      },
      { threshold: 0.12 }
    )

    const items = sectionRef.current?.querySelectorAll(".reveal-item")
    items?.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  return (
    <section id="layers" className="bg-black py-24 md:py-32">
      <style>{`
        .reveal-item {
          opacity: 0;
          transform: translateY(24px);
          transition: opacity 0.6s ease-out, transform 0.6s ease-out;
        }
        .reveal-item.in-view {
          opacity: 1;
          transform: translateY(0);
        }
        .reveal-item:nth-child(2) { transition-delay: 0.08s; }
        .reveal-item:nth-child(3) { transition-delay: 0.16s; }
        .reveal-item:nth-child(4) { transition-delay: 0.24s; }
      `}</style>

      <div ref={sectionRef} className="container mx-auto px-8 max-w-5xl">
        {/* Header */}
        <div className="reveal-item mb-16">
          <p className="text-xs font-mono text-emerald-400/70 tracking-[0.2em] uppercase mb-5">
            / How Thia-Term Scales Compliance
          </p>
          <h2 className="text-5xl md:text-6xl font-light text-white tracking-tight">
            Three Layers
          </h2>
        </div>

        {/* Rows */}
        <div className="divide-y divide-white/[0.08]">
          {layers.map((layer) => (
            <div
              key={layer.num}
              className={`reveal-item group py-10 flex items-start gap-8 transition-opacity duration-300 ${
                layer.dim ? "opacity-60 hover:opacity-100" : ""
              }`}
            >
              {/* Number */}
              <span className="text-xs font-mono text-emerald-400 mt-1.5 w-8 shrink-0">
                {layer.num}
              </span>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 flex-wrap mb-2">
                  <h3 className="text-2xl md:text-3xl font-light text-white">
                    {layer.title}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border ${layer.tagStyle}`}
                  >
                    {layer.live && (
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    )}
                    {layer.tag}
                  </span>
                </div>
                <p className="text-white/40 text-sm font-medium tracking-wide mb-3">
                  {layer.subtitle}
                </p>
                <p className="text-white/30 text-sm leading-relaxed max-w-2xl">
                  {layer.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
