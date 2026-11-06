'use client'

/**
 * ============================================================================
 * AI SUMMARY — AI Suite tab (AI Trade Suite → AI Summary)
 * Canonical URL: /ai-suite?tab=trade-suite&sub=ai-summary (legacy /tools/ai-suite/ai-summary still opens it)
 * ============================================================================
 * Instant AI summary of any period + optional symbol / account lens.
 * Period chips + symbol datalist (built from real trades) + account select,
 * headline verdict card with tone accent, bullet insights and stat chips.
 * The last summary per (period, symbol, account) persists in localStorage.
 */

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, FileText, Filter, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SuitePeriod } from '@/lib/ai-suite'
// SWEEP4 — the summary chips drill to the trades behind the numbers (the
// lens — period/symbol/account — maps onto the standard filter patch).
import { drillToTrades, suitePeriodPatch } from '@/lib/drill'
import {
  DegradedBadge,
  PeriodChips,
  StatChip,
  TONE,
  UseAppScopeButton,
  loadJson,
  postSuite,
  saveJson,
  type SuiteTone,
} from '@/components/ai/suite-ui'

// ---- types -----------------------------------------------------------------------

interface SummaryPayload {
  /** Task 14-b — server marks rate-limited degraded payloads. */
  rateLimited?: boolean
  kind: 'summary'
  headline: string
  tone: SuiteTone
  chips: { label: string; value: string }[]
  bullets: string[]
  generatedAt: string
  degraded?: boolean
}

const STORE_KEY = 'ai-suite.summaries.v1'
const STORE_CAP = 12

interface Store {
  latest: Record<string, SummaryPayload>
  order: string[]
}

const EMPTY_STORE: Store = { latest: {}, order: [] }

function validateStore(v: unknown): Store | null {
  if (!v || typeof v !== 'object') return null
  const s = v as Store
  if (!s.latest || !Array.isArray(s.order)) return null
  return { latest: s.latest, order: s.order.slice(-STORE_CAP) }
}

function loadStore(): Store {
  return loadJson<Store>(STORE_KEY, validateStore) ?? EMPTY_STORE
}

function ck(period: SuitePeriod, symbol: string, account: string, custom?: { from: string; to: string } | null): string {
  return `${period}${custom ? `|${custom.from}|${custom.to}` : ''}|${symbol}|${account}`
}

// Task 16-a — a compact 'Oct 1 – Oct 21' label for the custom-window chip.
function customLabel(c: { from: string; to: string }): string {
  const f = new Date(c.from)
  const t = new Date(c.to)
  if (isNaN(f.getTime()) || isNaN(t.getTime())) return 'Custom'
  const sameYear = f.getFullYear() === t.getFullYear()
  const fs = f.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
  const ts = t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return `${fs} – ${ts}`
}

// ---- component ---------------------------------------------------------------------

export function AiSummaryPage() {
  const [period, setPeriod] = useState<SuitePeriod>('all')
  const [symbol, setSymbol] = useState('')
  const [account, setAccount] = useState('')
  // Task 16-a — custom window from the global action bar (bridge).
  const [custom, setCustom] = useState<{ from: string; to: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [store, setStore] = useState<Store>(loadStore)

  function pickPeriod(p: SuitePeriod) {
    // Any preset chip replaces a bridged custom window.
    setPeriod(p)
    setCustom(null)
  }

  function applyAppScope(s: { period: SuitePeriod; accountId: string; from?: string; to?: string }) {
    setPeriod(s.period)
    setAccount(s.accountId === 'all' ? '' : s.accountId)
    setCustom(s.period === 'custom' && s.from && s.to ? { from: s.from, to: s.to } : null)
  }

  // real symbol list from closed trades (same lightweight call the treemap uses)
  const { data: tradesData } = useQuery({
    queryKey: ['ai-suite-symbols'],
    queryFn: async () => {
      const res = await fetch('/api/trades?status=closed&limit=5000')
      const j = await res.json()
      return j
    },
    staleTime: 60_000,
  })

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      return res.json()
    },
    staleTime: 60_000,
  })

  const symbols = useMemo(() => {
    const rows = (tradesData?.trades ?? []) as { symbol?: string }[]
    const set = new Set<string>()
    for (const r of rows) if (r.symbol) set.add(String(r.symbol).toUpperCase())
    return [...set].sort()
  }, [tradesData])

  const accounts = useMemo(() => {
    const rows = (accountsData?.accounts ?? []) as { id: string; name: string }[]
    return rows
  }, [accountsData])

  const key = ck(period, symbol, account, custom)
  const current = store.latest[key] ?? null
  const tone = current ? TONE[current.tone] : TONE.neutral

  async function generate() {
    if (busy) return
    setBusy(true)
    setError(null)
    const { ok, data } = await postSuite({
      kind: 'summary',
      period,
      symbol: symbol.trim() || null,
      accountId: account || null,
      ...(custom ? { from: custom.from, to: custom.to } : {}),
    })
    setBusy(false)
    if (!ok || data.error || data.kind !== 'summary') {
      setError((data.error as string) ?? 'The summary could not be generated.')
      return
    }
    const payload = data as unknown as SummaryPayload
    setStore((prev) => {
      const next: Store = {
        latest: { ...prev.latest, [key]: payload },
        order: [...prev.order.filter((k2) => k2 !== key), key].slice(-STORE_CAP),
      }
      // prune evicted payloads so localStorage stays small
      for (const k2 of Object.keys(next.latest)) if (!next.order.includes(k2)) delete next.latest[k2]
      saveJson(STORE_KEY, next)
      return next
    })
  }

  return (
    <div className="space-y-4">
      {/* ---- controls ---- */}
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--shell-border)' }}>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="grid place-items-center w-8 h-8 rounded-lg" style={{ background: 'rgba(34,211,238,0.12)' }}>
            <FileText size={16} style={{ color: '#22d3ee' }} />
          </div>
          <div className="flex-1 min-w-[180px]">
            <h2 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
              Instant summaries
            </h2>
            <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
              Any period, any lens — generated from your real closed trades
            </p>
          </div>
          <Button
            onClick={generate}
            disabled={busy}
            className="h-8 px-3 text-[11px] font-semibold gap-1.5"
            style={{ background: 'var(--shell-accent)', color: '#fff' }}
          >
            {busy ? <RefreshCw size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {current ? 'Regenerate' : 'Summarize'}
          </Button>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <PeriodChips value={period} onChange={pickPeriod} disabled={busy} customLabel={custom ? customLabel(custom) : undefined} />
          {/* Task 16-a — seed the lens from whatever the app is currently
              scoped to (action-bar account + date range, incl. custom). */}
          <UseAppScopeButton
            onScope={applyAppScope}
            disabled={busy}
            accountName={(id) => accounts.find((a) => a.id === id)?.name}
          />
          <div className="flex items-center gap-1.5">
            <Filter size={11} style={{ color: 'var(--text-secondary)' }} aria-hidden="true" />
            <input
              list="ai-suite-symbols"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="Symbol (any)"
              disabled={busy}
              aria-label="Filter summary by symbol"
              className="rounded-lg px-2.5 py-1.5 text-[11px] w-32 outline-none focus:ring-1 font-mono uppercase disabled:opacity-50"
              style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
            />
            <datalist id="ai-suite-symbols">
              {symbols.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value)}
            disabled={busy}
            aria-label="Filter summary by account"
            className="rounded-lg px-2.5 py-1.5 text-[11px] outline-none focus:ring-1 disabled:opacity-50 cursor-pointer"
            style={{ background: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)' }}
          >
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {(symbol || account) && (
            <button
              onClick={() => {
                setSymbol('')
                setAccount('')
              }}
              className="text-[10px] font-semibold underline underline-offset-2 cursor-pointer"
              style={{ color: 'var(--shell-accent-hover)' }}
            >
              clear lens
            </button>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-xl px-4 py-3 text-xs font-medium flex items-center gap-2"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}
          role="alert"
        >
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* ---- empty state ---- */}
      {!current && !busy && !error && (
        <div
          className="rounded-xl p-10 flex flex-col items-center gap-3 text-center"
          style={{ background: 'var(--bg-card)', border: '1px dashed var(--border-strong)' }}
        >
          <div className="grid place-items-center w-12 h-12 rounded-full" style={{ background: 'rgba(34,211,238,0.12)' }}>
            <FileText size={20} style={{ color: '#22d3ee' }} />
          </div>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Summarize any slice of the journal
          </p>
          <p className="text-xs max-w-md" style={{ color: 'var(--text-secondary)' }}>
            Pick a period and optionally narrow to one symbol or account. The summary covers performance, best
            symbols/setups, risk flags and a comparison against the prior window.
          </p>
        </div>
      )}

      {busy && !current && <div className="rounded-xl shimmer h-56" />}

      {/* ---- summary card ---- */}
      {current && (
        <div className="space-y-4" style={{ opacity: busy ? 0.6 : 1, transition: 'opacity 200ms' }}>
          <div className="rounded-xl p-5 relative overflow-hidden" style={{ background: 'var(--bg-card)', border: `1px solid ${tone.color}33` }}>
            <div className="absolute inset-x-0 top-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${tone.color}, transparent)` }} />
            <div className="flex items-center gap-2.5 flex-wrap mb-1">
              <span
                className="rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                style={{ background: tone.soft, color: tone.color }}
              >
                {tone.label}
              </span>
              <DegradedBadge degraded={current.degraded} rateLimited={Boolean(current.rateLimited)} />
              <span className="text-[10px] ml-auto" style={{ color: 'var(--text-secondary)' }}>
                {new Date(current.generatedAt).toLocaleString()}
              </span>
            </div>
            <h3 className="text-base font-bold leading-snug mb-3" style={{ color: 'var(--text-primary)' }}>
              {current.headline}
            </h3>
            <div className="flex gap-2 flex-wrap mb-4">
              {current.chips.map((c) => (
                <StatChip
                  key={c.label}
                  label={c.label}
                  value={c.value}
                  color={c.label === 'Net' ? (c.value.startsWith('+') ? '#22c55e' : c.value.startsWith('-') ? '#ef4444' : undefined) : undefined}
                  onClick={() =>
                    drillToTrades({
                      ...suitePeriodPatch(period, custom),
                      ...(symbol ? { symbol } : {}),
                      ...(account ? { accountId: account } : {}),
                    })
                  }
                  title="See the trades behind this summary"
                />
              ))}
            </div>
            <ul className="space-y-2">
              {current.bullets.map((b, i) => (
                <li key={i} className="flex gap-2.5 text-xs leading-relaxed" style={{ color: 'var(--text-primary)' }}>
                  <span
                    className="grid place-items-center h-4.5 w-4.5 rounded-full shrink-0 mt-0.5 text-[9px] font-bold"
                    style={{ width: 18, height: 18, background: tone.soft, color: tone.color }}
                  >
                    {i + 1}
                  </span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
          <p className="text-[10px] px-1" style={{ color: 'var(--text-secondary)' }}>
            Lens: {period === 'custom' && custom ? customLabel(custom) : period.toUpperCase()}
            {symbol ? ` · ${symbol}` : ''} · {account ? accounts.find((a) => a.id === account)?.name ?? 'account' : 'all accounts'} ·
            summaries are cached locally and refreshed on regenerate
          </p>
        </div>
      )}
    </div>
  )
}
