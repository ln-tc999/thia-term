import Link from 'next/link'
import { Github, Twitter, Linkedin, Mail } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="bg-white border-t border-slate-200">
      <div className="container mx-auto px-6 py-16">

        {/* Main grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-12 mb-12">

          {/* Brand col — spans 2 */}
          <div className="lg:col-span-2 space-y-4">
            <Link href="/" className="flex items-center gap-2.5">
              <img src="/thia-term-logo.png" alt="Thia-Term" className="w-8 h-8 rounded-xl object-cover" />
              <span className="font-bold text-lg">
                <span className="text-slate-900">Thia</span><span className="text-emerald-600">-Term</span>
              </span>
            </Link>
            <p className="text-slate-500 text-sm leading-relaxed max-w-xs">
              Enterprise-grade compliant crypto payments, powered by HashKey Chain. Built for businesses that can't afford non-compliance.
            </p>
            <div className="flex gap-2">
              {[Github, Twitter, Linkedin, Mail].map((Icon, i) => (
                <button key={i} className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-900 transition-colors">
                  <Icon className="h-3.5 w-3.5" />
                </button>
              ))}
            </div>
          </div>

          {/* Product */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Product</h3>
            <ul className="space-y-3">
              {['Features', 'Payment Links', 'Invoicing', 'Payroll', 'Vaults', 'API'].map((l) => (
                <li key={l}>
                  <Link href="#" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{l}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Compliance */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Compliance</h3>
            <ul className="space-y-3">
              {['KYC / AML', 'Sanctions Screening', 'HashKey Chain', 'Audit Logs', 'Security', 'Compliance Vaults'].map((l) => (
                <li key={l}>
                  <Link href="#" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{l}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Company */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-slate-900">Company</h3>
            <ul className="space-y-3">
              {[
                { label: 'About', href: '#' },
                { label: 'Blog', href: '#' },
                { label: 'Careers', href: '#' },
                { label: 'Contact', href: 'https://card3.ai/profile?card_code=qXIOdwGUB', external: true },
                { label: 'Privacy', href: '/privacy' },
                { label: 'Terms', href: '/terms' },
              ].map((item) => (
                <li key={item.label}>
                  <Link
                    href={item.href}
                    target={item.external ? '_blank' : undefined}
                    rel={item.external ? 'noopener noreferrer' : undefined}
                    className="text-sm text-slate-500 hover:text-slate-900 transition-colors"
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Android app download */}
        <div id="android-app" className="border border-slate-200 rounded-2xl p-6 mb-10 flex flex-col md:flex-row items-center justify-between gap-4 bg-slate-50">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-slate-900 font-semibold text-sm">Beta Android App</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-700">Beta</span>
            </div>
            <p className="text-sm text-slate-500">Try Thia-Term on mobile — early access to compliant crypto payments on the go.</p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-2 px-5 py-2.5 bg-slate-200 text-slate-400 text-sm font-semibold rounded-xl cursor-not-allowed">
            APK unavailable
          </span>
        </div>

        {/* Bottom bar */}
        <div className="border-t border-slate-200 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-slate-500">© 2025 Thia-Term. All rights reserved.</p>
          <div className="flex items-center gap-6">
            {['Privacy Policy', 'Terms of Service', 'Cookie Policy'].map((l) => (
              <Link key={l} href="#" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">{l}</Link>
            ))}
          </div>
        </div>
      </div>
    </footer>
  )
}
