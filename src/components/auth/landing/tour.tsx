'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  CalendarCheck2,
  Gauge,
  ListChecks,
  MessageCircleQuestion,
  MoonStar,
  Radar,
  ShieldCheck,
  Sparkles,
  Sunrise,
  Trophy,
  type LucideIcon,
} from 'lucide-react'
import { Reveal, SectionHead, MiniBars, EquityCurve } from './primitives'
import { cn } from '@/lib/utils'

/**
 * TOUR — the "slides" the owner asked for: an auto-advancing product tour
 * (5 stops). Each stop pairs copy with a distinct animated mockup. Progress
 * bars under the tabs, pause on hover, arrows + dots, reduced-motion safe.
 */

interface Stop {
  id: string
  label: string
  icon: LucideIcon
  title: string
  accent: string
  bullets: string[]
}

const STOPS: Stop[] = [
  {
    id: 'overview',
    label: 'Overview & Briefing',
    icon: Sunrise,
    title: 'Mornings that start with',
    accent: 'your edge on the table',
    bullets: [
      'Daily briefing: yesterday\'s verdict, today\'s focus — before the bell',
      'Hero stats, equity curve and discipline score at a glance',
      'Pin the AI widget where you want it on your desk',
    ],
  },
  {
    id: 'analytics',
    label: 'Deep Analytics',
    icon: Gauge,
    title: 'Every metric that matters,',
    accent: 'sliced 14 ways',
    bullets: [
      'R-multiples, expectancy, profit factor, MFE/MAE, sessions',
      'Calendar, heatmap, treemap, drawdown and pivot analysis',
      'Global filters: every chart answers to the same question',
    ],
  },
  {
    id: 'ai',
    label: 'AI Suite',
    icon: Sparkles,
    title: 'A coach that has actually',
    accent: 'read your journal',
    bullets: [
      'Coach reviews with verdicts, tone and one focus point',
      'Sharp insights on the patterns you can\'t see mid-session',
      'Ask anything — chat grounded on your own trades',
    ],
  },
  {
    id: 'psychology',
    label: 'Psychology & Behavior',
    icon: Radar,
    title: 'The leaks in your discipline,',
    accent: 'on a radar screen',
    bullets: [
      'Behavioral Radar scores patience, tilt control and follow-through',
      'Mistake tagging chained to the trades that caused them',
      'Psychology chain: what you felt → what you did → what it cost',
    ],
  },
  {
    id: 'discipline',
    label: 'Plans, Goals & Compliance',
    icon: Trophy,
    title: 'Rules with teeth, goals',
    accent: 'that keep score',
    bullets: [
      'Versioned trading plans linked to executions and marks',
      'Goals, streaks, challenges and trophies for consistency',
      'Prop-firm compliance: drawdown and daily-loss guardrails',
    ],
  },
]

const SLIDE_MS = 5600

/* ── slide mockups (pure CSS/SVG, each with its own motion) ──────────────── */

function SlideOverview() {
  const items = [
    { done: true, text: 'Yesterday: +2.1R — plan followed on 4/5 trades' },
    { done: true, text: 'London open remains your strongest session' },
    { done: false, text: 'Risk budget: 0.8% of 1% daily cap used' },
  ]
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.07] p-4">
        <div className="flex items-center gap-2">
          <Sunrise className="h-4 w-4 text-emerald-400" aria-hidden />
          <p className="text-xs font-bold text-emerald-300">Daily Briefing · Tue 07:58</p>
        </div>
        <ul className="mt-3 space-y-2">
          {items.map((it, i) => (
            <motion.li
              key={it.text}
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.25 + i * 0.22, duration: 0.35 }}
              className="flex items-start gap-2 text-xs text-slate-300"
            >
              <ListChecks className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', it.done ? 'text-emerald-400' : 'text-amber-300')} aria-hidden />
              {it.text}
            </motion.li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {[
          { l: 'Net P&L', v: '+$4,320', t: 'text-emerald-400' },
          { l: 'Win rate', v: '61%', t: 'text-slate-100' },
          { l: 'Discipline', v: '82 ▲', t: 'text-emerald-400' },
        ].map((k, i) => (
          <motion.div
            key={k.l}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35 + i * 0.14 }}
            className="rounded-xl border border-slate-800/70 bg-slate-900/50 p-3 text-center"
          >
            <p className="text-[9px] font-semibold uppercase tracking-wider text-slate-500">{k.l}</p>
            <p className={cn('mt-1 text-sm font-bold tabular-nums', k.t)}>{k.v}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function SlideAnalytics() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
        <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          R-multiple distribution
        </p>
        <MiniBars values={[2.2, -0.5, 1.8, -1, 2.6, 0.9, -0.4, 3.1, 1.2, -0.8, 2.4, 1.9]} height={64} />
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {[
          { l: 'Expectancy', v: '+0.42R' },
          { l: 'Profit factor', v: '1.86' },
          { l: 'Avg hold', v: '38 min' },
          { l: 'Best session', v: 'London' },
        ].map((k, i) => (
          <motion.div
            key={k.l}
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 + i * 0.12 }}
            className="flex items-center justify-between rounded-xl border border-slate-800/70 bg-slate-900/50 px-3.5 py-2.5"
          >
            <span className="text-[10px] font-medium text-slate-500">{k.l}</span>
            <span className="text-xs font-bold text-slate-100 tabular-nums">{k.v}</span>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function SlideAi() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.06] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold text-violet-300">AI Coach · trade review</p>
          <span className="rounded-md bg-violet-500/15 px-2 py-0.5 text-[10px] font-bold text-violet-300">
            Needs work
          </span>
        </div>
        <p className="mt-2 text-xs leading-relaxed text-slate-300">
          Entries are clean — 8 of 10 inside your plan zones. But exits are impatient: you closed
          <span className="font-bold text-emerald-300"> 0.8R early</span> on average. One fix:
          trail the runner to the 2R marker.
        </p>
      </div>
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
        <div className="flex items-center gap-2">
          <MessageCircleQuestion className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
          <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Ask your journal</p>
        </div>
        <div className="mt-2.5 space-y-2">
          <div className="ml-auto w-fit max-w-[85%] rounded-xl rounded-br-sm bg-emerald-600/80 px-3 py-2 text-[11px] text-white">
            How do my shorts perform after 11:30?
          </div>
          <div className="w-fit max-w-[90%] rounded-xl rounded-bl-sm bg-slate-800/80 px-3 py-2 text-[11px] text-slate-300">
            +3.9R across 6 trades vs −1.2R for longs. Your edge is clearly in afternoon shorts… ★
          </div>
        </div>
      </div>
    </div>
  )
}

function SlidePsychology() {
  const traits = [
    { l: 'Patience', pct: 74 },
    { l: 'Tilt control', pct: 58 },
    { l: 'Follow-through', pct: 86 },
  ]
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
        <div className="relative h-[92px] w-[92px] shrink-0" aria-hidden>
          <div className="absolute inset-0 rounded-full border border-emerald-500/25" />
          <div className="absolute inset-[15px] rounded-full border border-emerald-500/20" />
          <div className="absolute inset-[32px] rounded-full border border-emerald-500/15" />
          <div className="lp-radar-sweep absolute inset-0 rounded-full" />
          <span className="lp-ping-dot absolute left-[60%] top-[28%] h-1.5 w-1.5 rounded-full bg-emerald-300 text-emerald-300/60" />
          <span className="lp-ping-dot absolute left-[30%] top-[60%] h-1.5 w-1.5 rounded-full bg-amber-300 text-amber-300/60" style={{ animationDelay: '1s' }} />
        </div>
        <div className="flex-1 space-y-2.5">
          {traits.map((t, i) => (
            <div key={t.l}>
              <div className="mb-1 flex justify-between text-[10px]">
                <span className="font-medium text-slate-400">{t.l}</span>
                <span className="font-bold text-slate-200 tabular-nums">{t.pct}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
                <motion.div
                  className={cn('h-full rounded-full', t.pct >= 70 ? 'bg-emerald-500' : t.pct >= 50 ? 'bg-amber-400' : 'bg-rose-500')}
                  initial={{ width: 0 }}
                  animate={{ width: `${t.pct}%` }}
                  transition={{ delay: 0.3 + i * 0.18, duration: 0.7, ease: 'easeOut' }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {['Revenge trade ×2', 'Skipped plan', 'Perfect execution ×5'].map((m, i) => (
          <motion.span
            key={m}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 + i * 0.16 }}
            className={cn(
              'rounded-full border px-3 py-1.5 text-[11px] font-medium',
              m.includes('Perfect')
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                : 'border-rose-500/25 bg-rose-500/10 text-rose-300'
            )}
          >
            {m}
          </motion.span>
        ))}
      </div>
    </div>
  )
}

function SlideDiscipline() {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-4">
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          Plan v3.2 — linked executions
        </p>
        <div className="flex items-center gap-1.5">
          {['v1', 'v2', 'v3'].map((v, i) => (
            <div key={v} className="flex items-center gap-1.5">
              <span className={cn('rounded-md px-2 py-1 text-[10px] font-bold', i === 2 ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500')}>
                {v}
              </span>
              {i < 2 && <span className="h-px w-5 bg-slate-700" aria-hidden />}
            </div>
          ))}
          <span className="ml-auto rounded-md bg-slate-800/80 px-2 py-1 text-[10px] font-semibold text-slate-400">
            38 trades linked
          </span>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3.5">
          <div className="flex items-center gap-1.5">
            <CalendarCheck2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <p className="text-[10px] font-semibold text-slate-400">Streak</p>
          </div>
          <p className="mt-1.5 text-xl font-bold text-slate-100">
            12 days <MoonStar className="ml-1 inline h-4 w-4 text-amber-300" aria-hidden />
          </p>
        </div>
        <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3.5">
          <div className="flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
            <p className="text-[10px] font-semibold text-slate-400">Prop drawdown</p>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
            <motion.div
              className="h-full rounded-full bg-emerald-500"
              initial={{ width: 0 }}
              animate={{ width: '38%' }}
              transition={{ delay: 0.4, duration: 0.8 }}
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-500">38% of limit — comfortable</p>
        </div>
      </div>
      <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 px-4 py-3">
        <EquityCurve height={44} className="w-full" />
      </div>
    </div>
  )
}

const SLIDES: Record<string, () => React.JSX.Element> = {
  overview: SlideOverview,
  analytics: SlideAnalytics,
  ai: SlideAi,
  psychology: SlidePsychology,
  discipline: SlideDiscipline,
}

/* ── the tour section ────────────────────────────────────────────────────── */

export function Tour() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [progressKey, setProgressKey] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stop = STOPS[active]
  const Mockup = SLIDES[stop.id]

  useEffect(() => {
    if (paused) return
    timer.current = setInterval(() => {
      setActive((a) => (a + 1) % STOPS.length)
      setProgressKey((k) => k + 1)
    }, SLIDE_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [paused])

  function goTo(i: number) {
    setActive(i)
    setProgressKey((k) => k + 1)
  }

  return (
    <section id="tour" aria-labelledby="tour-heading" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="tour-heading"
          eyebrow="Take the tour"
          title="Five desks. One journal."
          accent="Zero fluff."
          sub="Auto-playing slides below — or click through yourself. Every screen you're about to see is a real page in the app."
        />

        <Reveal delay={0.15} className="mt-12">
          <div
            className="relative mx-auto max-w-5xl rounded-3xl border border-slate-800/70 bg-slate-950/50 p-5 sm:p-8"
            onMouseEnter={() => setPaused(true)}
            onMouseLeave={() => setPaused(false)}
          >
            {/* tabs with progress bars */}
            <div role="tablist" aria-label="Product tour stops" className="flex gap-1.5 overflow-x-auto lp-scroll pb-1">
              {STOPS.map((s, i) => (
                <button
                  key={s.id}
                  role="tab"
                  aria-selected={i === active}
                  onClick={() => goTo(i)}
                  className={cn(
                    'relative shrink-0 overflow-hidden rounded-xl px-4 py-2.5 text-xs font-semibold transition-colors min-h-[44px]',
                    i === active
                      ? 'bg-emerald-500/15 text-emerald-300'
                      : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
                  )}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <s.icon className="h-3.5 w-3.5" aria-hidden />
                    {s.label}
                  </span>
                  {i === active && (
                    <motion.span
                      key={progressKey}
                      className="absolute inset-x-0 bottom-0 h-0.5 bg-emerald-400"
                      initial={{ width: '0%' }}
                      animate={{ width: paused ? '0%' : '100%' }}
                      transition={{ duration: SLIDE_MS / 1000, ease: 'linear' }}
                    />
                  )}
                </button>
              ))}
            </div>

            {/* slide body */}
            <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-center">
              <AnimatePresence mode="wait">
                <motion.div
                  key={stop.id + '-copy'}
                  initial={{ opacity: 0, x: -24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.35 }}
                >
                  <h3 className="text-2xl font-bold tracking-tight text-slate-50 sm:text-3xl">
                    {stop.title}{' '}
                    <span className="bg-gradient-to-r from-emerald-300 to-teal-300 bg-clip-text text-transparent">
                      {stop.accent}
                    </span>
                  </h3>
                  <ul className="mt-5 space-y-3.5">
                    {stop.bullets.map((b) => (
                      <li key={b} className="flex items-start gap-3 text-sm leading-relaxed text-slate-300">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/15">
                          <svg viewBox="0 0 24 24" className="h-3 w-3 text-emerald-400" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden>
                            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </span>
                        {b}
                      </li>
                    ))}
                  </ul>

                  {/* dots — P8-FIX: 44×44 hit areas (touch minimum); the visual
                      dot is the inner span so the design stays identical */}
                  <div className="mt-7 flex items-center gap-3">
                    <div className="-m-3 flex gap-0" role="tablist" aria-label="Slide position">
                      {STOPS.map((s, i) => (
                        <button
                          key={s.id}
                          role="tab"
                          aria-selected={i === active}
                          aria-label={`Go to ${s.label}`}
                          onClick={() => goTo(i)}
                          className="group flex h-11 w-11 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        >
                          <span
                            className={cn(
                              'h-2 rounded-full transition-all',
                              i === active ? 'w-7 bg-emerald-400' : 'w-2 bg-slate-700 group-hover:bg-slate-600'
                            )}
                          />
                        </button>
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-600">
                      {paused ? 'paused' : 'auto-playing'}
                    </span>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* mockup panel */}
              <AnimatePresence mode="wait">
                <motion.div
                  key={stop.id + '-mock'}
                  initial={{ opacity: 0, y: 20, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -20, scale: 0.98 }}
                  transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                  className="lp-sheen relative rounded-2xl border border-slate-800/70 bg-[#0d1526] p-5 shadow-[0_30px_70px_-30px_rgba(0,0,0,0.8)]"
                  aria-label={`${stop.label} preview`}
                >
                  <div className="mb-3.5 flex items-center gap-1.5" aria-hidden>
                    <span className="h-2 w-2 rounded-full bg-rose-500/60" />
                    <span className="h-2 w-2 rounded-full bg-amber-400/60" />
                    <span className="h-2 w-2 rounded-full bg-emerald-500/60" />
                    <span className="ml-2 text-[10px] font-medium text-slate-600">emortrades · {stop.id}</span>
                  </div>
                  <Mockup />
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
