'use client'

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown } from 'lucide-react'
import { Reveal, SectionHead } from './primitives'
import { cn } from '@/lib/utils'
import { FAQS } from '@/config/landing-faqs'

/**
 * FAQ — accordion (shadcn-style, hand-rolled so each answer can animate
 * height smoothly and stay accessible).
 *
 * SEO-UPGRADE: FAQS lives in @/config/landing-faqs (plain data module) so
 * the server-rendered /faq page and the home page's JSON-LD import the SAME
 * values (client-module exports arrive as proxies in server components).
 */

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
