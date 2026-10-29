'use client'

import './landing/landing.css'
import { BrandIntro } from './landing/brand-intro'
import { LandingNav } from './landing/navbar'
import { Hero } from './landing/hero'
import { BrandMotion } from './landing/brand-motion'
import { StatsBand } from './landing/stats-band'
import { Tour } from './landing/tour'
import { AiDesk } from './landing/ai-desk'
import { BentoFeatures } from './landing/bento'
import { Security } from './landing/security'
import { Steps } from './landing/steps'
import { Testimonials } from './landing/testimonials'
import { Faq } from './landing/faq'
import { FinalCta, LandingFooter } from './landing/cta-footer'

/**
 * LandingPage (AUTH-3) — the premium public face of EmorTrades.
 *
 * Structure (pattern survey: TradesViz, Edgewonk, TraderSync, TradeZeller):
 *   [brand intro film — once per session] → glass nav → announcement pill +
 *   two-tone hero + browser mockup with floating annotation cards → the
 *   institute brand-motion band (official logo loop in a viewfinder frame) →
 *   honest stat counters + import-format marquee → auto-playing product tour
 *   (slides) → live AI desk (typing coach review, briefing, insight chips) →
 *   bento feature grid → security section → how-it-works → testimonials →
 *   FAQ → final CTA → footer.
 *
 * The real institute logo (public/logo.png — the owner-supplied 1024px
 * transparent mark) is used everywhere a logo appears.
 * The wrapper is a min-h-screen flex column so the footer sticks to the
 * bottom on short viewports and is pushed down naturally on long ones.
 */
export function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  return (
    <div id="top" className="flex min-h-screen flex-col bg-[#0b1220] text-slate-100 antialiased selection:bg-emerald-500/30">
      <BrandIntro />
      <LandingNav onLogin={onLogin} onRegister={onRegister} />
      <main className="flex-1">
        <Hero onRegister={onRegister} />
        <BrandMotion />
        <StatsBand />
        <Tour />
        <AiDesk />
        <BentoFeatures />
        <Security />
        <Steps />
        <Testimonials />
        <Faq />
        <FinalCta onRegister={onRegister} />
      </main>
      <LandingFooter onLogin={onLogin} onRegister={onRegister} />
    </div>
  )
}
