'use client'

import { useState, useRef, useEffect } from 'react'
import { useFilterStore } from '@/store/filter-store'
import { useAppStore } from '@/store/app-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Filter, ChevronDown, Calendar, DollarSign, Clock, Tag } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { cn } from '@/lib/utils'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function AdvancedFilterPanel() {
  const filterStore = useFilterStore()
  const { selectedAccountId, setAccount, dateRange, setDateRange } = useAppStore()
  const [open, setOpen] = useState(false)

  const { data: setupsData } = useQuery({
    queryKey: ['setups'],
    queryFn: async () => {
      const res = await fetch('/api/setups')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })
  const { data: mistakesData } = useQuery({
    queryKey: ['mistakes'],
    queryFn: async () => {
      const res = await fetch('/api/mistakes')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  const setups = setupsData?.setups || []
  const accounts = accountsData?.accounts || []
  const mistakes = mistakesData?.mistakes || []

  const activeCount = filterStore.activeFilterCount()

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className={cn(
            'h-9',
            activeCount > 0 && 'border-white/20 bg-white/10 text-foreground'
          )}
        >
          <Filter className="h-3.5 w-3.5 mr-1.5" />
          <span className="text-xs">Filters</span>
          {activeCount > 0 && (
            <span className="ml-1 text-[10px] bg-white/15 px-1.5 py-0.5 rounded-full">
              {activeCount}
            </span>
          )}
          <ChevronDown className="h-3 w-3 ml-1.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] max-h-[500px] overflow-y-auto" align="end">
        <div className="space-y-4">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <Filter className="h-4 w-4 text-emerald-400" />
            <h3 className="text-sm font-semibold">Advanced Filters</h3>
          </div>

          {/* Symbol filter */}
          <div>
            <Label>Symbol</Label>
            <Input
              className="mt-1.5 uppercase"
              placeholder="e.g. AAPL"
              value={filterStore.symbol || ''}
              onChange={(e) => filterStore.setFilter('symbol', e.target.value.toUpperCase() || undefined)}
            />
          </div>

          {/* Side + Status */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Side</Label>
              <Select value={filterStore.side || 'all'} onValueChange={(v) => filterStore.setFilter('side', v as any)}>
                <SelectTrigger className="mt-1.5 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Sides</SelectItem>
                  <SelectItem value="long">Long</SelectItem>
                  <SelectItem value="short">Short</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={filterStore.status || 'all'} onValueChange={(v) => filterStore.setFilter('status', v as any)}>
                <SelectTrigger className="mt-1.5 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="closed">Closed</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Outcome */}
          <div>
            <Label>Outcome</Label>
            <Select value={filterStore.outcome || 'all'} onValueChange={(v) => filterStore.setFilter('outcome', v as any)}>
              <SelectTrigger className="mt-1.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Outcomes</SelectItem>
                <SelectItem value="win">Winners Only</SelectItem>
                <SelectItem value="loss">Losers Only</SelectItem>
                <SelectItem value="breakeven">Break-even Only</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Custom date range (overrides the topbar preset while set) */}
          <div>
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3 text-violet-400" />
                Custom date range
              </Label>
              {filterStore.customStartDate && (
                <button
                  type="button"
                  onClick={() => {
                    filterStore.clearFilter('customStartDate')
                    filterStore.clearFilter('customEndDate')
                  }}
                  className="text-[10px] text-violet-400 hover:text-violet-300"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-1.5">
              <Input
                className="h-8 text-xs"
                type="date"
                aria-label="From date"
                value={
                  filterStore.customStartDate
                    ? new Date(filterStore.customStartDate).toISOString().slice(0, 10)
                    : ''
                }
                onChange={(e) =>
                  filterStore.setFilter(
                    'customStartDate',
                    e.target.value ? new Date(e.target.value + 'T00:00:00').toISOString() : undefined
                  )
                }
              />
              <Input
                className="h-8 text-xs"
                type="date"
                aria-label="To date"
                value={
                  filterStore.customEndDate
                    ? new Date(filterStore.customEndDate).toISOString().slice(0, 10)
                    : ''
                }
                onChange={(e) =>
                  filterStore.setFilter(
                    'customEndDate',
                    e.target.value ? new Date(e.target.value + 'T23:59:59.999').toISOString() : undefined
                  )
                }
              />
            </div>
            {filterStore.customStartDate && (
              <p className="text-[10px] text-violet-400/80 mt-1">
                Overrides the “{dateRange === 'all' ? 'All' : dateRange + 'd'}” preset in the top bar
              </p>
            )}
          </div>

          {/* Setup */}
          <div>
            <Label>Setup</Label>
            <Select value={filterStore.setupId || 'all'} onValueChange={(v) => filterStore.setFilter('setupId', v)}>
              <SelectTrigger className="mt-1.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Setups</SelectItem>
                {setups.map((s: any) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Day of week */}
          <div>
            <Label>Day of Week</Label>
            <Select
              value={filterStore.dayOfWeek !== undefined ? String(filterStore.dayOfWeek) : 'all'}
              onValueChange={(v) => filterStore.setFilter('dayOfWeek', v === 'all' ? undefined : parseInt(v))}
            >
              <SelectTrigger className="mt-1.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Days</SelectItem>
                {DAY_NAMES.map((day, i) => (
                  <SelectItem key={i} value={String(i)}>{day}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Hour of day */}
          <div>
            <Label>Hour of Day</Label>
            <Select
              value={filterStore.hourOfDay !== undefined ? String(filterStore.hourOfDay) : 'all'}
              onValueChange={(v) => filterStore.setFilter('hourOfDay', v === 'all' ? undefined : parseInt(v))}
            >
              <SelectTrigger className="mt-1.5 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Hours</SelectItem>
                {Array.from({ length: 24 }).map((_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* P&L range */}
          <div>
            <Label>Min P&L ($)</Label>
            <Input
              className="mt-1.5 tnum h-8 text-xs"
              type="number"
              placeholder="No minimum"
              value={filterStore.minPnl ?? ''}
              onChange={(e) => filterStore.setFilter('minPnl', e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>
          <div>
            <Label>Max P&L ($)</Label>
            <Input
              className="mt-1.5 tnum h-8 text-xs"
              type="number"
              placeholder="No maximum"
              value={filterStore.maxPnl ?? ''}
              onChange={(e) => filterStore.setFilter('maxPnl', e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>

          {/* R multiple range */}
          <div>
            <Label>Min R-Multiple</Label>
            <Input
              className="mt-1.5 tnum h-8 text-xs"
              type="number"
              step="0.1"
              placeholder="No minimum"
              value={filterStore.minR ?? ''}
              onChange={(e) => filterStore.setFilter('minR', e.target.value ? parseFloat(e.target.value) : undefined)}
            />
          </div>

          {/* Mistakes multi-select */}
          <div>
            <Label>Mistakes (multi-select)</Label>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {mistakes.length === 0 ? (
                <p className="text-xs text-muted-foreground">No mistakes defined</p>
              ) : (
                mistakes.map((m: any) => {
                  const sel = filterStore.mistakeIds?.includes(m.id)
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => {
                        const current = filterStore.mistakeIds || []
                        const next = sel
                          ? current.filter((id) => id !== m.id)
                          : [...current, m.id]
                        filterStore.setFilter('mistakeIds', next)
                      }}
                      className={cn(
                        'text-xs px-2 py-1 rounded-md border transition-all',
                        sel
                          ? 'border-transparent text-white'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                      style={sel ? { background: m.color } : {}}
                    >
                      {m.name}
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => filterStore.clearAll()}
              disabled={activeCount === 0}
            >
              Reset all
            </Button>
            <Button size="sm" onClick={() => setOpen(false)} className="bg-emerald-600 hover:bg-emerald-700">
              Apply
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
