'use client'

import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/card'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { AnimatedNumber } from '@/components/animated-number'

interface StatCardProps {
  label: string
  value: string | number
  /** Optional count-up: animates 0→value on mount (mirrors MetricTile anim). */
  anim?: { value: number; format: (n: number) => string }
  subvalue?: string
  change?: number
  changeLabel?: string
  icon?: React.ComponentType<{ className?: string }>
  positiveIsGood?: boolean
  className?: string
}

export function StatCard({
  label,
  value,
  anim,
  subvalue,
  change,
  changeLabel,
  icon: Icon,
  positiveIsGood = true,
  className,
}: StatCardProps) {
  const hasChange = change !== undefined && change !== 0
  const isPositive = (change || 0) > 0
  const isGood = positiveIsGood ? isPositive : !isPositive

  return (
    <Card className={cn('stat-card p-4 md:p-5 relative overflow-hidden', className)}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </p>
          <p className="text-xl md:text-2xl font-bold tracking-tight mt-1.5 tnum">
            {anim ? <AnimatedNumber value={anim.value} format={anim.format} /> : value}
          </p>
          {subvalue && (
            <p className="text-xs text-muted-foreground mt-1 tnum">{subvalue}</p>
          )}
          {hasChange && (
            <div className="flex items-center gap-x-1.5 gap-y-0.5 mt-2 flex-wrap">
              {isPositive ? (
                <TrendingUp className={cn('h-3.5 w-3.5 shrink-0', isGood ? 'text-emerald-400' : 'text-red-400')} />
              ) : (
                <TrendingDown className={cn('h-3.5 w-3.5 shrink-0', isGood ? 'text-emerald-400' : 'text-red-400')} />
              )}
              <span
                className={cn(
                  'text-xs font-medium tnum whitespace-nowrap',
                  isGood ? 'text-emerald-400' : 'text-red-400'
                )}
              >
                {isPositive ? '+' : ''}
                {change.toFixed(2)}%
              </span>
              {changeLabel && (
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {changeLabel}
                </span>
              )}
            </div>
          )}
        </div>
        {Icon && (
          <div className="stat-card-icon p-2 rounded-lg bg-muted/60 shrink-0">
            <Icon className="h-4 w-4 text-muted-foreground" />
          </div>
        )}
      </div>
    </Card>
  )
}
