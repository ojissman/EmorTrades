'use client'

import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Menu, X } from 'lucide-react'
import { BrandLockup } from './primitives'
import { cn } from '@/lib/utils'

/**
 * LANDING NAV — fixed glass navbar. Transparent over the hero, frosted once
 * the visitor scrolls. Mobile: slide-down panel. Links scroll to sections
 * (scrollIntoView, not hash anchors — the hash belongs to the public router).
 */

const LINKS = [
  { label: 'Tour', target: 'tour' },
  { label: 'AI Desk', target: 'ai-desk' },
  { label: 'Features', target: 'features' },
  { label: 'Security', target: 'security' },
  { label: 'FAQ', target: 'faq' },
]

export function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

export function LandingNav({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ y: -70, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-all duration-300',
        scrolled
          ? 'border-b border-slate-800/70 bg-[#0b1220]/85 backdrop-blur-xl shadow-[0_8px_30px_-18px_rgba(0,0,0,0.8)]'
          : 'border-b border-transparent bg-transparent'
      )}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8" aria-label="Main">
        <BrandLockup onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />

        {/* desktop links */}
        <ul className="hidden md:flex items-center gap-1">
          {LINKS.map((l) => (
            <li key={l.target}>
              <button
                type="button"
                onClick={() => scrollToSection(l.target)}
                className="rounded-lg px-3.5 py-2 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800/60 hover:text-white min-h-[44px]"
              >
                {l.label}
              </button>
            </li>
          ))}
        </ul>

        <div className="hidden md:flex items-center gap-2.5">
          <button
            type="button"
            onClick={onLogin}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-200 transition-colors hover:text-white min-h-[44px]"
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={onRegister}
            className="group inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4.5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(16,185,129,0.6)] transition-all hover:bg-emerald-500 hover:shadow-[0_10px_28px_-8px_rgba(16,185,129,0.8)] min-h-[44px]"
          >
            Start free
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </button>
        </div>

        {/* mobile toggle */}
        <button
          type="button"
          className="md:hidden inline-flex h-11 w-11 items-center justify-center rounded-lg text-slate-200 hover:bg-slate-800/60"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-label={open ? 'Close menu' : 'Open menu'}
        >
          {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
        </button>
      </nav>

      {/* mobile panel */}
      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden border-b border-slate-800/70 bg-[#0b1220]/97 backdrop-blur-xl"
        >
          <ul className="space-y-1 px-4 py-4">
            {LINKS.map((l) => (
              <li key={l.target}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setTimeout(() => scrollToSection(l.target), 60)
                  }}
                  className="w-full rounded-lg px-3 py-3 text-left text-sm font-medium text-slate-200 hover:bg-slate-800/60 min-h-[44px]"
                >
                  {l.label}
                </button>
              </li>
            ))}
            <li className="flex gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onLogin()
                }}
                className="flex-1 rounded-lg border border-slate-700 px-4 py-3 text-sm font-medium text-slate-200 min-h-[44px]"
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onRegister()
                }}
                className="flex-1 rounded-lg bg-emerald-600 px-4 py-3 text-sm font-semibold text-white min-h-[44px]"
              >
                Start free
              </button>
            </li>
          </ul>
        </motion.div>
      )}
    </motion.header>
  )
}
