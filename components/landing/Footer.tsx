import Link from "next/link"

export function Footer() {
  return (
    <footer
      className="border-t border-white/8 py-10 px-8"
      style={{ background: "#0a1e1a" }}
    >
      <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6">
        <Link href="/" className="flex items-center gap-2 group">
          <img src="/thia-term-logo.png" alt="Thia-Term" className="w-8 h-8 rounded-lg object-cover opacity-90 group-hover:opacity-100 transition-opacity" />
          <span className="font-bold text-sm tracking-tight">
            <span className="text-white">Thia</span>
            <span className="text-emerald-400">Term</span>
          </span>
        </Link>

        <div className="flex items-center gap-8 text-xs text-white/30">
          <a href="#layers" className="hover:text-white/60 transition-colors">Layers</a>
          <a href="#features" className="hover:text-white/60 transition-colors">Features</a>
          <a href="#how-it-works" className="hover:text-white/60 transition-colors">How It Works</a>
          <Link href="/auth/signin" className="hover:text-white/60 transition-colors">Sign In</Link>
        </div>

        <p className="text-xs text-white/20">
          © 2026 Thia-Term · Powered by T3N
        </p>
      </div>
    </footer>
  )
}
