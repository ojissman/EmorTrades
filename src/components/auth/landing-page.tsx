'use client'

/**
 * LandingPage (auth-6a) — public marketing page for EmorTrades.
 * Self-contained client component; `onLogin` / `onRegister` switch the
 * parent to the auth views. Dark premium theme, emerald accents, all
 * previews built with pure CSS (no images / external URLs).
 */

import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import {
  ArrowRight,
  ClipboardCheck,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  Radar,
  Search,
  Sparkles,
  Sunrise,
  Target,
  TrendingUp,
  Upload,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/logo'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/* ------------------------------ content ------------------------------ */

const FEATURES: { icon: LucideIcon; title: string; desc: string }[] = [
  {
    icon: Sparkles,
    title: 'AI Suite',
    desc: 'Coach reviews, daily briefings and sharp insights that read every trade you log — then tell you the truth about them.',
  },
  {
    icon: Radar,
    title: 'Behavioral Radar',
    desc: 'Discipline scoring and behavioral metrics surface the patterns you can’t see mid-session.',
  },
  {
    icon: FileText,
    title: 'Trading Plans',
    desc: 'Versioned plans linked to executions, so accountability is built into every entry you take.',
  },
  {
    icon: Target,
    title: 'Goals & Challenges',
    desc: 'KPIs, streaks and trophies that turn consistency into a game you actually want to win.',
  },
  {
    icon: LayoutDashboard,
    title: 'Custom Dashboards',
    desc: 'Pin and arrange widgets into a command center shaped around your strategy.',
  },
  {
    icon: Upload,
    title: 'One-click Import',
    desc: 'CSV and bulk import with automatic symbol mapping — your full history, onboarded in minutes.',
  },
]

const ADVISORS: { icon: LucideIcon; name: string; desc: string }[] = [
  { icon: Sunrise, name: 'Daily Briefing', desc: 'Edge, risk and focus areas in one morning read.' },
  { icon: MessagesSquare, name: 'Coach Review', desc: 'Pattern-level feedback on the week that just closed.' },
  { icon: Zap, name: 'Sharp Insight', desc: 'The uncomfortable truths most journals soften.' },
  { icon: TrendingUp, name: 'Goals Review', desc: 'KPI progress, streaks and slippage vs. targets.' },
  { icon: ClipboardCheck, name: 'Plan Review', desc: 'Adherence scored against your active plan version.' },
  { icon: Search, name: 'Trade Review', desc: 'A post-mortem for every execution you log.' },
]

const STATS: { value: string; label: string }[] = [
  { value: '381+', label: 'trades journaled' },
  { value: '20+', label: 'analytics pages' },
  { value: '6', label: 'advisors in the AI suite' },
  { value: '100%', label: 'private data' },
]

const STEPS: { n: string; title: string; desc: string }[] = [
  {
    n: '01',
    title: 'Import your trades',
    desc: 'Drop a CSV export or bulk-import your history. Symbols, sides and fees are mapped automatically.',
  },
  {
    n: '02',
    title: 'AI analyzes your behavior',
    desc: 'Six advisors read every execution — discipline, timing, risk and plan adherence — and score what they find.',
  },
  {
    n: '03',
    title: 'Trade your plan with feedback loops',
    desc: 'Briefings before, reviews after. Every session closes the loop and sharpens the next one.',
  },
]

/** Fake equity curve for the hero mockup (div bars, emerald = up, red = drawdown). */
const EQUITY_BARS: { h: number; loss?: boolean }[] = [
  { h: 22 }, { h: 28 }, { h: 24, loss: true }, { h: 33 }, { h: 30, loss: true },
  { h: 38 }, { h: 35, loss: true }, { h: 44 }, { h: 41, loss: true }, { h: 49 },
  { h: 47, loss: true }, { h: 55 }, { h: 51, loss: true }, { h: 58 }, { h: 56, loss: true },
  { h: 63 }, { h: 61, loss: true }, { h: 68 }, { h: 66, loss: true }, { h: 73 },
  { h: 71, loss: true }, { h: 78 }, { h: 84 }, { h: 92 },
]

/* ------------------------------ helpers ------------------------------ */

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Subtle scroll-reveal wrapper (fade + rise, once). */
function Reveal({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, delay, ease: 'easeOut' }}
    >
      {children}
    </motion.div>
  )
}

/** Subtle hover lift for cards. */
function HoverLift({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div className={className} whileHover={{ y: -4 }} transition={{ duration: 0.3, ease: 'easeOut' }}>
      {children}
    </motion.div>
  )
}

function KpiChip({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2.5 text-left">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500 sm:text-[11px]">{label}</p>
      <p
        className={cn(
          'mt-1 text-sm font-semibold tabular-nums sm:text-base',
          positive === false ? 'text-red-400' : positive ? 'text-emerald-400' : 'text-slate-100',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function MeterRow({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">{label}</span>
        <span className="font-medium tabular-nums text-slate-300">{pct}%</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function SectionEyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">{children}</p>
}

/* ------------------------------ component ------------------------------ */

export function LandingPage({ onLogin, onRegister }: { onLogin: () => void; onRegister: () => void }) {
  const year = new Date().getFullYear()

  return (
    <div id="top" className="flex min-h-screen flex-col bg-[#0b1220] text-slate-100 antialiased">
      {/* ------------------------------ nav ------------------------------ */}
      <header className="sticky top-0 z-50 border-b border-slate-800/70 bg-[#0b1220]/85 backdrop-blur-md">
        <nav
          aria-label="Main navigation"
          className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6"
        >
          <button
            type="button"
            onClick={() => scrollToId('top')}
            aria-label="EmorTrades — back to top"
            className="flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
          >
            <Logo className="h-8 w-8" />
            <span className="text-base font-semibold tracking-tight text-slate-100 sm:text-lg">EmorTrades</span>
          </button>
          <div className="flex items-center gap-1.5 sm:gap-3">
            <Button
              variant="ghost"
              onClick={onLogin}
              className="h-11 px-3.5 text-sm text-slate-300 hover:bg-slate-800/60 hover:text-white sm:px-4 dark:hover:bg-slate-800/60 dark:hover:text-white"
            >
              Sign in
            </Button>
            <Button
              onClick={onRegister}
              className="h-11 bg-emerald-500 px-3.5 text-sm font-semibold text-slate-950 shadow-lg shadow-emerald-500/20 hover:bg-emerald-400 hover:text-slate-950 sm:px-5"
            >
              Start free
            </Button>
          </div>
        </nav>
      </header>

      <main className="flex-1">
        {/* ------------------------------ hero ------------------------------ */}
        <section aria-labelledby="hero-heading" className="relative overflow-hidden">
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 -z-10 h-[480px] bg-[radial-gradient(60%_55%_at_50%_0%,rgba(16,185,129,0.14),transparent_75%)]"
          />
          <div className="mx-auto w-full max-w-6xl px-4 pb-16 pt-14 text-center sm:px-6 sm:pb-20 sm:pt-20">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <Badge
                variant="outline"
                className="gap-1.5 border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400"
              >
                <Sparkles className="size-3" aria-hidden="true" />
                AI-Powered Trading Journal
              </Badge>
            </motion.div>

            <motion.h1
              id="hero-heading"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.08, ease: 'easeOut' }}
              className="mx-auto mt-6 max-w-3xl text-4xl font-bold leading-[1.1] tracking-tight text-slate-50 sm:text-5xl md:text-6xl"
            >
              Journal every trade.
              <span className="block bg-gradient-to-r from-emerald-400 via-emerald-300 to-teal-300 bg-clip-text text-transparent">
                Master your edge.
              </span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.16, ease: 'easeOut' }}
              className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-slate-400 sm:text-lg"
            >
              EmorTrades pairs a rigorous trading journal with AI coaching and behavioral analytics — so every
              execution becomes feedback, and every session sharpens your edge.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.24, ease: 'easeOut' }}
              className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row"
            >
              <Button
                onClick={onRegister}
                className="h-12 w-full bg-emerald-500 px-8 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 hover:bg-emerald-400 hover:text-slate-950 sm:w-auto"
              >
                Start free
                <ArrowRight className="size-4" aria-hidden="true" />
              </Button>
              <Button
                asChild
                variant="outline"
                className="h-12 w-full border-slate-700 bg-transparent px-8 text-base text-slate-200 hover:bg-slate-800/60 hover:text-white sm:w-auto dark:border-slate-700 dark:bg-transparent dark:hover:bg-slate-800/60 dark:hover:text-white"
              >
                <a
                  href="#features"
                  onClick={(e) => {
                    e.preventDefault()
                    scrollToId('features')
                  }}
                >
                  See how it works
                </a>
              </Button>
            </motion.div>

            {/* dashboard mockup (pure CSS) */}
            <Reveal className="relative mt-14 sm:mt-16" delay={0.15}>
              <div
                aria-hidden="true"
                className="absolute -inset-x-8 -top-10 bottom-0 rounded-[3rem] bg-emerald-500/10 blur-3xl"
              />
              <div className="relative mx-auto max-w-4xl overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/80 text-left shadow-2xl shadow-black/50">
                <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-700" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-700" aria-hidden="true" />
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-700" aria-hidden="true" />
                  <span className="ml-2 text-xs font-medium text-slate-400">Overview</span>
                  <span className="ml-auto rounded-md border border-slate-800 bg-slate-950/60 px-2 py-1 text-[10px] font-medium text-slate-500">
                    Last 90 days
                  </span>
                </div>

                <div className="p-4 sm:p-6">
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 sm:gap-3">
                    <KpiChip label="Net P&L" value="+$1,248.20" positive />
                    <KpiChip label="Win rate" value="62%" />
                    <KpiChip label="Profit factor" value="1.84" />
                    <KpiChip label="Avg hold" value="42m" />
                  </div>

                  <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-300">Equity curve</p>
                      <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-emerald-400">
                        <TrendingUp className="size-3.5" aria-hidden="true" />
                        +18.4%
                      </span>
                    </div>
                    <div className="mt-3 flex h-28 items-end gap-[3px] sm:h-36 sm:gap-1.5" aria-hidden="true">
                      {EQUITY_BARS.map((bar, i) => (
                        <div
                          key={i}
                          className={cn(
                            'flex-1 rounded-t-sm',
                            bar.loss ? 'bg-red-500/50' : 'bg-gradient-to-t from-emerald-500/30 to-emerald-400/90',
                          )}
                          style={{ height: `${bar.h}%` }}
                        />
                      ))}
                    </div>
                  </div>

                  <div className="mt-4 grid gap-3 sm:grid-cols-5">
                    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 sm:col-span-3">
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 place-items-center rounded-md bg-emerald-500/15">
                          <Sparkles className="size-3.5 text-emerald-400" aria-hidden="true" />
                        </span>
                        <p className="text-xs font-semibold text-slate-200">Coach Review</p>
                        <span className="ml-auto text-[10px] font-medium uppercase tracking-wider text-slate-500">
                          Today
                        </span>
                      </div>
                      <p className="mt-3 border-l-2 border-emerald-400/70 pl-3 text-xs leading-relaxed text-slate-300 sm:text-sm">
                        “You cut winners 38% faster after 2 PM. Your edge decays late-session — set a hard stop at
                        13:00 and let the morning compound.”
                      </p>
                      <p className="mt-3 text-[10px] font-medium text-slate-500">
                        Based on 381 trades · Confidence 87%
                      </p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-4 sm:col-span-2">
                      <p className="text-xs font-semibold text-slate-300">Behavioral Radar</p>
                      <div className="mt-3 space-y-3">
                        <MeterRow label="Discipline" pct={78} />
                        <MeterRow label="Patience" pct={64} />
                        <MeterRow label="Risk control" pct={91} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------ stats band ------------------------------ */}
        <section aria-label="EmorTrades in numbers" className="border-y border-slate-800/60 bg-slate-950/50">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-2 gap-y-8 px-4 py-10 sm:px-6 md:grid-cols-4 md:py-12">
            {STATS.map((s, i) => (
              <Reveal key={s.label} delay={i * 0.06} className="text-center">
                <p className="text-2xl font-bold tabular-nums tracking-tight text-slate-50 sm:text-3xl">{s.value}</p>
                <p className="mt-1.5 text-sm text-slate-400">{s.label}</p>
              </Reveal>
            ))}
          </div>
        </section>

        {/* ------------------------------ features ------------------------------ */}
        <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 py-16 sm:py-20 md:py-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal className="max-w-2xl">
              <SectionEyebrow>Features</SectionEyebrow>
              <h2
                id="features-heading"
                className="mt-3 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl"
              >
                Built for traders who journal to improve
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-400">
                Six pillars that turn a logbook into a feedback machine — from behavioral scoring to plans that
                actually hold you accountable.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
              {FEATURES.map((f, i) => {
                const Icon = f.icon
                return (
                  <Reveal key={f.title} delay={(i % 3) * 0.07} className="h-full">
                    <HoverLift className="h-full">
                      <Card className="h-full gap-0 rounded-xl border-slate-800 bg-slate-900/60 p-5 transition-colors duration-300 hover:border-emerald-500/40 sm:p-6">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                          <Icon className="size-5 text-emerald-400" aria-hidden="true" />
                        </div>
                        <h3 className="mt-4 text-base font-semibold text-slate-100">{f.title}</h3>
                        <p className="mt-2 text-sm leading-relaxed text-slate-400">{f.desc}</p>
                      </Card>
                    </HoverLift>
                  </Reveal>
                )
              })}
            </div>
          </div>
        </section>

        {/* ------------------------------ AI section ------------------------------ */}
        <section
          aria-labelledby="ai-heading"
          className="border-y border-slate-800/60 bg-slate-950/40 py-16 sm:py-20 md:py-24"
        >
          <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16">
            <Reveal>
              <SectionEyebrow>The AI Suite</SectionEyebrow>
              <h2 id="ai-heading" className="mt-3 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
                Six AI advisors, one honest mirror
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-400">
                Each advisor reads your journal from a different angle — behavior, plans, goals and the trades
                themselves — then reports back without the sugarcoating.
              </p>
              <ul className="mt-8 space-y-4 sm:space-y-5">
                {ADVISORS.map((a) => {
                  const Icon = a.icon
                  return (
                    <li key={a.name} className="flex items-start gap-3.5">
                      <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-emerald-500/20 bg-emerald-500/10">
                        <Icon className="size-4 text-emerald-400" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-slate-200">{a.name}</p>
                        <p className="mt-0.5 text-sm text-slate-400">{a.desc}</p>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </Reveal>

            <Reveal delay={0.1}>
              <div className="relative">
                <div
                  aria-hidden="true"
                  className="absolute -inset-6 rounded-full bg-emerald-500/10 blur-3xl"
                />
                <div className="relative rounded-2xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/40 sm:p-6">
                  <div className="flex items-center gap-3">
                    <span className="grid h-9 w-9 place-items-center rounded-lg border border-emerald-500/25 bg-emerald-500/10">
                      <Sparkles className="size-4 text-emerald-400" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-slate-100">Coach Review</p>
                      <p className="text-xs text-slate-500">Weekly · Behavioral</p>
                    </div>
                    <Badge
                      variant="outline"
                      className="ml-auto border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                    >
                      New
                    </Badge>
                  </div>
                  <blockquote className="mt-5 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
                    <p className="border-l-2 border-emerald-400 pl-3.5 text-sm leading-relaxed text-slate-300">
                      “Your Friday sessions cost you $412 this month. Patient entries outperform impulsive ones by
                      1.6R — the data is not subtle. Trade the plan, not the itch.”
                    </p>
                  </blockquote>
                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-slate-400">
                      Confidence 87%
                    </span>
                    <span className="inline-flex items-center rounded-md border border-slate-800 bg-slate-950/60 px-2.5 py-1 text-xs font-medium text-slate-400">
                      381 trades analyzed
                    </span>
                    <span className="inline-flex items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-400">
                      Actionable
                    </span>
                  </div>
                </div>
                <div className="relative mt-3 flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 px-4 py-3.5">
                  <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                  </span>
                  <p className="text-xs text-slate-400">
                    <span className="font-medium text-slate-200">Daily Briefing</span> arrives tomorrow at 08:00 —
                    your edge, risk and focus in one read.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ------------------------------ how it works ------------------------------ */}
        <section
          id="how-it-works"
          aria-labelledby="how-heading"
          className="scroll-mt-20 py-16 sm:py-20 md:py-24"
        >
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal className="mx-auto max-w-2xl text-center">
              <SectionEyebrow>How it works</SectionEyebrow>
              <h2 id="how-heading" className="mt-3 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
                From raw history to refined edge
              </h2>
              <p className="mt-4 text-base leading-relaxed text-slate-400">
                Three steps between where your trading is and where your journal says it could be.
              </p>
            </Reveal>

            <div className="mt-12 grid gap-5 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <Reveal key={s.n} delay={i * 0.08} className="h-full">
                  <div className="h-full rounded-xl border border-slate-800 bg-slate-900/60 p-6">
                    <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-sm font-bold tabular-nums text-emerald-400">
                      {s.n}
                    </span>
                    <h3 className="mt-4 text-base font-semibold text-slate-100">{s.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-slate-400">{s.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ------------------------------ final CTA ------------------------------ */}
        <section aria-labelledby="cta-heading" className="pb-16 sm:pb-20 md:pb-24">
          <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
            <Reveal>
              <div className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/15 via-slate-900/70 to-teal-500/10 px-6 py-12 text-center sm:px-12 sm:py-16">
                <div
                  aria-hidden="true"
                  className="absolute -top-24 left-1/2 h-48 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-emerald-500/20 blur-3xl"
                />
                <div className="relative">
                  <h2 id="cta-heading" className="text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">
                    Your trading edge, journaled.
                  </h2>
                  <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-300">
                    Import your history, meet your six advisors, and get your first honest review — free.
                  </p>
                  <div className="mt-8">
                    <Button
                      onClick={onRegister}
                      className="h-12 bg-emerald-500 px-8 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/30 hover:bg-emerald-400 hover:text-slate-950"
                    >
                      Start free
                      <ArrowRight className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <p className="mt-5 text-xs text-slate-400">
                    Private by default — your journal and your data stay yours.
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      {/* ------------------------------ footer ------------------------------ */}
      <footer className="mt-auto border-t border-slate-800/70 bg-slate-950/60">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2.5">
              <Logo className="h-7 w-7" />
              <span className="text-base font-semibold tracking-tight text-slate-100">EmorTrades</span>
            </div>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-slate-400">
              The AI-powered trading journal for traders who take their edge seriously.
            </p>
          </div>
          <nav
            aria-label="Footer navigation"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 md:justify-end"
          >
            <a
              href="#features"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('features')
              }}
              className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-400 transition-colors hover:text-emerald-400"
            >
              Features
            </a>
            <a
              href="#how-it-works"
              onClick={(e) => {
                e.preventDefault()
                scrollToId('how-it-works')
              }}
              className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-400 transition-colors hover:text-emerald-400"
            >
              How it works
            </a>
            <button
              type="button"
              onClick={onLogin}
              className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-400 transition-colors hover:text-emerald-400"
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={onRegister}
              className="inline-flex min-h-[44px] items-center px-3 text-sm text-slate-400 transition-colors hover:text-emerald-400"
            >
              Create account
            </button>
          </nav>
        </div>
        <div className="border-t border-slate-800/70">
          <p className="mx-auto w-full max-w-6xl px-4 py-5 text-xs text-slate-500 sm:px-6">
            © {year} EmorTrades. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  )
}
