'use client'

/**
 * Sessions Analytics (Task 176) — where in the trading day your edge actually
 * lives. Per-session performance (Asia / London / New York or your own
 * windows) with PnL, hit ratio, profit factor, expectancy and average R;
 * a 24-hour PnL rhythm chart; and a manager for custom session windows.
 * All numbers derive from real closed trades only.
 */

import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
// Task 15-W3 — honest error state.
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Panel, MetricStat, AXIS_TICK, TOOLTIP_STYLE, pfTone } from '@/components/metrics/metrics-kit'
import { BarChart, Bar, ResponsiveContainer, Tooltip as ReTooltip, XAxis, YAxis, CartesianGrid, Cell, ReferenceLine } from 'recharts'
import { axisMoney, formatCurrencyIn, formatNumber, pnlColor } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Clock, Globe2, Plus, Trash2, Sunrise, MousePointerClick } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { drillToTrades } from '@/lib/drill'
import { useAppStore } from '@/store/app-store'
import { useFilterStore } from '@/store/filter-store'

interface SessionStats {
  name: string
  color: string
  window: string
  /** Task 13 — numeric window bounds (null = Off-session, not drillable). */
  startHour: number | null
  endHour: number | null
  custom: boolean
  trades: number
  wins: number
  losses: number
  netPnl: number
  winRate: number | null
  profitFactor: number | null
  expectancy: number | null
  avgR: number | null
  avgHoldMin: number | null
}

interface Bundle {
  sessions: SessionStats[]
  usingDefaults: boolean
  hourly: { hour: number; pnl: number; trades: number }[]
  best: SessionStats | null
  worst: SessionStats | null
  totalClosed: number
  note: string
}

export function SessionsPage() {
  const queryClient = useQueryClient()
  const { toast } = useToast()
  // Task 9-d — the global Account + Date controls scope this page (it was the
  // only Summaries page that ignored them): account from the app-store
  // selector, date window from the same filter-store envelope /api/trades
  // consumers send.
  const { selectedAccountId } = useAppStore()
  const filterStore = useFilterStore()
  const [name, setName] = useState('')
  const [start, setStart] = useState('07:00')
  const [end, setEnd] = useState('11:00')

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['sessions-analytics', selectedAccountId, filterStore.toQueryParams()],
    queryFn: async () => {
      const params = new URLSearchParams()
      const env = new URLSearchParams(filterStore.toQueryParams())
      const startDate = env.get('startDate')
      const endDate = env.get('endDate')
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      if (selectedAccountId !== 'all') params.set('accountId', selectedAccountId)
      const qs = params.toString()
      const res = await fetch(`/api/sessions-analytics${qs ? `?${qs}` : ''}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<Bundle>
    },
    staleTime: 30_000,
  })

  async function addSession() {
    if (!name.trim()) {
      toast({ title: 'Session name required', variant: 'destructive' })
      return
    }
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), startTime: start, endTime: end }),
      })
      if (!res.ok) throw new Error()
      setName('')
      queryClient.invalidateQueries({ queryKey: ['sessions-analytics'] })
      toast({ title: 'Session window added' })
    } catch {
      toast({ title: 'Failed to add session', variant: 'destructive' })
    }
  }

  async function removeSession(s: SessionStats) {
    // Task 16-c — confirm before deleting a custom session window.
    if (!window.confirm(`Remove the "${s.name}" session window?`)) return
    // Look up the id via the sessions list (name+window are unique enough here)
    try {
      const listRes = await fetch('/api/sessions')
      if (!listRes.ok) throw new Error()
      const { sessions } = await listRes.json()
      const match = (sessions as any[]).find((x) => x.name === s.name && x.startTime === s.window.slice(0, 5))
      if (!match) throw new Error('not found')
      const res = await fetch(`/api/sessions?id=${match.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      queryClient.invalidateQueries({ queryKey: ['sessions-analytics'] })
      toast({ title: 'Session window removed' })
    } catch {
      toast({ title: 'Failed to remove session', variant: 'destructive' })
    }
  }

  // Task 15-W3 — a failed fetch is not "no closed trades".
  if (isError) return <QueryErrorCard what="sessions analytics" error={error} onRetry={refetch} />

  if (isLoading) return <div className="shell-widget h-40 shimmer" />

  if (!data || data.totalClosed === 0) {
    return (
      <div className="grid place-items-center py-20 text-center">
        <div>
          <Clock className="h-8 w-8 mx-auto mb-3" style={{ color: 'var(--text-secondary)' }} />
          <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>No closed trades in scope</p>
          <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-secondary)' }}>
            Session analytics light up as soon as the selected account and date range contain closed trades — every stat
            on this page is computed from your real executions.
          </p>
        </div>
      </div>
    )
  }

  const withData = data.sessions.filter((s) => s.trades > 0)
  const hourlyChart = data.hourly.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))
  // Task 9-d — a session only drills when it has a real window (Off-session
  // has none); Best/Weakest tiles and bars reflect that instead of looking
  // clickable when the click would no-op.
  const drillable = (s: SessionStats | null | undefined): s is SessionStats =>
    !!s && s.startHour !== null && s.endHour !== null

  // Task 13 — drill a session window (or a single hourly bar) into the
  // trades table scoped to the exact entry-hour range the bucket counted.
  // Off-session has no window → not drillable (honesty over affordance).
  const drillSession = (s: SessionStats) => {
    if (s.startHour === null || s.endHour === null) return
    drillToTrades({ hourFrom: s.startHour, hourTo: s.endHour })
  }
  const drillHour = (hour: number) => {
    drillToTrades({ hourFrom: hour, hourTo: hour + 1 })
  }

  return (
    <div className="space-y-4">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricStat
          label="Best session"
          value={data.best ? data.best.name : '—'}
          sub={data.best ? `${formatCurrencyIn('kpi', data.best.netPnl, 'USD')} net · ${data.best.trades} trades${drillable(data.best) ? ' — click to drill' : ''}` : undefined}
          tone="good"
          big
          onClick={drillable(data.best) ? () => drillSession(data.best!) : undefined}
        />
        <MetricStat
          label="Weakest session"
          value={data.worst ? data.worst.name : '—'}
          sub={data.worst ? `${formatCurrencyIn('kpi', data.worst.netPnl, 'USD')} net · ${data.worst.trades} trades${drillable(data.worst) ? ' — click to drill' : ''}` : undefined}
          tone={data.worst && data.worst.netPnl < 0 ? 'bad' : 'warn'}
          onClick={drillable(data.worst) ? () => drillSession(data.worst!) : undefined}
        />
        <MetricStat
          label="Closed trades bucketed"
          value={formatNumber(data.totalClosed, 0)}
          sub={data.usingDefaults ? 'classic Asia · London · New York split' : 'your custom windows'}
        />
        <MetricStat
          label="Definition basis"
          value={data.usingDefaults ? 'Default windows' : 'Custom windows'}
          sub={data.usingDefaults ? 'add a window below to override' : 'manage below'}
        />
      </div>

      {/* Session table */}
      <Panel title="Performance by session" hint="entries bucketed by the UTC hour of entry time — click a row to drill into its trades">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Session</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Net PnL</TableHead>
                <TableHead className="text-right">Hit ratio</TableHead>
                <TableHead className="text-right">Profit factor</TableHead>
                <TableHead className="text-right">Expectancy</TableHead>
                <TableHead className="text-right">Avg R</TableHead>
                <TableHead className="text-right">Avg hold</TableHead>
                {withData.length > 0 && <TableHead />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.sessions.map((s) => {
                const drillable = s.trades > 0 && s.startHour !== null && s.endHour !== null
                return (
                <TableRow
                  key={s.name}
                  className={drillable ? 'cursor-pointer' : undefined}
                  onClick={drillable ? () => drillSession(s) : undefined}
                  title={drillable ? `Show the ${s.trades} trades entered in ${s.window}` : s.startHour === null ? 'Entries outside every window — no hour range to drill' : undefined}
                >
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                      <div>
                        <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{s.name}</p>
                        <p className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{s.window}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(s.trades, 0)}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold" style={{ color: pnlColor(s.netPnl) }}>
                    {formatCurrencyIn('table', s.netPnl, 'USD')}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.winRate !== null ? `${formatNumber(s.winRate, 0)}%` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: pfTone(s.profitFactor) }}>
                    {s.profitFactor === null ? '∞' : formatNumber(s.profitFactor)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums" style={{ color: pnlColor(s.expectancy ?? 0) }}>
                    {s.expectancy !== null ? formatCurrencyIn('table', s.expectancy, 'USD') : '—'}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.avgR !== null ? `${formatNumber(s.avgR)}R` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {s.avgHoldMin !== null ? (s.avgHoldMin >= 60 ? `${Math.round((s.avgHoldMin / 60) * 10) / 10}h` : `${s.avgHoldMin}m`) : '—'}
                  </TableCell>
                  {withData.length > 0 && (
                    <TableCell className="text-right">
                      {s.custom && (
                        <button
                          onClick={() => removeSession(s)}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-[var(--bg-hover)]"
                          title="Remove custom window"
                          aria-label={`Remove ${s.name} window`}
                        >
                          <Trash2 className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} />
                        </button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
        <p className="text-[11px] mt-3 flex items-start gap-1.5" style={{ color: 'var(--text-secondary)' }}>
          <MousePointerClick className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            {data.note} Rows with trades drill into the trades table scoped to their entry-hour window (Task 13); hourly bars below drill their single hour.
          </span>
        </p>
      </Panel>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Net PnL by session" hint="where the money is actually made — click a bar to drill its window">
          <div className="h-56">
            {withData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={withData} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                  <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                  <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={false} />
                  <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                  <ReTooltip
                    contentStyle={TOOLTIP_STYLE}
                    labelStyle={{ color: 'var(--text-secondary)' }}
                    itemStyle={{ color: 'var(--text-primary)' }}
                    cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                    formatter={(value: number, name: string) => [formatCurrencyIn('chart', value, 'USD'), name]}
                  />
                  <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                  <Bar
                    dataKey="netPnl"
                    radius={[3, 3, 0, 0]}
                    maxBarSize={52}
                    name="Net PnL"
                    onClick={(entry: any) => drillSession(entry?.payload ?? entry)}
                  >
                    {withData.map((s, i) => (
                      <Cell
                        key={i}
                        fill={s.netPnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
                        className={drillable(s) ? 'cursor-pointer' : 'cursor-default'}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-xs grid place-items-center h-full" style={{ color: 'var(--text-secondary)' }}>No data.</p>
            )}
          </div>
        </Panel>

        <Panel title="24-hour PnL rhythm" hint="net PnL by entry hour — click a bar to drill that hour">
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourlyChart} margin={{ top: 8, right: 4, bottom: 0, left: -12 }}>
                <CartesianGrid stroke="var(--shell-border)" vertical={false} />
                <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={2} />
                <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={axisMoney} />
                <ReTooltip
                  contentStyle={TOOLTIP_STYLE}
                  labelStyle={{ color: 'var(--text-secondary)' }}
                  itemStyle={{ color: 'var(--text-primary)' }}
                  cursor={{ fill: 'var(--bg-hover)', opacity: 0.4 }}
                  formatter={(value: number, name: string) => [formatCurrencyIn('chart', value, 'USD'), name]}
                />
                <ReferenceLine y={0} stroke="var(--text-secondary)" strokeDasharray="4 4" />
                <Bar
                  dataKey="pnl"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={20}
                  name="Net PnL"
                  className="cursor-pointer"
                  onClick={(entry: any) => {
                    const hour = entry?.payload?.hour ?? (entry as any)?.hour
                    if (typeof hour === 'number' && hourlyChart[hour]?.trades > 0) drillHour(hour)
                  }}
                >
                  {hourlyChart.map((h, i) => (
                    <Cell
                      key={i}
                      fill={h.pnl >= 0 ? 'var(--shell-success)' : 'var(--shell-danger)'}
                      className={h.trades > 0 ? undefined : 'opacity-40'}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      {/* Session window manager */}
      <Panel title="Session windows" hint="define your own kill zones — overrides the classic split">
        <div className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_120px_auto] items-end">
            <div>
              <Label className="text-xs">Name</Label>
              <Input
                className="mt-1 h-9"
                placeholder="e.g. London open, NY am kill zone"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs">Start (UTC hour)</Label>
              <Input className="mt-1 h-9" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">End (UTC hour)</Label>
              <Input className="mt-1 h-9" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
            <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={addSession}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Add window
            </Button>
          </div>
          <p className="text-[11px] flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            {data.usingDefaults ? (
              <>
                <Sunrise className="h-3 w-3 shrink-0" />
                Using the classic windows — Asia 00:00–08:00 · London 08:00–16:00 · New York 16:00–00:00 (the UTC entry clock). Add a window to take control.
              </>
            ) : (
              <>
                <Globe2 className="h-3 w-3 shrink-0" />
                Custom windows active. Remove them all to fall back to the classic split.
              </>
            )}
          </p>
        </div>
      </Panel>
    </div>
  )
}
