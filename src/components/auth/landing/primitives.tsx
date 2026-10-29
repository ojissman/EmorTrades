'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion, useInView, useReducedMotion } from 'framer-motion'
import { cn } from '@/lib/utils'

/**
 * LANDING PRIMITIVES — the shared motion/design vocabulary for the whole
 * public experience. Everything respects prefers-reduced-motion.
 */

/* ── Reveal — fade + rise on scroll into view ─────────────────────────────── */

export function Reveal({
  children,
  className,
  delay = 0,
  y = 26,
  once = true,
}: {
  children: ReactNode
  className?: string
  delay?: number
  y?: number
  once?: boolean
}) {
  const reduce = useReducedMotion()
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once, margin: '-80px' }}
      transition={{ duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  )
}

/* ── CountUp — animated stat counters ────────────────────────────────────── */

export function CountUp({
  to,
  suffix = '',
  prefix = '',
  duration = 1400,
  className,
}: {
  to: number
  suffix?: string
  prefix?: string
  duration?: number
  className?: string
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!inView || reduce) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - t, 3)
      setValue(Math.round(to * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, to, duration, reduce])

  const display = reduce ? to : value
  return (
    <span ref={ref} className={cn('tabular-nums', className)}>
      {prefix}
      {display}
      {suffix}
    </span>
  )
}

/* ── Brand lockup — the real EmorTrades institute badge + wordmark ───────── */

export function BrandLockup({
  size = 'md',
  className,
  href,
  onClick,
}: {
  size?: 'sm' | 'md' | 'lg'
  className?: string
  href?: string
  onClick?: () => void
}) {
  const img = size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-14 w-14' : 'h-10 w-10'
  const text = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-lg'
  const inner = (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <img
        src="/logo.png"
        alt="EmorTrades — Institute of Trading logo"
        className={cn(img, 'drop-shadow-[0_0_16px_rgba(16,185,129,0.35)]')}
        width={size === 'lg' ? 56 : size === 'sm' ? 32 : 40}
        height={size === 'lg' ? 56 : size === 'sm' ? 32 : 40}
      />
      <span className={cn('font-semibold tracking-tight text-slate-100', text)}>
        Emor<span className="text-emerald-400">Trades</span>
      </span>
    </span>
  )
  if (href) {
    return (
      <a href={href} aria-label="EmorTrades home" className="shrink-0">
        {inner}
      </a>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label="EmorTrades home" className="shrink-0">
        {inner}
      </button>
    )
  }
  return inner
}

/* ── Section header — eyebrow + two-tone headline + sub ──────────────────── */

export function SectionHead({
  eyebrow,
  title,
  accent,
  sub,
  align = 'center',
  id,
}: {
  eyebrow: string
  /** First part of the headline (white). */
  title: string
  /** Second part — rendered in the emerald gradient. */
  accent?: string
  sub?: string
  align?: 'center' | 'left'
  id?: string
}) {
  return (
    <div className={cn('max-w-3xl', align === 'center' ? 'mx-auto text-center' : 'text-left')}>
      <Reveal>
        <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-1 text-[11px] font-semibold tracking-[0.14em] text-emerald-300 uppercase">
          {eyebrow}
        </span>
      </Reveal>
      <Reveal delay={0.08}>
        <h2
          id={id}
          className="mt-4 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl md:text-[2.75rem] md:leading-[1.15]"
        >
          {title}
          {accent && (
            <>
              {' '}
              <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
                {accent}
              </span>
            </>
          )}
        </h2>
      </Reveal>
      {sub && (
        <Reveal delay={0.16}>
          <p className="mt-4 text-base sm:text-lg text-slate-400 leading-relaxed">{sub}</p>
        </Reveal>
      )}
    </div>
  )
}

/* ── Typewriter — looping typed lines for the AI desk ────────────────────── */

export function useTypewriter(lines: string[], speed = 34, holdMs = 2600) {
  const reduce = useReducedMotion()
  const [text, setText] = useState(reduce ? lines[0] ?? '' : '')
  const [lineIdx, setLineIdx] = useState(0)

  useEffect(() => {
    if (reduce) {
      // Reduced motion: just cycle the completed lines slowly.
      const t = setInterval(() => setLineIdx((i) => (i + 1) % lines.length), holdMs)
      return () => clearInterval(t)
    }
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout>

    const typeLine = (li: number, ci: number) => {
      if (cancelled) return
      const line = lines[li]
      if (ci <= line.length) {
        setText(line.slice(0, ci))
        timeout = setTimeout(() => typeLine(li, ci + 1), speed)
      } else {
        timeout = setTimeout(() => {
          if (cancelled) return
          setLineIdx((li + 1) % lines.length)
          typeLine((li + 1) % lines.length, 0)
        }, holdMs)
      }
    }
    typeLine(0, 0)
    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [reduce])

  return { text, lineIdx }
}

/* ── GlowCard — hover-lift + emerald edge glow + sheen ───────────────────── */

export function GlowCard({
  children,
  className,
  as: As = 'div',
}: {
  children: ReactNode
  className?: string
  as?: 'div' | 'article'
}) {
  return (
    <As
      className={cn(
        'lp-sheen group relative rounded-2xl border border-slate-800/80 bg-slate-900/40',
        'transition-all duration-300 hover:-translate-y-1 hover:border-emerald-500/40',
        'hover:shadow-[0_18px_50px_-18px_rgba(16,185,129,0.35)]',
        className
      )}
    >
      {children}
    </As>
  )
}

/* ── Tiny chart helpers (pure SVG, animated draw-in) ─────────────────────── */

export function EquityCurve({
  className,
  stroke = '#34d399',
  width = 320,
  height = 90,
}: {
  className?: string
  stroke?: string
  width?: number
  height?: number
}) {
  const d =
    'M0 74 C 24 70, 36 60, 54 62 S 84 48, 104 54 S 138 40, 158 46 S 196 30, 220 36 S 262 22, 290 26 S 320 10, 344 14'
  const reduce = useReducedMotion()
  return (
    <svg
      viewBox={`0 0 ${width} ${height + 8}`}
      className={className}
      fill="none"
      role="img"
      aria-label="Rising equity curve"
    >
      <defs>
        <linearGradient id="lp-eq-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L ${width} ${height + 8} L 0 ${height + 8} Z`} fill="url(#lp-eq-fill)" opacity="0.8" />
      <motion.path
        d={d}
        stroke={stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
        initial={reduce ? undefined : { pathLength: 0 }}
        whileInView={{ pathLength: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 1.6, ease: 'easeOut' }}
      />
    </svg>
  )
}

export function MiniBars({
  values,
  className,
  height = 56,
}: {
  values: number[]
  className?: string
  height?: number
}) {
  const max = Math.max(...values.map(Math.abs), 1)
  return (
    <div className={cn('flex items-end gap-1', className)} style={{ height }} aria-hidden>
      {values.map((v, i) => (
        <div
          key={i}
          className={cn('lp-bar-grow flex-1 rounded-sm', v >= 0 ? 'bg-emerald-500/70' : 'bg-rose-500/60')}
          style={{ height: `${Math.max(8, (Math.abs(v) / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}
