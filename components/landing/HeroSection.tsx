"use client"

import Link from "next/link"

export function HeroSection() {
  return (
    <section
      id="home"
      className="relative z-10 min-h-screen flex flex-col justify-center overflow-hidden bg-gradient-to-br from-[#071a1a]/95 via-[#0a2420]/90 to-[#0d2d2d]/95"
    >
      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(28px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .hero-fade-1 { animation: fadeUp 0.75s ease-out 0.10s both; }
        .hero-fade-2 { animation: fadeUp 0.75s ease-out 0.25s both; }
        .hero-fade-3 { animation: fadeUp 0.75s ease-out 0.42s both; }
        .hero-fade-4 { animation: fadeUp 0.75s ease-out 0.58s both; }
        .hero-fade-5 { animation: fadeUp 0.75s ease-out 1.40s both; }
        @keyframes bounceDot {
          0%, 100% { transform: translateY(0); }
          50%       { transform: translateY(8px); }
        }
        .bounce-dot { animation: bounceDot 1.5s ease-in-out infinite; }
      `}</style>

      {/* Static bottom glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 60% at 50% 120%, rgba(52,211,153,0.10) 0%, transparent 70%)",
        }}
      />

      {/* Subtle grid overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(255,255,255,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.4) 1px, transparent 1px)",
          backgroundSize: "80px 80px",
        }}
      />

      <div className="relative z-10 container mx-auto px-5 sm:px-8 pt-24 sm:pt-28 pb-20 sm:pb-24 max-w-6xl">
        {/* Badge */}
        <div className="hero-fade-1 inline-flex items-center gap-2 bg-white/[0.08] border border-white/15 rounded-full px-3.5 py-1.5 text-xs sm:text-sm text-white/80 mb-8 sm:mb-10">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          Built on HashKey Chain
        </div>

        {/* Headline */}
        <h1
          className="hero-fade-2 font-light text-white leading-[1.05] tracking-tight mb-6 sm:mb-8 max-w-4xl"
          style={{ fontSize: "clamp(2.6rem, 9vw, 8rem)" }}
        >
          Invoice, pay,
          <br />
          <span className="font-extralight text-white/65">and automate.</span>
        </h1>

        {/* Subtitle */}
        <p className="hero-fade-3 text-white/55 text-base sm:text-lg leading-relaxed max-w-lg mb-10 sm:mb-12">
          Invoices, payment links, payroll, and AI agents — all on HashKey Chain with compliance built in.
        </p>

        {/* CTAs */}
        <div className="hero-fade-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 max-w-xs sm:max-w-none">
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-2 bg-white text-[#1a3530] font-semibold text-sm px-7 py-3.5 rounded-full hover:bg-white/90 transition-all duration-200 shadow-lg shadow-white/10"
          >
            Try Thia-Term
          </Link>
          <a
            href="#layers"
            className="inline-flex items-center justify-center gap-2 border border-white/25 text-white/80 font-medium text-sm px-7 py-3.5 rounded-full hover:bg-white/5 hover:border-white/40 transition-all duration-200"
          >
            Learn More
          </a>
        </div>
      </div>

      {/* Scroll indicator */}
      <div className="hero-fade-5 absolute bottom-8 sm:bottom-10 left-1/2 -translate-x-1/2 flex flex-col items-center gap-3">
        <span className="text-xs text-white/35 tracking-widest uppercase font-medium">
          Scroll to explore
        </span>
        <div className="bounce-dot w-1.5 h-1.5 rounded-full bg-emerald-400/60" />
      </div>
    </section>
  )
}
