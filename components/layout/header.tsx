'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Menu, X } from 'lucide-react'
import { useState, useEffect } from 'react'

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <header className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${scrolled ? 'bg-white/95 backdrop-blur-sm border-b border-slate-200 shadow-sm' : 'bg-white border-b border-slate-100'}`}>
      <div className="container mx-auto px-6">
        <div className="flex items-center justify-between h-16">

          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <img src="/flowlink-logo-final.png" alt="FlowLink" className="w-9 h-9 rounded-xl object-cover" />
            <span className="font-bold text-xl tracking-tight">
              <span className="text-slate-900">Flow</span><span className="text-emerald-600">Link</span>
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-8">
            <Link href="/#features" className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium">Features</Link>
            <Link href="/#how-it-works" className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium">How it works</Link>
            <Link href="/#security" className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium">Security</Link>
            <Link
              href="https://card3.ai/profile?card_code=qXIOdwGUB"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-slate-600 hover:text-slate-900 transition-colors font-medium"
            >
              Contact
            </Link>
          </nav>

          {/* Desktop CTAs */}
          <div className="hidden md:flex items-center gap-3">
            <Button asChild variant="ghost" className="text-slate-700 hover:text-slate-900 hover:bg-slate-100 font-medium text-sm">
              <Link href="/login">Sign In</Link>
            </Button>
            <Button asChild className="bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold px-5">
              <Link href="/login">Get Started Free</Link>
            </Button>
          </div>

          {/* Mobile toggle */}
          <Button
            variant="ghost"
            size="sm"
            className="md:hidden text-slate-700"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </div>

        {/* Mobile Nav */}
        {isMenuOpen && (
          <div className="md:hidden bg-white border-t border-slate-200 py-4 space-y-1">
            {[
              { href: '/#features', label: 'Features' },
              { href: '/#how-it-works', label: 'How it works' },
              { href: '/#security', label: 'Security' },
              { href: 'https://card3.ai/profile?card_code=qXIOdwGUB', label: 'Contact', external: true },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                target={item.external ? '_blank' : undefined}
                rel={item.external ? 'noopener noreferrer' : undefined}
                className="block px-4 py-2 text-sm text-slate-600 hover:text-slate-900 hover:bg-slate-50 rounded-lg transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                {item.label}
              </Link>
            ))}
            <div className="pt-3 border-t border-slate-100 flex flex-col gap-2 px-4">
              <Button asChild variant="outline" className="w-full justify-center">
                <Link href="/login" onClick={() => setIsMenuOpen(false)}>Sign In</Link>
              </Button>
              <Button asChild className="w-full bg-emerald-600 hover:bg-emerald-700 justify-center">
                <Link href="/login" onClick={() => setIsMenuOpen(false)}>Get Started Free</Link>
              </Button>
            </div>
          </div>
        )}
      </div>
    </header>
  )
}
