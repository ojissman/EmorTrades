'use client'

import { motion } from 'framer-motion'
import { BrainCircuit, MessageCircleQuestion, Sparkles, Sunrise, TrendingUp, Zap } from 'lucide-react'
import { Reveal, SectionHead, useTypewriter } from './primitives'

/**
 * AI DESK — the "AI review, Insights, Coach briefing motions" section.
 * A live-typing coach review (loops forever), a briefing card whose items
 * check in one by one, and insight chips that pop with a spark.
 */

const COACH_LINES = [
  'Reviewed 14 trades from this week…',
  'Entries: 9 of 10 inside your plan zones — excellent.',
  'Exits: you cut winners 0.8R early on average. Let the runner breathe.',
  'Leak found: 2 revenge trades after 11:30 losses — cost −2.3R.',
  'Verdict: solid entries, impatient exits. Focus: trail to 2R.',
]

const BRIEFING_ITEMS = [
  { strong: 'Yesterday +2.1R', rest: ' — plan followed on 4 of 5 trades' },
  { strong: 'London open', rest: ' is your best session again (+4.2R avg)' },
  { strong: 'Risk budget', rest: ' — 0.8% of your 1% daily cap used' },
  { strong: 'Watchlist', rest: ' — NQ reacting to the 07:00 level' },
]

const CAPABILITIES = [
  {
    icon: BrainCircuit,
    title: 'Coach Reviews',
    desc: 'Every execution, reviewed — with a verdict, a tone and exactly one thing to fix next session.',
  },
  {
    icon: Sunrise,
    title: 'Daily Briefing',
    desc: 'A morning brief generated from yesterday: what worked, what leaked, what today is for.',
  },
  {
    icon: Sparkles,
    title: 'Sharp Insights',
    desc: 'Pattern detection across your whole journal: sessions, symbols, direction, time-of-day.',
  },
  {
    icon: MessageCircleQuestion,
    title: 'Ask Anything',
    desc: 'A chat grounded on your own trades — ask it anything a risk manager would ask you.',
  },
]

const INSIGHT_CHIPS = [
  { icon: TrendingUp, text: 'Shorts +2.4R vs longs this month', tone: 'emerald' },
  { icon: Zap, text: 'After 11:30, your win rate drops 19 points', tone: 'amber' },
  { icon: TrendingUp, text: 'Tuesday is your most consistent day', tone: 'emerald' },
]

export function AiDesk() {
  const { text } = useTypewriter(COACH_LINES)

  return (
    <section
      id="ai-desk"
      aria-labelledby="ai-heading"
      className="relative scroll-mt-20 overflow-hidden border-y border-slate-800/60 bg-[#080e1a] py-20 sm:py-24"
    >
      {/* ambient */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute left-1/4 top-0 h-72 w-72 rounded-full bg-emerald-500/[0.07] blur-[100px]" />
        <div className="absolute bottom-0 right-1/4 h-72 w-72 rounded-full bg-violet-500/[0.05] blur-[100px]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="ai-heading"
          eyebrow="The AI desk"
          title="An AI that has actually"
          accent="read your journal"
          sub="Not a chatbot bolted onto a form — a desk of assistants that read every trade you log, then tell you the truth about them."
        />

        <div className="mt-14 grid gap-10 lg:grid-cols-2 lg:items-center">
          {/* left — capabilities */}
          <div className="space-y-4">
            {CAPABILITIES.map((c, i) => (
              <Reveal key={c.title} delay={i * 0.09}>
                <div className="lp-sheen group flex gap-4 rounded-2xl border border-slate-800/70 bg-slate-900/40 p-5 transition-all hover:-translate-y-0.5 hover:border-emerald-500/35">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-400 transition-transform group-hover:scale-110">
                    <c.icon className="h-5 w-5" aria-hidden />
                  </span>
                  <div>
                    <h3 className="text-base font-semibold text-slate-100">{c.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">{c.desc}</p>
                  </div>
                </div>
              </Reveal>
            ))}
            <Reveal delay={0.4}>
              <p className="text-xs text-slate-600">
                Bring your own keys — OpenAI, Anthropic, GLM and more — or use the built-in model.
                Your journal data never trains anyone&apos;s models.
              </p>
            </Reveal>
          </div>

          {/* right — the live desk */}
          <Reveal delay={0.15}>
            <div className="relative">
              {/* coach review — live typing */}
              <div className="lp-sheen relative rounded-2xl border border-violet-500/25 bg-[#101a2e] p-5 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.85)]">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/15">
                      <BrainCircuit className="h-4 w-4 text-violet-300" aria-hidden />
                      <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-violet-400" aria-hidden />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-100">AI Coach Review</p>
                      <p className="text-[10px] text-slate-500">this week · 14 trades</p>
                    </div>
                  </div>
                  <span className="rounded-md bg-amber-500/15 px-2 py-1 text-[10px] font-bold text-amber-300">
                    Needs work
                  </span>
                </div>
                <div className="mt-4 min-h-[52px] rounded-xl bg-slate-950/60 border border-slate-800/70 px-4 py-3">
                  <p className="text-sm leading-relaxed text-slate-200" aria-label="AI coach live review">
                    {text}
                    <span className="lp-caret" aria-hidden />
                  </p>
                </div>
                <div className="mt-3 flex items-center gap-2 text-[10px] text-slate-600">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
                  grounded on your trades — nothing invented
                </div>
              </div>

              {/* briefing card — items check in */}
              <motion.div
                initial={{ opacity: 0, y: 24 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: 0.35, duration: 0.55 }}
                className="lp-float-soft absolute -bottom-24 -left-2 sm:-left-8 w-[86%] sm:w-80 rounded-2xl border border-emerald-500/25 bg-[#0e1a2b]/97 p-4 shadow-[0_30px_70px_-25px_rgba(0,0,0,0.9)] backdrop-blur"
              >
                <div className="flex items-center gap-2">
                  <Sunrise className="h-4 w-4 text-emerald-400" aria-hidden />
                  <p className="text-xs font-bold text-emerald-300">Coach Briefing · 07:58</p>
                </div>
                <ul className="mt-3 space-y-2">
                  {BRIEFING_ITEMS.map((it, i) => (
                    <motion.li
                      key={it.strong}
                      initial={{ opacity: 0, x: -10 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.6 + i * 0.25, duration: 0.35 }}
                      className="flex items-start gap-2 text-[11px] leading-relaxed text-slate-300"
                    >
                      <svg viewBox="0 0 24 24" className="mt-0.5 h-3 w-3 shrink-0 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                        <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span>
                        <strong className="font-semibold text-slate-100">{it.strong}</strong>
                        {it.rest}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              </motion.div>

              {/* insight chips popping on the right */}
              <div className="absolute -right-2 sm:-right-6 top-16 flex flex-col gap-2.5">
                {INSIGHT_CHIPS.map((chip, i) => (
                  <motion.div
                    key={chip.text}
                    initial={{ opacity: 0, scale: 0.8, x: 20 }}
                    whileInView={{ opacity: 1, scale: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.8 + i * 0.3, type: 'spring', stiffness: 260, damping: 20 }}
                    className={`flex max-w-[220px] items-center gap-2 rounded-xl border px-3.5 py-2.5 text-[11px] font-medium shadow-[0_18px_40px_-18px_rgba(0,0,0,0.9)] backdrop-blur ${
                      chip.tone === 'emerald'
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                        : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    }`}
                  >
                    <chip.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    {chip.text}
                  </motion.div>
                ))}
              </div>
            </div>
            {/* spacer so floating cards don't collide with the next section */}
            <div className="h-40 sm:h-36" aria-hidden />
          </Reveal>
        </div>
      </div>
    </section>
  )
}
