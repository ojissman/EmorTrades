'use client'

import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarDays,
  ChartLine,
  ChevronRight,
  Lock,
  Radar,
  Sparkles,
  Sunrise,
  Target,
} from 'lucide-react'
import { CountUp, EquityCurve } from './primitives'
import { scrollToSection } from './navbar'
import { GoogleButton } from '../auth-shared'

/**
 * LANDING HERO — announcement pill → two-tone headline → dual CTA →
 * full browser mockup of the product with floating annotation cards
 * (the TradesViz layering pattern: mockup under, callouts on top).
 * All numbers animate; the equity curve draws itself; annotation cards float.
 */

const TRUST_CHIPS = [
  { icon: BadgeCheck, label: 'Free while in beta' },
  { icon: Lock, label: 'Verified, bot-proof accounts' },
  { icon: Bot, label: 'Your data — your database' },
]

const TRADE_ROWS = [
  { sym: 'NQ', side: 'LONG', r: '+1.8R', pnl: '+$720', win: true },
  { sym: 'ES', side: 'SHORT', r: '−0.5R', pnl: '−$210', win: false },
  { sym: 'EURUSD', side: 'LONG', r: '+2.2R', pnl: '+$880', win: true },
]

function KpiTile({ label, value, tone = 'neutral', children }: { label: string; value?: string; tone?: 'up' | 'neutral'; children?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-800/70 bg-slate-900/50 px-3.5 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-lg font-bold tabular-nums ${tone === 'up' ? 'text-emerald-400' : 'text-slate-100'}`}>
        {children ?? value}
      </p>
    </div>
  )
}

export function Hero({ onRegister }: { onRegister: () => void }) {
  return (
    <section aria-labelledby="hero-heading" className="relative overflow-hidden pt-28 sm:pt-32 pb-10 sm:pb-14">
      {/* ambient background */}
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute -top-40 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-emerald-500/[0.13] blur-[120px]" />
        <div className="absolute top-40 -left-40 h-96 w-96 rounded-full bg-teal-500/[0.08] blur-[100px]" />
        <div className="absolute top-64 -right-40 h-96 w-96 rounded-full bg-emerald-400/[0.07] blur-[100px]" />
        <div className="lp-grid-bg absolute inset-0 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_35%,black,transparent)]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          {/* announcement pill */}
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45 }}
            onClick={() => scrollToSection('ai-desk')}
            className="group inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 py-1.5 pl-2 pr-3 text-xs font-medium text-emerald-200 transition-colors hover:border-emerald-400/50 hover:bg-emerald-500/15 min-h-[36px]"
            aria-label="See what's new in the AI desk"
          >
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-300">
              <Sparkles className="h-3 w-3" aria-hidden /> New
            </span>
            AI Coach Reviews · Daily Briefings · Sharp Insights
            <ChevronRight className="h-3.5 w-3.5 text-emerald-400 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </motion.button>

          {/* headline */}
          <motion.h1
            id="hero-heading"
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08 }}
            className="mt-5 text-[2.4rem] leading-[1.12] font-bold tracking-tight text-slate-50 sm:text-5xl md:text-6xl md:leading-[1.08]"
          >
            Journal every trade.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
              Sharpen every edge.
            </span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.16 }}
            className="mx-auto mt-4 sm:mt-5 max-w-2xl text-base sm:text-lg leading-relaxed text-slate-400"
          >
            EmorTrades is a professional-grade trading journal with a full AI desk — it reviews your
            executions, briefs you before the bell, and surfaces the behavioral patterns you can&apos;t
            see mid-session.
          </motion.p>

          {/* CTAs */}
          <motion.div
            initial={{ opacity: 0, y: 22 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.24 }}
            className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3"
          >
            <button
              type="button"
              onClick={onRegister}
              className="group inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-emerald-600 px-7 py-3.5 text-base font-semibold text-white shadow-[0_16px_40px_-12px_rgba(16,185,129,0.65)] transition-all hover:-translate-y-0.5 hover:bg-emerald-500 hover:shadow-[0_20px_48px_-12px_rgba(16,185,129,0.85)] min-h-[48px]"
            >
              Start journaling — it&apos;s free
              <ArrowRight className="h-4.5 w-4.5 transition-transform group-hover:translate-x-1" aria-hidden />
            </button>
            <div className="w-full sm:w-auto">
              <GoogleButton label="Continue with Google" />
            </div>
          </motion.div>

          {/* trust chips */}
          <motion.ul
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.36 }}
            className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2"
            aria-label="Why you can trust EmorTrades"
          >
            {TRUST_CHIPS.map((c) => (
              <li key={c.label} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
                <c.icon className="h-3.5 w-3.5 text-emerald-500/80" aria-hidden />
                {c.label}
              </li>
            ))}
          </motion.ul>
        </div>

        {/* ── product mockup ─────────────────────────────────────────── */}
        <motion.div
          initial={{ opacity: 0, y: 60, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.8, delay: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="relative mx-auto mt-10 max-w-5xl sm:mt-16"
        >
          {/* glow under the frame */}
          <div
            className="absolute -inset-x-8 -top-10 bottom-10 rounded-[40px] bg-emerald-500/[0.12] blur-3xl"
            aria-hidden
          />

          {/* browser frame */}
          <div className="relative rounded-2xl border border-slate-700/60 bg-[#0d1526] shadow-[0_40px_90px_-30px_rgba(0,0,0,0.85)] overflow-hidden">
            {/* chrome bar */}
            <div className="flex items-center gap-3 border-b border-slate-800/80 bg-slate-900/70 px-4 py-2.5">
              <div className="flex gap-1.5" aria-hidden>
                <span className="h-3 w-3 rounded-full bg-rose-500/70" />
                <span className="h-3 w-3 rounded-full bg-amber-400/70" />
                <span className="h-3 w-3 rounded-full bg-emerald-500/70" />
              </div>
              <div className="mx-auto flex items-center gap-1.5 rounded-md border border-slate-800 bg-slate-950/70 px-3 py-1 text-[11px] text-slate-400">
                <Lock className="h-3 w-3 text-emerald-500/80" aria-hidden />
                app.emortrades.com/overview
              </div>
              <span className="hidden sm:block text-[10px] font-medium text-slate-600" aria-hidden>
                live demo
              </span>
            </div>

            {/* app body */}
            <div className="flex">
              {/* mini sidebar */}
              <div className="hidden md:flex w-14 flex-col items-center gap-4 border-r border-slate-800/60 bg-slate-950/40 py-5" aria-hidden>
                {[ChartLine, CalendarDays, Radar, Target, Sparkles].map((Icon, i) => (
                  <span
                    key={i}
                    className={`flex h-9 w-9 items-center justify-center rounded-lg ${
                      i === 0 ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-600'
                    }`}
                  >
                    <Icon className="h-4.5 w-4.5" />
                  </span>
                ))}
              </div>

              {/* content */}
              <div className="flex-1 p-4 sm:p-5">
                {/* KPI row */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
                  <KpiTile label="Net P&L" tone="up">
                    +$<CountUp to={12480} duration={1800} />
                  </KpiTile>
                  <KpiTile label="Win rate" value="58%" />
                  <KpiTile label="Profit factor" value="1.86" />
                  <KpiTile label="Discipline" value="82 ▲" tone="up" />
                </div>

                {/* equity curve */}
                <div className="mt-3 rounded-xl border border-slate-800/70 bg-slate-900/40 p-3.5">
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Equity curve — 90 days
                    </p>
                    <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-400">
                      +18.4%
                    </span>
                  </div>
                  <EquityCurve className="w-full" />
                </div>

                {/* trades + radar */}
                <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_auto]">
                  <div className="rounded-xl border border-slate-800/70 bg-slate-900/40 p-3.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Today&apos;s executions
                    </p>
                    <ul className="space-y-1.5">
                      {TRADE_ROWS.map((t, i) => (
                        <motion.li
                          key={t.sym}
                          initial={{ opacity: 0, x: -14 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: 0.9 + i * 0.18, duration: 0.4 }}
                          className="flex items-center justify-between rounded-lg bg-slate-950/50 px-3 py-2"
                        >
                          <span className="flex items-center gap-2 text-xs">
                            <span className="font-bold text-slate-200">{t.sym}</span>
                            <span className={`text-[10px] font-semibold ${t.side === 'LONG' ? 'text-sky-300/80' : 'text-amber-300/80'}`}>
                              {t.side}
                            </span>
                          </span>
                          <span className={`text-xs font-bold tabular-nums ${t.win ? 'text-emerald-400' : 'text-rose-400'}`}>
                            {t.r} · {t.pnl}
                          </span>
                        </motion.li>
                      ))}
                    </ul>
                  </div>

                  {/* mini behavior radar */}
                  <div className="hidden lg:flex flex-col items-center justify-center rounded-xl border border-slate-800/70 bg-slate-900/40 p-3.5 w-[150px]">
                    <div className="relative h-[86px] w-[86px]" aria-hidden>
                      <div className="absolute inset-0 rounded-full border border-emerald-500/25" />
                      <div className="absolute inset-[14px] rounded-full border border-emerald-500/20" />
                      <div className="absolute inset-[30px] rounded-full border border-emerald-500/15" />
                      <div className="lp-radar-sweep absolute inset-0 rounded-full" />
                      <span className="lp-ping-dot absolute left-[58%] top-[30%] h-1.5 w-1.5 rounded-full bg-emerald-300 text-emerald-300/60" />
                      <span className="lp-ping-dot absolute left-[34%] top-[62%] h-1.5 w-1.5 rounded-full bg-amber-300 text-amber-300/60" style={{ animationDelay: '1.1s' }} />
                    </div>
                    <p className="mt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                      Behavior radar
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* floating annotation cards — the TradesViz layering */}
          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.3, duration: 0.6 }}
            className="lp-float absolute -left-4 lg:-left-14 top-16 hidden sm:block w-60 rounded-2xl border border-emerald-500/25 bg-[#0e1a2b]/95 p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/15">
                <Sparkles className="h-4 w-4 text-emerald-400" aria-hidden />
              </span>
              <p className="text-xs font-bold text-emerald-300">AI Insight</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              3 of your last 4 losses ran past <span className="font-bold text-rose-300">−2R</span> —
              cutting faster would have saved <span className="font-bold text-emerald-300">$1,140</span> this month.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 1.5, duration: 0.6 }}
            className="lp-float-delay absolute -right-4 lg:-right-14 top-40 hidden sm:block w-64 rounded-2xl border border-teal-500/25 bg-[#0e1a2b]/95 p-4 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15">
                <Sunrise className="h-4 w-4 text-teal-300" aria-hidden />
              </span>
              <p className="text-xs font-bold text-teal-300">Coach Briefing · 07:58</p>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-slate-300">
              London open is your strongest session — <span className="font-bold text-emerald-300">+4.2R</span> avg
              this month. Stick to the plan until 11:30.
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.7, duration: 0.6 }}
            className="lp-float-soft absolute -bottom-6 left-10 hidden lg:flex items-center gap-3 rounded-2xl border border-slate-700/60 bg-[#0e1a2b]/95 px-4 py-3 shadow-[0_24px_60px_-20px_rgba(0,0,0,0.9)] backdrop-blur"
          >
            <span className="relative flex h-2.5 w-2.5" aria-hidden>
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            <p className="text-xs text-slate-300">
              <span className="font-bold text-slate-100">Discipline score 82</span> — up 14 this month
            </p>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}
