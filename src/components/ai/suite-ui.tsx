'use client'

/**
 * ============================================================================
 * AI SUITE — shared UI atoms for the four suite pages.
 * ============================================================================
 * Design language: dark shell palette via CSS vars, emerald/rose/violet/amber
 * semantic accents, compact data-dense cards. Also exports the one fetch
 * wrapper every suite page uses (POST /api/ai/suite).
 */

import { useMemo } from 'react'
import { Sparkles, Crosshair } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCurrencyIn } from '@/lib/format'
import type { SuitePeriod } from '@/lib/ai-suite'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'

// ---- tone semantics ----------------------------------------------------------

export type SuiteTone = 'positive' | 'neutral' | 'warning'

export const TONE: Record<SuiteTone, { color: string; soft: string; label: string }> = {
  positive: { color: '#22c55e', soft: 'rgba(34,197,94,0.10)', label: 'Positive' },
  neutral: { color: '#a78bfa', soft: 'rgba(167,139,250,0.10)', label: 'Neutral' },
  warning: { color: '#f59e0b', soft: 'rgba(245,158,11,0.12)', label: 'Needs work' },
}

export function pnlColor(n: number): string {
  // Task 22 — semantic tokens so Colorblind Mode remaps these too.
  return n > 0 ? 'var(--shell-success)' : n < 0 ? 'var(--shell-danger)' : 'var(--text-secondary)'
}

export function fmtUsd(n: number): string {
  // Settings ▸ Display ▸ Currency Display ▸ AI & briefings — delegates to
  // formatCurrencyIn('ai', …): 'compact' renders the dense "+$1.2K" chip,
  // 'full' renders "+$1,234.00". The explicit +/- sign is fmtUsd's own
  // contract (every caller colors by sign) and is preserved in both modes.
  return `${n >= 0 ? '+' : '-'}${formatCurrencyIn('ai', Math.abs(n))}`
}

// ---- fetch wrapper -------------------------------------------------------------

export interface SuiteResponse {
  kind?: string
  error?: string
  degraded?: boolean
  [k: string]: unknown
}

export async function postSuite(body: Record<string, unknown>): Promise<{ ok: boolean; data: SuiteResponse }> {
  try {
    const res = await fetch('/api/ai/suite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as SuiteResponse
    return { ok: res.ok, data }
  } catch {
    return { ok: false, data: { error: 'The AI suite is unreachable right now.' } }
  }
}

// ---- period chips ---------------------------------------------------------------

const PERIODS: { id: SuitePeriod; label: string }[] = [
  { id: '7d', label: '7D' },
  { id: '30d', label: '30D' },
  { id: '90d', label: '90D' },
  { id: '180d', label: '180D' },
  { id: '365d', label: '365D' },
  { id: 'ytd', label: 'YTD' },
  { id: 'all', label: 'All' },
]

export function PeriodChips({
  value,
  onChange,
  disabled,
  customLabel,
}: {
  value: SuitePeriod
  onChange: (p: SuitePeriod) => void
  disabled?: boolean
  /** Task 16-a — when a custom window is active (period 'custom'), a small
   *  amber chip shows the real dates; clicking any preset chip replaces it. */
  customLabel?: string
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg p-1 flex-wrap" style={{ background: 'var(--bg-inset)' }} role="tablist" aria-label="Analysis period">
      {PERIODS.map((p) => {
        const active = value === p.id
        return (
          <button
            key={p.id}
            role="tab"
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange(p.id)}
            className={cn(
              'px-3 py-1.5 rounded-md text-[11px] font-semibold transition-all duration-150 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed',
              active ? 'shadow-sm' : 'hover:bg-[var(--bg-hover)]'
            )}
            style={active ? { background: 'var(--shell-accent)', color: '#fff' } : { color: 'var(--text-secondary)' }}
          >
            {p.label}
          </button>
        )
      })}
      {value === 'custom' && (
        <span
          role="tab"
          aria-selected
          className="px-3 py-1.5 rounded-md text-[11px] font-semibold flex items-center gap-1.5"
          style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}
          title={customLabel ? `Custom window: ${customLabel}` : 'Custom window'}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#f59e0b' }} aria-hidden="true" />
          {customLabel ?? 'Custom'}
        </span>
      )}
    </div>
  )
}

// ---- Task 16-a: the global-scope bridge ----------------------------------------

/** The app's current scope expressed in suite terms. Read fresh on demand
 *  (never subscribed — the bridge is an explicit user action, not a silent
 *  coupling: the suite keeps its own selectors, this only seeds them). */
export interface AppSuiteScope {
  period: SuitePeriod
  /** '' = All accounts */
  accountId: string
  /** Present only when period === 'custom' (the drawer's custom range). */
  from?: string
  to?: string
}

/** Pure core of the mapping — shared by the reactive preview and the
 *  click-time read so they can never disagree. */
function scopeFromStores(
  dateRange: string,
  selectedAccountId: string,
  customStartDate?: string,
  customEndDate?: string
): AppSuiteScope {
  if (customStartDate || customEndDate) {
    return { period: 'custom', accountId: selectedAccountId, from: customStartDate, to: customEndDate }
  }
  const map: Record<string, SuitePeriod> = {
    '7': '7d',
    '30': '30d',
    '90': '90d',
    '180': '180d',
    '365': '365d',
    all: 'all',
  }
  return { period: map[dateRange] ?? 'all', accountId: selectedAccountId }
}

/** Map the global action bar's scope (account + date range, incl. custom
 *  windows) onto the suite's period/lens vocabulary. Same precedence the
 *  app itself uses: an active custom window wins over the preset range. */
export function appScopeToSuite(): AppSuiteScope {
  const { selectedAccountId, dateRange } = useAppStore.getState()
  const f = useFilterStore.getState()
  return scopeFromStores(dateRange, selectedAccountId, f.customStartDate, f.customEndDate)
}

/** One-line description of what the bridge would apply (tooltip honesty). */
export function describeScope(s: AppSuiteScope, accountName?: (id: string) => string | undefined): string {
  const bits: string[] = []
  if (s.period === 'custom' && s.from && s.to) {
    bits.push(`${s.from.slice(0, 10)} → ${s.to.slice(0, 10)}`)
  } else {
    bits.push(s.period.toUpperCase())
  }
  bits.push(s.accountId === 'all' || !s.accountId ? 'All accounts' : accountName?.(s.accountId) ?? 'current account')
  return bits.join(' · ')
}

/** The bridge button — seeds the suite lens from the app's current scope on
 *  CLICK. The preview SUBSCRIBES to both stores so the tooltip always tells
 *  the truth about what clicking will do (a stale preview is a lie). */
export function UseAppScopeButton({
  onScope,
  accountName,
  disabled,
}: {
  onScope: (s: AppSuiteScope) => void
  accountName?: (id: string) => string | undefined
  disabled?: boolean
}) {
  const dateRange = useAppStore((s) => s.dateRange)
  const selectedAccountId = useAppStore((s) => s.selectedAccountId)
  const customStartDate = useFilterStore((s) => s.customStartDate)
  const customEndDate = useFilterStore((s) => s.customEndDate)
  const scope = scopeFromStores(dateRange, selectedAccountId, customStartDate, customEndDate)
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onScope(appScopeToSuite())}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[10px] font-semibold transition-colors disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
      style={{ background: 'rgba(34,211,238,0.10)', color: '#22d3ee', border: '1px solid rgba(34,211,238,0.25)' }}
      title={`Seed the AI lens from the app's current scope: ${describeScope(scope, accountName)}`}
      aria-label={`Use app scope: ${describeScope(scope, accountName)}`}
    >
      <Crosshair size={11} aria-hidden="true" />
      Use app scope
    </button>
  )
}

// ---- stat chip ------------------------------------------------------------------

export function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div
      className="rounded-lg px-3 py-2 flex flex-col gap-0.5 min-w-[86px] transition-transform duration-150 hover:scale-[1.03]"
      style={{ background: 'var(--bg-inset)', border: '1px solid var(--shell-border)' }}
    >
      <span className="text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </span>
      <span className="text-[13px] font-bold font-mono" style={{ color: color ?? 'var(--text-primary)' }}>
        {value}
      </span>
    </div>
  )
}

// ---- degraded / offline analysis badge ---------------------------------------------

export function DegradedBadge({ degraded, rateLimited }: { degraded?: boolean; rateLimited?: boolean }) {
  if (!degraded) return null
  // Task 14-b — distinguish "model unreachable" from "provider rate-limited":
  // the latter is transient and a retry usually succeeds.
  if (rateLimited) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold"
        style={{ background: 'rgba(244,63,94,0.12)', color: '#fb7185' }}
        title="The AI service was rate-limited — this analysis came from the deterministic engine built on the same real data. Try generating again in a moment."
      >
        <Sparkles size={9} /> rate-limited — offline analysis
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold"
      style={{ background: 'rgba(245,158,11,0.12)', color: '#fbbf24' }}
      title="The model was unreachable — this analysis was produced by the deterministic on-device engine from the same real data."
    >
      <Sparkles size={9} /> offline analysis
    </span>
  )
}

// ---- markdown-ish renderer (bold, bullets, headings — same rules as the hub) ----

export function Markdownish({ text }: { text: string }) {
  const blocks = useMemo(() => text.split('\n'), [text])
  const renderBold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((part, pi) =>
      part.startsWith('**') && part.endsWith('**') ? (
        <strong key={pi} style={{ color: 'var(--text-primary)' }}>
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={pi}>{part}</span>
      ),
    )
  return (
    <div className="space-y-1.5">
      {blocks.map((line, i) => {
        if (line.startsWith('### ')) {
          return (
            <p key={i} className="text-xs font-bold mt-2" style={{ color: 'var(--text-primary)' }}>
              {line.slice(4)}
            </p>
          )
        }
        if (line.startsWith('- ') || line.startsWith('• ')) {
          return (
            <p key={i} className="text-xs leading-relaxed flex gap-1.5" style={{ color: 'var(--text-primary)' }}>
              <span style={{ color: 'var(--text-secondary)' }}>•</span>
              <span>{renderBold(line.slice(2))}</span>
            </p>
          )
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return (
          <p key={i} className="text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
            {renderBold(line)}
          </p>
        )
      })}
    </div>
  )
}

// ---- grade ring -------------------------------------------------------------------

export function GradeRing({ grade, tone }: { grade: string; tone: SuiteTone }) {
  const c = TONE[tone].color
  return (
    <div
      className="relative grid place-items-center rounded-full shrink-0 transition-transform duration-300 hover:scale-105"
      style={{
        width: 74,
        height: 74,
        background: `conic-gradient(${c} 0deg, ${c} 270deg, var(--bg-inset) 270deg, var(--bg-inset) 360deg)`,
      }}
      role="img"
      aria-label={`Review grade ${grade}`}
    >
      <div
        className="grid place-items-center rounded-full"
        style={{ width: 62, height: 62, background: 'var(--bg-card)', border: `1px solid ${c}44` }}
      >
        <span className="text-2xl font-black tracking-tight" style={{ color: c }}>
          {grade}
        </span>
      </div>
    </div>
  )
}

// ---- loading shimmer -------------------------------------------------------------

// ---- localStorage helpers ---------------------------------------------------------

export function loadJson<T>(key: string, validate: (v: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    return validate(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode — in-memory only */
  }
}
