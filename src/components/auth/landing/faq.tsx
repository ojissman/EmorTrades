'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Reveal, SectionHead } from './primitives'
import { cn } from '@/lib/utils'

/**
 * FAQ — accordion (shadcn-style, hand-rolled so each answer can animate
 * height smoothly and stay accessible).
 */

const FAQS = [
  {
    q: 'Is my trading data private?',
    a: 'Yes — by architecture, not by policy. Every account lives in its own scoped slice of a single private database, and every API request is authenticated and user-scoped. There is no third-party analytics on your trades and your journal data never trains anyone\'s models.',
  },
  {
    q: 'Which markets and instruments are supported?',
    a: 'All of them: stocks, futures, forex, crypto and options. Any symbol you can type, with per-account currency, R-multiple tracking and commission handling built in.',
  },
  {
    q: 'Can I import my existing trade history?',
    a: 'Yes — CSV, Excel, XML, HTML tables and JSON are all parsed natively, with AI-assisted column mapping that learns your broker\'s export format. Most traders import years of history in their first sitting.',
  },
  {
    q: 'What does the AI actually see?',
    a: 'Only your journal — trades, plans, notes and metrics from your own account. The AI desk is grounded on that data when it writes reviews, briefings and insights. You can bring your own provider keys (OpenAI, Anthropic, GLM and more) or use the built-in model.',
  },
  {
    q: 'Is it free? What\'s the catch?',
    a: 'EmorTrades is free while in beta — every feature, every page, unlimited trades, no tiers and no credit card. Pricing will be announced before launch, and early accounts will be looked after.',
  },
  {
    q: 'Why do I need to verify my email?',
    a: 'It keeps the platform clean: verified accounts stop bots, throwaway actors and spam sign-ups from ever reaching your community. The link is valid for 24 hours — or skip it entirely by signing up with Google, which verifies your Gmail automatically.',
  },
]

function FaqItem({ q, a, open, onToggle }: { q: string; a: string; open: boolean; onToggle: () => void }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border transition-colors',
        open ? 'border-emerald-500/30 bg-emerald-500/[0.04]' : 'border-slate-800/70 bg-slate-900/30 hover:border-slate-700'
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 px-5 py-4.5 text-left min-h-[56px]"
      >
        <span className={cn('text-sm sm:text-base font-semibold', open ? 'text-emerald-200' : 'text-slate-200')}>
          {q}
        </span>
        <ChevronDown
          className={cn('h-4.5 w-4.5 shrink-0 text-slate-500 transition-transform duration-300', open && 'rotate-180 text-emerald-400')}
          aria-hidden
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: 'easeInOut' }}
          >
            <p className="px-5 pb-5 text-sm leading-relaxed text-slate-400">{a}</p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export function Faq() {
  const [open, setOpen] = useState(0)

  return (
    <section id="faq" aria-labelledby="faq-heading" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="faq-heading"
          eyebrow="Questions, answered"
          title="Everything you'd ask"
          accent="before your first import"
        />

        <Reveal delay={0.1} className="mt-12 space-y-3">
          {FAQS.map((f, i) => (
            <FaqItem key={f.q} q={f.q} a={f.a} open={open === i} onToggle={() => setOpen(open === i ? -1 : i)} />
          ))}
        </Reveal>
      </div>
    </section>
  )
}
