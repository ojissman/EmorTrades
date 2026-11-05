'use client'

import { Fragment, useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { formatCurrencyIn, pnlColor } from '@/lib/format'
import { cn } from '@/lib/utils'
import { drillToTrades } from '@/lib/drill'

type HeatmapType = 'dayHour' | 'dayOfWeek' | 'hourOfDay' | 'dayOfMonth'

export function HeatmapsPage() {
  const { selectedAccountId } = useAppStore()
  const [type, setType] = useState<HeatmapType>('dayHour')
  const [metric, setMetric] = useState<'pnl' | 'trades' | 'winRate'>('pnl')

  const { data, isLoading } = useQuery({
    queryKey: ['trades-heatmap', selectedAccountId],
    queryFn: async () => {
      const params = new URLSearchParams({
        accountId: selectedAccountId,
        limit: '5000',
        status: 'closed',
      })
      const res = await fetch(`/api/trades?${params}`)
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const heatmapData = useMemo(() => {
    if (!data) return { cells: [], cellsBySlot: new Map<string, any>(), maxAbs: 1, summary: [] }
    const trades = data.trades || []
    const cells: any[] = []
    const cellsBySlot = new Map<string, any>()
    let maxAbs = 1

    // Task 6 — one pass, not one pass per cell: bucket every closed trade by
    // its ENTRY weekday+hour (UTC — the app-wide trade-day convention), then
    // emit the grid cells from the buckets. Same numbers as before, O(n)
    // instead of O(cells × trades).
    const buckets = new Map<string, { pnl: number; trades: number; wins: number }>()
    for (const t of trades) {
      if (!t.entryTime) continue
      const d = new Date(t.entryTime)
      const slot = `${d.getUTCDay()}-${d.getUTCHours()}`
      const b = buckets.get(slot) || { pnl: 0, trades: 0, wins: 0 }
      b.pnl += t.pnl
      b.trades += 1
      if (t.pnl > 0) b.wins += 1
      buckets.set(slot, b)
    }

    const empty = { pnl: 0, trades: 0, wins: 0 }
    const aggExtra = (b: { pnl: number; trades: number; wins: number }) => ({
      pnl: b.pnl,
      trades: b.trades,
      wins: b.wins,
      losses: b.trades - b.wins,
      winRate: b.trades > 0 ? (b.wins / b.trades) * 100 : 0,
    })
    const push = (cell: any) => {
      cells.push(cell)
      if (cell.hour !== undefined) cellsBySlot.set(`${cell.day ?? cell.hour}-${cell.hour}`, cell)
      if (Math.abs(cell.pnl) > maxAbs) maxAbs = Math.abs(cell.pnl)
    }

    if (type === 'dayHour') {
      for (let d = 0; d < 7; d++)
        for (let h = 0; h < 24; h++) push({ day: d, hour: h, ...aggExtra(buckets.get(`${d}-${h}`) ?? empty) })
    } else if (type === 'dayOfWeek') {
      // Aggregate each weekday ACROSS all hours.
      for (let d = 0; d < 7; d++) {
        const b = { pnl: 0, trades: 0, wins: 0 }
        for (let h = 0; h < 24; h++) {
          const x = buckets.get(`${d}-${h}`)
          if (x) {
            b.pnl += x.pnl
            b.trades += x.trades
            b.wins += x.wins
          }
        }
        push({ day: d, ...aggExtra(b) })
      }
    } else if (type === 'hourOfDay') {
      // Aggregate each hour ACROSS all weekdays.
      for (let h = 0; h < 24; h++) {
        const b = { pnl: 0, trades: 0, wins: 0 }
        for (let d = 0; d < 7; d++) {
          const x = buckets.get(`${d}-${h}`)
          if (x) {
            b.pnl += x.pnl
            b.trades += x.trades
            b.wins += x.wins
          }
        }
        push({ hour: h, ...aggExtra(b) })
      }
    } else if (type === 'dayOfMonth') {
      // Day-of-month buckets need the UTC day-of-month; reuse the same
      // one-pass shape with a different key space.
      const dmBuckets = new Map<number, { pnl: number; trades: number; wins: number }>()
      for (const t of trades) {
        if (!t.entryTime) continue
        const dom = new Date(t.entryTime).getUTCDate()
        const b = dmBuckets.get(dom) || { pnl: 0, trades: 0, wins: 0 }
        b.pnl += t.pnl
        b.trades += 1
        if (t.pnl > 0) b.wins += 1
        dmBuckets.set(dom, b)
      }
      for (let d = 1; d <= 31; d++) {
        push({ day: d, ...aggExtra(dmBuckets.get(d) ?? empty) })
      }
    }

    return { cells, cellsBySlot, maxAbs, summary: [] }
  }, [data, type])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-16" />
        <Skeleton className="h-96" />
      </div>
    )
  }

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  return (
    <div className="space-y-4">
      {/* Controls */}
      <Card className="p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/40">
            {([
              { v: 'dayHour', label: 'Day × Hour' },
              { v: 'dayOfWeek', label: 'Day of Week' },
              { v: 'hourOfDay', label: 'Hour of Day' },
              { v: 'dayOfMonth', label: 'Day of Month' },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setType(opt.v)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-colors',
                  type === opt.v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 rounded-md border border-border bg-muted/40">
            {([
              { v: 'pnl', label: 'P&L' },
              { v: 'trades', label: 'Trade Count' },
              { v: 'winRate', label: 'Win Rate' },
            ] as const).map((opt) => (
              <button
                key={opt.v}
                onClick={() => setMetric(opt.v)}
                className={cn(
                  'px-3 py-1 text-xs font-medium rounded transition-colors',
                  metric === opt.v
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </Card>

      {/* Heatmap */}
      {type === 'dayHour' && (
        <Card className="p-4 md:p-5 overflow-x-auto">
          <h3 className="font-semibold tracking-tight mb-1">Day × Hour Heatmap</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Hover for details · click a cell to open the trades table filtered to that weekday + hour. Color intensity reflects {metric}.
          </p>
          <div className="min-w-[800px]">
            <div className="grid grid-cols-[60px_repeat(24,1fr)] gap-1">
              <div></div>
              {Array.from({ length: 24 }).map((_, h) => (
                <div key={h} className="text-center text-[10px] text-muted-foreground py-1">
                  {h}
                </div>
              ))}
              {dayNames.map((dayName, d) => (
                <Fragment key={`row-${dayName}`}>
                  <div className="text-xs text-muted-foreground flex items-center justify-end pr-2">
                    {dayName}
                  </div>
                  {Array.from({ length: 24 }).map((_, h) => {
                    const cell = heatmapData.cellsBySlot.get(`${d}-${h}`)
                    return (
                      <HeatmapCell
                        key={`${d}-${h}`}
                        cell={cell}
                        metric={metric}
                        maxAbs={heatmapData.maxAbs}
                        label={`${dayName} ${h}:00`}
                        onClick={cell && cell.trades > 0 ? () => drillToTrades({ dayOfWeek: d, hourOfDay: h }) : undefined}
                      />
                    )
                  })}
                </Fragment>
              ))}
            </div>
          </div>
        </Card>
      )}

      {type === 'dayOfWeek' && (
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Day of Week</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Identify your most and least profitable days · click a card to open its trades.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {heatmapData.cells.map((cell) => (
              <DayCard
                key={cell.day}
                cell={cell}
                dayName={dayNames[cell.day]}
                metric={metric}
                maxAbs={heatmapData.maxAbs}
                onClick={cell.trades > 0 ? () => drillToTrades({ dayOfWeek: cell.day }) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      {type === 'hourOfDay' && (
        <Card className="p-4 md:p-5 overflow-x-auto">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Hour of Day</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Find your most productive trading hours · click a cell to open its trades.
          </p>
          <div className="min-w-[800px]">
            <div className="grid grid-cols-12 gap-1">
              {heatmapData.cells.map((cell) => (
                <HeatmapCell
                  key={cell.hour}
                  cell={cell}
                  metric={metric}
                  maxAbs={heatmapData.maxAbs}
                  label={`${cell.hour}:00 - ${cell.hour}:59`}
                  showHour
                  onClick={cell.trades > 0 ? () => drillToTrades({ hourOfDay: cell.hour }) : undefined}
                />
              ))}
            </div>
          </div>
        </Card>
      )}

      {type === 'dayOfMonth' && (
        <Card className="p-4 md:p-5">
          <h3 className="font-semibold tracking-tight mb-1">Performance by Day of Month</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Spot monthly calendar patterns (1st vs mid-month vs end) · click a day to open its trades.
          </p>
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {heatmapData.cells.map((cell) => (
              <DayCard
                key={cell.day}
                cell={cell}
                dayName={`Day ${cell.day}`}
                metric={metric}
                maxAbs={heatmapData.maxAbs}
                compact
                // COHORTSWEEP — day-of-month cells drill via the new dayOfMonth
                // filter param (entry-UTC day-of-month, the same key the buckets
                // use); empty days stay inert like their siblings.
                onClick={cell.trades > 0 ? () => drillToTrades({ dayOfMonth: cell.day }) : undefined}
              />
            ))}
          </div>
        </Card>
      )}

      {/* Insights */}
      <InsightsCard cells={heatmapData.cells} type={type} />
    </div>
  )
}

function HeatmapCell({
  cell,
  metric,
  maxAbs,
  label,
  showHour = false,
  onClick,
}: {
  cell: any
  metric: 'pnl' | 'trades' | 'winRate'
  maxAbs: number
  label: string
  showHour?: boolean
  onClick?: () => void
}) {
  const hasData = cell && cell.trades > 0
  let bg = 'color-mix(in oklab, var(--foreground) 2%, transparent)'
  let value: string = ''

  if (hasData) {
    if (metric === 'pnl') {
      const intensity = Math.min(Math.abs(cell.pnl) / maxAbs, 1)
      bg = cell.pnl > 0
        ? `rgba(16, 185, 129, ${0.15 + intensity * 0.6})`
        : `rgba(239, 68, 68, ${0.15 + intensity * 0.6})`
      value = formatCurrencyIn('table', cell.pnl)
    } else if (metric === 'trades') {
      const intensity = Math.min(cell.trades / 20, 1)
      bg = `rgba(99, 102, 241, ${0.15 + intensity * 0.5})`
      value = `${cell.trades} trades`
    } else {
      const intensity = cell.winRate / 100
      bg = `rgba(16, 185, 129, ${0.1 + intensity * 0.5})`
      value = `${cell.winRate.toFixed(0)}%`
    }
  }

  return (
    <div
      // Task 6 — cells are genuinely clickable now (drill to the trades
      // table); COHORTSWEEP — every dimension has a filter counterpart since
      // dayOfMonth landed, so a cell only stays inert when its bucket is empty.
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      title={hasData ? `${label}\n${value}\n${cell.wins}W / ${cell.losses}L${onClick ? '\nClick to view trades' : ''}` : label}
      className={cn(
        'aspect-square rounded relative group border border-white/5 transition-transform',
        onClick && 'cursor-pointer hover:scale-105 hover:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400',
        !hasData && 'opacity-30'
      )}
      style={{ background: bg }}
    >
      {showHour && (
        <span className="absolute top-0.5 left-0.5 text-[8px] text-white/70 font-medium">
          {cell.hour}
        </span>
      )}
      {hasData && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={cn(
            'text-[9px] font-bold leading-tight text-center',
            metric === 'pnl' && cell.pnl > 0 && 'text-emerald-100',
            metric === 'pnl' && cell.pnl < 0 && 'text-red-100',
            metric === 'trades' && 'text-indigo-100',
            metric === 'winRate' && 'text-emerald-100'
          )}>
            {metric === 'pnl' && (cell.pnl > 0 ? '+' : '')}
            {metric === 'pnl' ? formatCurrencyIn('table', cell.pnl) : metric === 'trades' ? cell.trades : `${cell.winRate.toFixed(0)}%`}
          </span>
        </div>
      )}
    </div>
  )
}

function DayCard({
  cell,
  dayName,
  metric,
  maxAbs,
  compact = false,
  onClick,
}: {
  cell: any
  dayName: string
  metric: 'pnl' | 'trades' | 'winRate'
  maxAbs: number
  compact?: boolean
  onClick?: () => void
}) {
  const hasData = cell && cell.trades > 0
  let bg = 'bg-muted/20'
  if (hasData) {
    if (metric === 'pnl') {
      const intensity = Math.min(Math.abs(cell.pnl) / maxAbs, 1)
      bg = cell.pnl > 0 ? 'bg-emerald-500/20' : 'bg-red-500/20'
    } else if (metric === 'trades') {
      bg = 'bg-indigo-500/15'
    } else {
      bg = 'bg-emerald-500/15'
    }
  }
  return (
    <div
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            }
          : undefined
      }
      title={onClick && hasData ? 'Click to view these trades' : undefined}
      className={cn(
        'rounded-md border border-border p-3',
        bg,
        onClick && 'cursor-pointer transition-colors hover:border-emerald-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400'
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{dayName}</p>
      {hasData ? (
        <>
          <p className={cn(
            'text-lg font-bold tnum mt-1',
            metric === 'pnl' && (cell.pnl > 0 ? 'text-emerald-400' : 'text-red-400')
          )}>
            {metric === 'pnl' ? formatCurrencyIn('table', cell.pnl) : metric === 'trades' ? cell.trades : `${cell.winRate.toFixed(0)}%`}
          </p>
          {!compact && (
            <div className="text-[10px] text-muted-foreground mt-1 space-y-0.5">
              <p>{cell.trades} trades</p>
              <p>{cell.wins}W / {cell.losses}L</p>
              <p>{cell.winRate.toFixed(0)}% WR</p>
            </div>
          )}
        </>
      ) : (
        <p className="text-lg font-bold tnum mt-1 text-muted-foreground/30">—</p>
      )}
    </div>
  )
}

function InsightsCard({ cells, type }: { cells: any[]; type: HeatmapType }) {
  const withData = cells.filter((c) => c && c.trades > 0)
  if (withData.length === 0) return null

  let best: any = null
  let worst: any = null
  let mostActive: any = null

  for (const c of withData) {
    if (!best || c.pnl > best.pnl) best = c
    if (!worst || c.pnl < worst.pnl) worst = c
    if (!mostActive || c.trades > mostActive.trades) mostActive = c
  }

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const fmtLabel = (c: any) => {
    if (type === 'dayHour') return `${dayNames[c.day]} ${c.hour}:00`
    if (type === 'dayOfWeek') return dayNames[c.day]
    if (type === 'hourOfDay') return `${c.hour}:00 - ${c.hour}:59`
    return `Day ${c.day}`
  }
  // Task 15-W4 — the insight cards name the same slots the grid drills, so
  // they drill with the identical patch (COHORTSWEEP — dayOfMonth joined the
  // sweep: its slots drill via the dayOfMonth filter param, matching the grid).
  const patchOf = (c: any): { dayOfWeek?: number; hourOfDay?: number; dayOfMonth?: number } | null => {
    if (type === 'dayHour') return { dayOfWeek: c.day, hourOfDay: c.hour }
    if (type === 'dayOfWeek') return { dayOfWeek: c.day }
    if (type === 'hourOfDay') return { hourOfDay: c.hour }
    if (type === 'dayOfMonth') return { dayOfMonth: c.day }
    return null
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <Card
        className={`p-4 ${patchOf(best) ? 'cursor-pointer transition-colors hover:border-ring/50' : ''}`}
        onClick={() => {
          const p = patchOf(best)
          if (p) drillToTrades(p)
        }}
        aria-label={patchOf(best) ? `Open the trades behind the best slot (${fmtLabel(best)})` : undefined}
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Best {type === 'dayHour' ? 'Slot' : 'Period'}</p>
        <p className="text-sm font-semibold mt-1">{fmtLabel(best)}</p>
        <p className="text-emerald-400 text-lg font-bold tnum">{formatCurrencyIn('table', best.pnl)}</p>
        <p className="text-xs text-muted-foreground">{best.trades} trades · {best.winRate.toFixed(0)}% WR</p>
      </Card>
      <Card
        className={`p-4 ${patchOf(worst) ? 'cursor-pointer transition-colors hover:border-ring/50' : ''}`}
        onClick={() => {
          const p = patchOf(worst)
          if (p) drillToTrades(p)
        }}
        aria-label={patchOf(worst) ? `Open the trades behind the worst slot (${fmtLabel(worst)})` : undefined}
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Worst {type === 'dayHour' ? 'Slot' : 'Period'}</p>
        <p className="text-sm font-semibold mt-1">{fmtLabel(worst)}</p>
        <p className="text-red-400 text-lg font-bold tnum">{formatCurrencyIn('table', worst.pnl)}</p>
        <p className="text-xs text-muted-foreground">{worst.trades} trades · {worst.winRate.toFixed(0)}% WR</p>
      </Card>
      <Card
        className={`p-4 ${patchOf(mostActive) ? 'cursor-pointer transition-colors hover:border-ring/50' : ''}`}
        onClick={() => {
          const p = patchOf(mostActive)
          if (p) drillToTrades(p)
        }}
        aria-label={patchOf(mostActive) ? `Open the trades behind the most active slot (${fmtLabel(mostActive)})` : undefined}
      >
        <p className="text-xs text-muted-foreground uppercase tracking-wider">Most Active</p>
        <p className="text-sm font-semibold mt-1">{fmtLabel(mostActive)}</p>
        <p className="text-indigo-400 text-lg font-bold tnum">{mostActive.trades} trades</p>
        <p className="text-xs text-muted-foreground">{formatCurrencyIn('table', mostActive.pnl)} P&L</p>
      </Card>
    </div>
  )
}
