'use client'

/**
 * ============================================================================
 * SYSTEMS (/trading-plans/systems) — the system group library
 * ============================================================================
 * One card per SystemGroup, each listing its variants across plans with
 * status and trade counts. Open a variant in its plan editor.
 */
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { QueryErrorCard } from '@/components/metrics/metrics-kit'
import { Layers, ChevronRight, Boxes } from 'lucide-react'
import { cn } from '@/lib/utils'

interface VariantRow {
  id: string
  name: string
  status: string
  planId: string
  planName?: string
  trades: number
  setups: number
  currentVersionNo: number | null
}

export function PlanSystemsPage() {
  const navigate = useAppStore()
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['plan-systems'],
    queryFn: async () => {
      const res = await fetch('/api/trading-plans?include=tree')
      if (!res.ok) throw new Error('Failed')
      return res.json()
    },
  })

  if (isLoading) return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>
  if (isError) return <QueryErrorCard what="systems" error={error} onRetry={refetch} />

  // build groups → variants from the tree
  const plans = (data?.plans || []) as {
    id: string; name: string; status: string; isImported: boolean
    systems: { id: string; name: string; status: string; groupId: string; group?: { name: string; color: string } | null; currentVersion?: { versionNo: number } | null; setups: unknown[] }[]
  }[]

  const groups = new Map<string, { name: string; color: string; variants: VariantRow[] }>()
  for (const p of plans) {
    for (const sy of p.systems) {
      const gname = sy.group?.name || sy.name
      const g = groups.get(sy.groupId) || { name: gname, color: sy.group?.color || '#6366f1', variants: [] }
      g.variants.push({
        id: sy.id,
        name: sy.name,
        status: sy.status,
        planId: p.id,
        planName: p.name,
        trades: 0,
        setups: sy.setups.length,
        currentVersionNo: sy.currentVersion?.versionNo ?? null,
      })
      groups.set(sy.groupId, g)
    }
  }
  const groupList = Array.from(groups.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name))

  return (
    <div className="space-y-4">
      <Card className="p-4" data-testid="tp-systems-header">
        <h1 className="text-xl font-semibold tracking-tight flex items-center gap-2">
          <Boxes className="h-5 w-5 text-teal-400" aria-hidden />
          Systems
        </h1>
        <p className="mt-1 text-xs text-muted-foreground max-w-xl">
          System groups are identities shared across plans. Each variant is a complete standalone copy that
          lives in one plan — editing one never changes another.
        </p>
      </Card>

      {groupList.length === 0 ? (
        <Card className="p-10 text-center">
          <Layers className="mx-auto h-8 w-8 text-muted-foreground/50" aria-hidden />
          <h3 className="mt-2 text-sm font-semibold">No systems yet</h3>
          <p className="mt-1 text-xs text-muted-foreground">Open a plan and add your first system.</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate('/trading-plans/plans')}>
            Go to plans
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groupList.map(([gid, g]) => (
            <Card key={gid} className="p-4" data-testid="tp-system-group">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: g.color }} aria-hidden />
                <h3 className="text-sm font-semibold truncate">{g.name}</h3>
                <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                  {g.variants.length} variant{g.variants.length === 1 ? '' : 's'}
                </span>
              </div>
              <div className="mt-2.5 space-y-1">
                {g.variants.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => navigate(`/trading-plans/plan-editor?plan=${v.planId}`)}
                    className="w-full flex items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left hover:border-teal-500/30 hover:bg-teal-500/[0.03] transition-colors group cursor-pointer"
                    data-testid="tp-system-variant"
                  >
                    <span className="text-xs font-medium truncate flex-1">{v.name}</span>
                    <StatusChip status={v.status} />
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {v.planName === 'Imported' ? 'Imported' : v.planName}
                      {v.currentVersionNo ? ` · v${v.currentVersionNo}` : ''}
                      {` · ${v.setups} setup${v.setups === 1 ? '' : 's'}`}
                    </span>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-teal-400 transition-colors shrink-0" aria-hidden />
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function StatusChip({ status }: { status: string }) {
  const styles: Record<string, string> = {
    concept: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
    testing: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
    live_small: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
    live_full: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
    paused: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
    retired: 'bg-rose-500/15 text-rose-300 border-rose-500/30',
  }
  return (
    <span className={cn('rounded-sm border px-1 text-[8px] font-bold uppercase tracking-wide shrink-0', styles[status] || styles.concept)}>
      {status.replace('_', ' ')}
    </span>
  )
}
