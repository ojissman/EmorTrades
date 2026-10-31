'use client'

import Link from 'next/link'
import { ArrowRight, Check } from 'lucide-react'
import { BrandLockup, Reveal } from './primitives'
import { GoogleButton } from '../auth-shared'
import { scrollToSection } from './navbar'

/**
 * CTA + FOOTER — final gradient panel with the real logo, then the footer.
 * The footer sticks to the bottom on short viewports via the landing page's
 * min-h-screen flex column (see landing-page.tsx).
 */

const CTA_POINTS = ['Free while in beta — every feature included', 'Import years of trades in minutes', 'Your data stays in your database']

export function FinalCta({ onRegister }: { onRegister: () => void }) {
  return (
    <section aria-labelledby="cta-heading" className="pb-20 sm:pb-24 pt-4">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-[#0e1f2e] to-[#0b1220] px-6 py-14 text-center sm:px-12 sm:py-16">
            {/* ambient + watermark */}
            <div className="pointer-events-none absolute inset-0" aria-hidden>
              <div className="absolute left-1/2 top-0 h-64 w-[560px] -translate-x-1/2 rounded-full bg-emerald-500/[0.14] blur-[90px]" />
              <img
                src="/logo.png"
                alt=""
                className="absolute -bottom-10 -right-10 h-56 w-56 rotate-12 opacity-[0.06]"
              />
              <div
                className="absolute inset-0 opacity-[0.3]"
                style={{
                  backgroundImage:
                    'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
                  backgroundSize: '38px 38px',
                }}
              />
            </div>

            <div className="relative">
              <h2 id="cta-heading" className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-slate-50">
                Start journaling your edge
                <br />
                <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
                  today.
                </span>
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base text-slate-400">
                Your future self — the one trading with discipline and a documented edge — starts
                with one import.
              </p>

              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={onRegister}
                  className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-base font-semibold text-white shadow-[0_16px_40px_-12px_rgba(16,185,129,0.65)] transition-all hover:-translate-y-0.5 hover:bg-emerald-500 min-h-[48px]"
                >
                  Create your free account
                  <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1" aria-hidden />
                </button>
                <div className="w-full sm:w-auto">
                  <GoogleButton label="Continue with Google" />
                </div>
              </div>

              <ul className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-x-6 gap-y-2">
                {CTA_POINTS.map((p) => (
                  <li key={p} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                    <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
                    {p}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}

export function LandingFooter({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-auto border-t border-slate-800/60 bg-[#080e1a]">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <BrandLockup />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              The professional trading journal with an AI desk — built for disciplined traders who
              want their edge on the record.
            </p>
          </div>

          <nav aria-label="Product">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Product</h3>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><button type="button" onClick={() => scrollToSection('tour')} className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Take the tour</button></li>
              <li><button type="button" onClick={() => scrollToSection('ai-desk')} className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">AI desk</button></li>
              <li><Link href="/features" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">All features</Link></li>
              <li><Link href="/pricing" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Pricing</Link></li>
              <li><Link href="/blog" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Blog</Link></li>
            </ul>
          </nav>

          <nav aria-label="Account">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Account</h3>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><button type="button" onClick={onRegister} className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Create account</button></li>
              <li><button type="button" onClick={onLogin} className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Sign in</button></li>
              <li><button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Back to top</button></li>
            </ul>
          </nav>

          <nav aria-label="Company">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Company</h3>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><Link href="/about" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">About</Link></li>
              <li><Link href="/faq" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">FAQ</Link></li>
              <li><Link href="/contact" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Contact</Link></li>
              <li><Link href="/privacy" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Privacy Policy</Link></li>
              <li><Link href="/terms" className="inline-flex min-h-[44px] items-center hover:text-emerald-400 transition-colors">Terms of Service</Link></li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-800/60 pt-6">
          <p className="text-xs text-slate-600">© {year} EmorTrades · Institute of Trading. All rights reserved.</p>
          <p className="text-xs text-slate-600">Built for disciplined traders.</p>
        </div>
      </div>
    </footer>
  )
}
