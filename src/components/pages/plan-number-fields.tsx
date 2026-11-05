'use client'

/**
 * ============================================================================
 * TP2 — THE FEW NUMBER FIELDS (blueprint §3)
 * ============================================================================
 * Five questions hold numbers the journal compares with real trades, so they
 * change from one text box to structured fields IN THE SAME PLACE on the same
 * tab. Every other question stays exactly as it is.
 *
 *   5.3.2  daily / weekly / monthly loss limits — three money-or-percent fields
 *   4.8.2  max trades per day + open positions — two whole numbers
 *   5.3.4  max total open risk + open positions — money-or-percent + whole number
 *   4.3.5  sessions — rows of start, end, timezone, days
 *   5.3.3  drawdown tiers — rows of name, level, response
 *   3.2.x  the goal ladder — rows of period, metric, floor, target, stretch
 *
 * Rules (blueprint §3):
 *  · an EMPTY field means NO LIMIT — never 0 (nothing is stored for empties)
 *  · existing text answers are kept as a note under the new fields
 *  · the values are stored in the version content JSON keyed by question
 *    number with plain typed values
 */
import { useMemo } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// ---------- wire shapes ----------

export interface MoneyValue { value: number; unit: 'amount' | 'percent' }
export interface LimitsValue {
  daily: MoneyValue | null
  weekly: MoneyValue | null
  monthly: MoneyValue | null
}
export interface CountsValue { tradesPerDay: number | null; openPositions: number | null }
export interface OpenCapValue { openRisk: MoneyValue | null; openPositions: number | null }
export interface SessionRow { start: string; end: string; timezone: string; days: string }
export interface SessionsValue { rows: SessionRow[] }
export interface TierRow { name: string; level: MoneyValue | null; response: string }
export interface TiersValue { rows: TierRow[] }
export interface LadderRow {
  period: 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annual'
  metric: string
  kind: 'outcome' | 'performance' | 'process' | 'development'
  floor: number | null
  target: number
  stretch: number | null
}
export interface LadderValue { rows: LadderRow[] }

export const GOAL_METRICS: { value: string; label: string; unit: string }[] = [
  { value: 'pnl', label: 'Net P&L', unit: '$' },
  { value: 'winRate', label: 'Win rate', unit: '%' },
  { value: 'profitFactor', label: 'Profit factor', unit: '×' },
  { value: 'trades', label: 'Trades', unit: '' },
  { value: 'rMultiple', label: 'Avg R', unit: 'R' },
  { value: 'adherence_rate', label: 'Adherence rate', unit: '%' },
  { value: 'routine_completion', label: 'Routine completion', unit: '%' },
  { value: 'rule_breaks_max', label: 'Rule breaks (max)', unit: '' },
]
export const GOAL_KINDS = ['outcome', 'performance', 'process', 'development'] as const
// ---------- shared bits ----------

const inputCls =
  'h-8 rounded-md border border-border bg-transparent px-2 text-xs tnum focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-400/60'
const unitBtn = (active: boolean) =>
  cn(
    'h-8 px-2 text-[10px] font-semibold border-l-0 rounded-r-md cursor-pointer transition-colors',
    active ? 'bg-teal-500/15 text-teal-300' : 'text-muted-foreground hover:text-foreground',
  )

function UnitToggle({ unit, onUnit }: { unit: 'amount' | 'percent'; onUnit: (u: 'amount' | 'percent') => void }) {
  return (
    <div className="flex rounded-md border border-border overflow-hidden">
      <button type="button" className={unitBtn(unit === 'amount')} onClick={() => onUnit('amount')} title="Currency amount">
        $
      </button>
      <button type="button" className={cn(unitBtn(unit === 'percent'), 'border-l border-border')} onClick={() => onUnit('percent')} title="Percent of equity">
        %
      </button>
    </div>
  )
}

/** The legacy note: the old text answer stays visible under the new fields. */
export function LegacyNote({ value }: { value: unknown }) {
  if (typeof value !== 'string' || !value.trim()) return null
  return (
    <p className="mt-2 rounded-md border border-dashed border-border bg-white/[0.02] px-2.5 py-1.5 text-[10px] leading-relaxed text-muted-foreground whitespace-pre-wrap">
      <span className="font-semibold">Previous text answer (kept):</span> {value.trim()}
    </p>
  )
}

// ---------- 5.3.2 loss limits ----------

export function LimitsField({ value, onChange }: { value: unknown; onChange: (v: LimitsValue) => void }) {
  const v = normalize<LimitsValue>(value, { daily: null, weekly: null, monthly: null })
  const row = (key: 'daily' | 'weekly' | 'monthly', label: string) => (
    <div key={key} className="flex items-center gap-2">
      <span className="w-14 text-[10px] font-semibold text-muted-foreground">{label}</span>
      <div className="flex">
        <input
          type="number"
          step="any"
          min="0"
          placeholder="no limit"
          value={v[key]?.value ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            const num = raw === '' ? null : Number(raw)
            onChange({ ...v, [key]: num == null || !Number.isFinite(num) ? null : { value: num, unit: v[key]?.unit ?? 'amount' } })
          }}
          className={cn(inputCls, 'w-28')}
          aria-label={`${label} loss limit`}
        />
        <UnitToggle
          unit={v[key]?.unit ?? 'amount'}
          onUnit={(u) => onChange({ ...v, [key]: v[key] ? { ...v[key]!, unit: u } : null })}
        />
      </div>
    </div>
  )
  return (
    <div className="space-y-1.5">
      {row('daily', 'Daily')}
      {row('weekly', 'Weekly')}
      {row('monthly', 'Monthly')}
      <p className="text-[10px] text-muted-foreground/80">Leave empty for no limit — an empty limit is never read as 0.</p>
    </div>
  )
}

// ---------- 4.8.2 trades per day + open positions ----------

export function CountsField({ value, onChange }: { value: unknown; onChange: (v: CountsValue) => void }) {
  const v = normalize<CountsValue>(value, { tradesPerDay: null, openPositions: null })
  return (
    <div className="flex flex-wrap gap-4">
      {(['tradesPerDay', 'openPositions'] as const).map((k) => (
        <label key={k} className="flex items-center gap-2">
          <span className="text-[10px] font-semibold text-muted-foreground">
            {k === 'tradesPerDay' ? 'Max trades per day' : 'Max open positions'}
          </span>
          <input
            type="number"
            step="1"
            min="0"
            placeholder="no limit"
            value={v[k] ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              const num = raw === '' ? null : Math.round(Number(raw))
              onChange({ ...v, [k]: num != null && Number.isFinite(num) && num >= 0 ? num : null })
            }}
            className={cn(inputCls, 'w-24')}
            aria-label={k === 'tradesPerDay' ? 'Maximum trades per day' : 'Maximum open positions'}
          />
        </label>
      ))}
    </div>
  )
}

// ---------- 5.3.4 open risk cap + positions ----------

export function OpenCapField({ value, onChange }: { value: unknown; onChange: (v: OpenCapValue) => void }) {
  const v = normalize<OpenCapValue>(value, { openRisk: null, openPositions: null })
  return (
    <div className="flex flex-wrap gap-4">
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground">Max total open risk</span>
        <div className="flex">
          <input
            type="number"
            step="any"
            min="0"
            placeholder="no limit"
            value={v.openRisk?.value ?? ''}
            onChange={(e) => {
              const raw = e.target.value
              const num = raw === '' ? null : Number(raw)
              onChange({ ...v, openRisk: num == null || !Number.isFinite(num) ? null : { value: num, unit: v.openRisk?.unit ?? 'percent' } })
            }}
            className={cn(inputCls, 'w-24')}
            aria-label="Maximum total open risk"
          />
          <UnitToggle unit={v.openRisk?.unit ?? 'percent'} onUnit={(u) => onChange({ ...v, openRisk: v.openRisk ? { ...v.openRisk, unit: u } : null })} />
        </div>
      </div>
      <label className="flex items-center gap-2">
        <span className="text-[10px] font-semibold text-muted-foreground">Max open positions</span>
        <input
          type="number"
          step="1"
          min="0"
          placeholder="no limit"
          value={v.openPositions ?? ''}
          onChange={(e) => {
            const raw = e.target.value
            const num = raw === '' ? null : Math.round(Number(raw))
            onChange({ ...v, openPositions: num != null && Number.isFinite(num) && num >= 0 ? num : null })
          }}
          className={cn(inputCls, 'w-24')}
          aria-label="Maximum open positions across systems"
        />
      </label>
    </div>
  )
}

// ---------- 4.3.5 sessions ----------

const DAY_ABBR = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function SessionsField({ value, onChange }: { value: unknown; onChange: (v: SessionsValue) => void }) {
  const v = normalize<SessionsValue>(value, { rows: [] })
  const setRow = (i: number, patch: Partial<SessionRow>) =>
    onChange({ rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  return (
    <div className="space-y-2">
      {v.rows.length === 0 && (
        <p className="text-[10px] text-muted-foreground/80">No sessions defined — the system runs any time.</p>
      )}
      {v.rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input type="time" value={r.start} onChange={(e) => setRow(i, { start: e.target.value })} className={cn(inputCls, 'w-[104px]')} aria-label="Session start" />
          <span className="text-[10px] text-muted-foreground">→</span>
          <input type="time" value={r.end} onChange={(e) => setRow(i, { end: e.target.value })} className={cn(inputCls, 'w-[104px]')} aria-label="Session end" />
          <input
            value={r.timezone}
            onChange={(e) => setRow(i, { timezone: e.target.value })}
            placeholder="tz (user's by default)"
            className={cn(inputCls, 'w-36 !tnum-[0]')}
            aria-label="Session timezone"
          />
          <div className="flex gap-0.5">
            {DAY_ABBR.map((d) => {
              const on = r.days.split(',').map((x) => x.trim()).includes(d)
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() =>
                    setRow(i, {
                      days: (on ? r.days.split(',').map((x) => x.trim()).filter((x) => x !== d) : [...r.days.split(',').map((x) => x.trim()).filter(Boolean), d]).join(','),
                    })
                  }
                  className={cn(
                    'h-7 w-7 rounded-md border text-[9px] font-bold cursor-pointer transition-colors',
                    on ? 'border-teal-500/50 bg-teal-500/15 text-teal-300' : 'border-border text-muted-foreground hover:border-white/20',
                  )}
                  aria-pressed={on}
                  title={on ? `${d} — click to remove` : `${d} — click to add`}
                >
                  {d[0]}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            onClick={() => onChange({ rows: v.rows.filter((_, j) => j !== i) })}
            className="ml-1 text-muted-foreground hover:text-red-400 cursor-pointer"
            aria-label="Remove this session row"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ rows: [...v.rows, { start: '09:30', end: '16:00', timezone: '', days: 'Mon,Tue,Wed,Thu,Fri' }] })}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-300 hover:text-teal-200 cursor-pointer"
        data-testid="tp-sessions-add"
      >
        <Plus className="h-3 w-3" /> Add row
      </button>
    </div>
  )
}

// ---------- 5.3.3 drawdown tiers ----------

export function TiersField({ value, onChange }: { value: unknown; onChange: (v: TiersValue) => void }) {
  const v = normalize<TiersValue>(value, { rows: [] })
  const setRow = (i: number, patch: Partial<TierRow>) =>
    onChange({ rows: v.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) })
  const addTier = (name: string) =>
    onChange({ rows: [...v.rows, { name, level: null, response: '' }] })
  return (
    <div className="space-y-2">
      {v.rows.length === 0 && (
        <div className="flex flex-wrap gap-1.5">
          <span className="text-[10px] text-muted-foreground/80 self-center">Add a suggested tier:</span>
          {['warning', 'reduce size', 'stop and review', 'hard stop'].map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => addTier(t)}
              className="rounded-md border border-border px-2 py-1 text-[10px] font-semibold text-muted-foreground hover:text-foreground hover:border-white/20 cursor-pointer"
            >
              + {t}
            </button>
          ))}
        </div>
      )}
      {v.rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <input
            value={r.name}
            onChange={(e) => setRow(i, { name: e.target.value })}
            placeholder="tier name"
            className={cn(inputCls, 'w-32')}
            aria-label="Tier name"
          />
          <div className="flex">
            <input
              type="number"
              step="any"
              placeholder="no level"
              value={r.level?.value ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                const num = raw === '' ? null : Number(raw)
                setRow(i, { level: num == null || !Number.isFinite(num) ? null : { value: num, unit: r.level?.unit ?? 'percent' } })
              }}
              className={cn(inputCls, 'w-20')}
              aria-label="Tier level"
            />
            <UnitToggle unit={r.level?.unit ?? 'percent'} onUnit={(u) => setRow(i, { level: r.level ? { ...r.level, unit: u } : null })} />
          </div>
          <input
            value={r.response}
            onChange={(e) => setRow(i, { response: e.target.value })}
            placeholder="response when this tier hits"
            className={cn(inputCls, 'flex-1 min-w-40')}
            aria-label="Tier response"
          />
          <button
            type="button"
            onClick={() => onChange({ rows: v.rows.filter((_, j) => j !== i) })}
            className="text-muted-foreground hover:text-red-400 cursor-pointer"
            aria-label="Remove this tier"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => addTier('')}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-300 hover:text-teal-200 cursor-pointer"
        data-testid="tp-tiers-add"
      >
        <Plus className="h-3 w-3" /> Add row
      </button>
    </div>
  )
}

// ---------- 3.2.x the goal ladder ----------

export function LadderField({
  period,
  value,
  onChange,
}: {
  period: LadderRow['period']
  value: unknown
  onChange: (v: LadderValue) => void
}) {
  const v = normalize<LadderValue>(value, { rows: [] })
  const rows = v.rows.filter((r) => r.period === period)
  const setRows = (next: LadderRow[]) => onChange({ rows: [...v.rows.filter((r) => r.period !== period), ...next] })
  const setRow = (i: number, patch: Partial<LadderRow>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const metricUnit = (m: string) => GOAL_METRICS.find((x) => x.value === m)?.unit ?? ''
  return (
    <div className="space-y-2">
      {rows.length === 0 && <p className="text-[10px] text-muted-foreground/80">No {period} goals yet — add a row.</p>}
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-1.5">
          <span className="w-16 text-[10px] font-bold text-muted-foreground uppercase">{period}</span>
          <select
            value={r.metric}
            onChange={(e) => setRow(i, { metric: e.target.value })}
            className={cn(inputCls, 'w-36')}
            aria-label="Goal metric"
          >
            {GOAL_METRICS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
          <select
            value={r.kind}
            onChange={(e) => setRow(i, { kind: e.target.value as LadderRow['kind'] })}
            className={cn(inputCls, 'w-28')}
            aria-label="Goal kind"
            title="outcome = money results · performance = ratios · process = behavior · development = learning"
          >
            {GOAL_KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
          {([['floor', 'floor'], ['target', 'target'], ['stretch', 'stretch']] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-1" title={k === 'floor' ? 'The minimum that keeps the business viable' : k === 'stretch' ? 'The ambitious level' : 'The target level'}>
              <span className="text-[9px] text-muted-foreground">{label}</span>
              <input
                type="number"
                step="any"
                placeholder="—"
                value={r[k] ?? ''}
                onChange={(e) => {
                  const raw = e.target.value
                  const num = raw === '' ? null : Number(raw)
                  setRow(i, { [k]: num != null && Number.isFinite(num) ? num : null } as Partial<LadderRow>)
                }}
                className={cn(inputCls, 'w-20')}
                aria-label={`${label} for ${r.metric}`}
              />
              <span className="text-[9px] text-muted-foreground/70 w-3">{metricUnit(r.metric)}</span>
            </label>
          ))}
          <button
            type="button"
            onClick={() => setRows(rows.filter((_, j) => j !== i))}
            className="text-muted-foreground hover:text-red-400 cursor-pointer"
            aria-label="Remove this goal row"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => setRows([...rows, { period, metric: 'pnl', kind: 'outcome', floor: null, target: 0, stretch: null }])}
        className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-300 hover:text-teal-200 cursor-pointer"
        data-testid={`tp-ladder-add-${period}`}
      >
        <Plus className="h-3 w-3" /> Add {period} goal
      </button>
    </div>
  )
}

// ---------- helpers ----------

function normalize<T>(value: unknown, fallback: T): T {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as T
  return fallback
}
