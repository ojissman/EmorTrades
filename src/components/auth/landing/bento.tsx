'use client'

import { motion } from 'framer-motion'
import {
  Bell,
  CalendarClock,
  FileSpreadsheet,
  LayoutGrid,
  Radar,
  ShieldCheck,
  Target,
  Trophy,
  Upload,
} from 'lucide-react'
import { Reveal, SectionHead, GlowCard, MiniBars } from './primitives'
import { cn } from '@/lib/utils'

/**
 * BENTO FEATURES — the app's real capabilities in a layered grid, each card
 * carrying a small live preview (bars, meters, timelines, tickers).
 */

function Meter({ pct, tone }: { pct: number; tone: string }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
      <motion.div
        className={cn('h-full rounded-full', tone)}
        initial={{ width: 0 }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      />
    </div>
  )
}

function CardHead({ icon: Icon, title, desc }: { icon: typeof Radar; title: string; desc: string }) {
  return (
    <div className="relative z-10">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/12 text-emerald-400 transition-transform duration-300 group-hover:scale-110">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-lg font-semibold text-slate-100">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-slate-400">{desc}</p>
    </div>
  )
}

export function BentoFeatures() {
  return (
    <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 py-20 sm:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <SectionHead
          id="features-heading"
          eyebrow="Everything on your desk"
          title="A journal built like"
          accent="a professional workstation"
          sub="Not a pretty trade log — 50+ pages of journaling, analytics, psychology and discipline tooling that work as one system."
        />

        <div className="mt-14 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-6">
          {/* Behavioral radar — large */}
          <Reveal className="lg:col-span-3">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={Radar}
                title="Behavioral Radar"
                desc="Discipline scoring and behavioral metrics that surface the patterns you can't see mid-session."
              />
              <div className="relative mt-5 flex items-center gap-5">
                <div className="relative h-[96px] w-[96px] shrink-0" aria-hidden>
                  <div className="absolute inset-0 rounded-full border border-emerald-500/25" />
                  <div className="absolute inset-[15px] rounded-full border border-emerald-500/20" />
                  <div className="absolute inset-[33px] rounded-full border border-emerald-500/15" />
                  <div className="lp-radar-sweep absolute inset-0 rounded-full" />
                  <span className="lp-ping-dot absolute left-[58%] top-[30%] h-1.5 w-1.5 rounded-full bg-emerald-300 text-emerald-300/60" />
                  <span className="lp-ping-dot absolute left-[32%] top-[60%] h-1.5 w-1.5 rounded-full bg-amber-300 text-amber-300/60" style={{ animationDelay: '1.2s' }} />
                </div>
                <div className="flex-1 space-y-3">
                  {[
                    { l: 'Patience', pct: 74, tone: 'bg-emerald-500' },
                    { l: 'Tilt control', pct: 58, tone: 'bg-amber-400' },
                    { l: 'Follow-through', pct: 86, tone: 'bg-emerald-500' },
                  ].map((t) => (
                    <div key={t.l}>
                      <div className="mb-1 flex justify-between text-[11px]">
                        <span className="text-slate-400">{t.l}</span>
                        <span className="font-bold text-slate-200 tabular-nums">{t.pct}</span>
                      </div>
                      <Meter pct={t.pct} tone={t.tone} />
                    </div>
                  ))}
                </div>
              </div>
            </GlowCard>
          </Reveal>

          {/* Trading plans — large */}
          <Reveal delay={0.08} className="lg:col-span-3">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={Target}
                title="Trading Plans with versioning"
                desc="Versioned plans linked to executions, marks and evidence — accountability built into every entry."
              />
              <div className="mt-5 space-y-2.5" aria-hidden>
                {[
                  { v: 'v3.2 · live', detail: 'NQ London open · 2R target · 1% risk', active: true },
                  { v: 'v3.1', detail: 'tightened stop after review', active: false },
                  { v: 'v3.0', detail: 'added session filter', active: false },
                ].map((row, i) => (
                  <motion.div
                    key={row.v}
                    initial={{ opacity: 0, x: -14 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.2 + i * 0.15 }}
                    className={cn(
                      'flex items-center gap-3 rounded-xl border px-3.5 py-2.5',
                      row.active ? 'border-emerald-500/30 bg-emerald-500/[0.08]' : 'border-slate-800 bg-slate-900/40'
                    )}
                  >
                    <span
                      className={cn(
                        'rounded-md px-2 py-0.5 text-[10px] font-bold',
                        row.active ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'
                      )}
                    >
                      {row.v}
                    </span>
                    <span className={cn('text-[11px]', row.active ? 'text-slate-300' : 'text-slate-500')}>{row.detail}</span>
                  </motion.div>
                ))}
              </div>
            </GlowCard>
          </Reveal>

          {/* Goals & challenges */}
          <Reveal delay={0.05} className="lg:col-span-2">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={Trophy}
                title="Goals & Challenges"
                desc="KPIs, streaks and trophies that turn consistency into a game you want to win."
              />
              <div className="mt-5 space-y-3">
                {[
                  { l: 'Monthly goal', pct: 72, tail: '+$7,200 / $10,000' },
                  { l: 'Consistency streak', pct: 80, tail: '12 of 15 days' },
                ].map((g) => (
                  <div key={g.l}>
                    <div className="mb-1 flex justify-between text-[11px]">
                      <span className="text-slate-400">{g.l}</span>
                      <span className="font-semibold text-slate-300 tabular-nums">{g.tail}</span>
                    </div>
                    <Meter pct={g.pct} tone="bg-gradient-to-r from-emerald-500 to-teal-400" />
                  </div>
                ))}
              </div>
            </GlowCard>
          </Reveal>

          {/* Import */}
          <Reveal delay={0.1} className="lg:col-span-2">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={Upload}
                title="Import anything"
                desc="CSV, Excel, XML, HTML, JSON — with AI-assisted column mapping."
              />
              <div className="mt-5" aria-hidden>
                <div className="flex gap-1.5">
                  {['CSV', 'XLSX', 'XML', 'HTML', 'JSON'].map((f) => (
                    <span key={f} className="rounded-md border border-slate-800 bg-slate-900/60 px-2 py-1 text-[10px] font-bold text-slate-400">
                      {f}
                    </span>
                  ))}
                </div>
                <div className="mt-3 space-y-1.5">
                  {[0, 1, 2].map((i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      whileInView={{ opacity: 1, y: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.25 + i * 0.14 }}
                      className="flex items-center justify-between rounded-lg bg-slate-950/50 px-3 py-1.5"
                    >
                      <span className="flex items-center gap-1.5 text-[10px] text-slate-400">
                        <FileSpreadsheet className="h-3 w-3 text-emerald-500/70" /> row {381 - i}
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-400">mapped ✓</span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </GlowCard>
          </Reveal>

          {/* Custom dashboards */}
          <Reveal delay={0.15} className="lg:col-span-2">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={LayoutGrid}
                title="Custom dashboards"
                desc="Drag-and-drop your own desk — every widget, every chart, pinned your way."
              />
              <div className="mt-5 grid grid-cols-4 gap-1.5" aria-hidden>
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, scale: 0.7 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: 0.15 + i * 0.06, type: 'spring', stiffness: 300, damping: 22 }}
                    className={cn(
                      'relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60',
                      i === 3 ? 'col-span-2 h-14 border-emerald-500/30' : 'h-6'
                    )}
                  >
                    {/* ghosted previews keep every tile visually alive */}
                    {i === 3 ? (
                      <svg viewBox="0 0 80 28" className="absolute inset-0 h-full w-full p-1.5" preserveAspectRatio="none" aria-hidden>
                        <path d="M0 22 C 10 20, 14 12, 22 14 S 34 6, 42 9 S 58 3, 66 6 S 76 2, 80 4" fill="none" stroke="#34d399" strokeWidth="1.6" opacity="0.55" />
                      </svg>
                    ) : i === 1 ? (
                      <span className="absolute inset-0 flex items-center justify-center gap-0.5">
                        {[0, 1, 2].map((b) => (
                          <span key={b} className="h-2.5 w-1 rounded-sm bg-emerald-500/40" />
                        ))}
                      </span>
                    ) : i === 6 ? (
                      <span className="absolute inset-y-0 left-1.5 w-1.5 rounded-full bg-emerald-500/50" />
                    ) : (
                      <span className="lp-grid-bg absolute inset-0 opacity-60" />
                    )}
                  </motion.div>
                ))}
              </div>
            </GlowCard>
          </Reveal>

          {/* Multi-account & prop firm */}
          <Reveal delay={0.05} className="lg:col-span-3">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={ShieldCheck}
                title="Multi-account & prop-firm compliance"
                desc="Unlimited accounts, each with its own equity and guardrails — drawdown and daily-loss limits tracked live."
              />
              <div className="mt-5 space-y-3">
                <div className="flex flex-wrap gap-1.5" aria-hidden>
                  {['Main · $25k', 'FTMO · $100k', 'Funded · $50k'].map((a, i) => (
                    <span
                      key={a}
                      className={cn(
                        'rounded-full border px-2.5 py-1 text-[10px] font-semibold',
                        i === 0
                          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                          : 'border-slate-800 bg-slate-900/60 text-slate-400'
                      )}
                    >
                      {a}
                    </span>
                  ))}
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[11px]">
                    <span className="text-slate-400">Drawdown used</span>
                    <span className="font-semibold text-emerald-300 tabular-nums">38% of limit</span>
                  </div>
                  <Meter pct={38} tone="bg-emerald-500" />
                </div>
              </div>
            </GlowCard>
          </Reveal>

          {/* Watchlists & calendar */}
          <Reveal delay={0.1} className="lg:col-span-3">
            <GlowCard className="h-full p-6">
              <CardHead
                icon={Bell}
                title="Watchlists, alerts & the calendar"
                desc="Real-time quotes, price alerts and the economic calendar — the market context beside your journal."
              />
              <div className="mt-5 space-y-3">
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3.5 py-2.5" aria-hidden>
                  {[
                    { s: 'NQ', p: '21,482', up: true, cls: 'lp-ticker-a' },
                    { s: 'ES', p: '5,831', up: false, cls: 'lp-ticker-b' },
                    { s: 'EURUSD', p: '1.0912', up: true, cls: 'lp-ticker-c' },
                  ].map((t) => (
                    <span key={t.s} className={cn('text-[11px]', t.cls)}>
                      <span className="font-bold text-slate-200">{t.s}</span>{' '}
                      <span className={t.up ? 'text-emerald-400' : 'text-rose-400'}>
                        {t.p} {t.up ? '▲' : '▼'}
                      </span>
                    </span>
                  ))}
                  <Bell className="h-3.5 w-3.5 text-amber-300" aria-hidden />
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-500" aria-hidden>
                  <CalendarClock className="h-3.5 w-3.5 text-emerald-500/80" />
                  Wed — FOMC minutes 19:00 · Thu — NFP 14:30
                </div>
                <MiniBars values={[1.4, -0.6, 2.1, 0.8, -0.3, 1.7]} height={34} />
              </div>
            </GlowCard>
          </Reveal>
        </div>
      </div>
    </section>
  )
}
