'use client'

/**
 * ============================================================================
 * Task 22-d — `Connected Accounts` as a REAL broker data directory.
 * ============================================================================
 * The old fake Connect/Disconnect + localStorage badges are gone (the user
 * called the section "fancy display" — Task 22-a follow-up). What remains is
 * honest: a directory of the brokers EmorTrades imports from, where every
 * tile shows REAL stats computed from the app's own data:
 *
 *   accounts   → /api/accounts, matched by broker alias (same source as the
 *                Trading Accounts section)
 *   trades/last→ /api/trades?limit=5000, attributed through
 *                accountId → account.broker; "last activity" is the newest
 *                entryTime among that broker's trades
 *
 * and two REAL actions: "Import trades" (every tile, incl. CSV Upload — the
 * only way trades enter this local build) and "Add account" (deep link to
 * the Trading Accounts section's add dialog with the broker preselected).
 *
 * Auto-syncing to brokers is NOT available in this local build — the section
 * says so instead of faking a connection.
 */

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, CircleDashed, FileSpreadsheet, Landmark, Plus, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { SectionCard } from '@/components/settings/section-card'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'

type BrokerTile = {
  id: string
  name: string
  note?: string
  csv?: boolean
  /** lowercase-normalized aliases used to match real Account.broker values */
  aliases: string[]
  /**
   * Exact broker value in the Trading Accounts add form (Task 22-d list
   * extension). Absent on the CSV Upload tile — "any broker" has no form
   * equivalent, so that tile only offers the import CTA.
   */
  formBroker?: string
}

const BROKERS: BrokerTile[] = [
  { id: 'ibkr', name: 'IBKR', note: 'Interactive Brokers', aliases: ['ibkr', 'interactivebrokers', 'ib'], formBroker: 'Interactive Brokers' },
  { id: 'td-ameritrade', name: 'TD Ameritrade', note: 'thinkorswim', aliases: ['tdameritrade', 'thinkorswim', 'ameritrade'], formBroker: 'TD Ameritrade' },
  { id: 'schwab', name: 'Schwab', note: 'Charles Schwab', aliases: ['schwab', 'charlesschwab'], formBroker: 'Charles Schwab' },
  { id: 'etrade', name: 'E*TRADE', aliases: ['etrade'], formBroker: 'E*TRADE' },
  { id: 'tradestation', name: 'TradeStation', aliases: ['tradestation'], formBroker: 'TradeStation' },
  { id: 'webull', name: 'Webull', aliases: ['webull'], formBroker: 'Webull' },
  { id: 'robinhood', name: 'Robinhood', aliases: ['robinhood'], formBroker: 'Robinhood' },
  { id: 'alpaca', name: 'Alpaca', aliases: ['alpaca'], formBroker: 'Alpaca' },
  { id: 'tradier', name: 'Tradier', aliases: ['tradier'], formBroker: 'Tradier' },
  { id: 'binance', name: 'Binance', aliases: ['binance'], formBroker: 'Binance' },
  { id: 'coinbase', name: 'Coinbase', aliases: ['coinbase'], formBroker: 'Coinbase' },
  { id: 'kraken', name: 'Kraken', aliases: ['kraken'], formBroker: 'Kraken' },
  { id: 'csv-upload', name: 'CSV Upload', note: 'Manual entry — any broker', csv: true, aliases: ['manual', 'csv'] },
]

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Real per-tile stats derived from the app's accounts + trades. */
type BrokerStats = {
  /** trading accounts whose broker matches this tile */
  accounts: number
  /** trades attributed to those accounts */
  trades: number
  /** newest entryTime among those trades (epoch ms) — null = no trades */
  lastEntryMs: number | null
}

const EMPTY_STATS: BrokerStats = { accounts: 0, trades: 0, lastEntryMs: null }

export function ConnectedAccountsSection() {
  const navigate = useAppStore((s) => s.navigate)

  // Real trading accounts — same ['accounts'] cache the app shell and the
  // Trading Accounts section read (stats stay in sync everywhere).
  const { data: accountsData, isLoading: accountsLoading, isError: accountsError } = useQuery({
    queryKey: ['accounts'],
    queryFn: async () => {
      const res = await fetch('/api/accounts')
      if (!res.ok) throw new Error('Failed to load accounts')
      return res.json()
    },
  })

  // Real trades — one page of up to 5000 rows (the import wizard's ['trades']
  // invalidations refresh these counts after every import). Trades whose
  // account was deleted or whose broker matches no tile count toward nothing
  // — no tile claims data it doesn't own.
  const { data: tradesData, isLoading: tradesLoading, isError: tradesError } = useQuery({
    queryKey: ['trades'],
    queryFn: async () => {
      const res = await fetch('/api/trades?limit=5000')
      if (!res.ok) throw new Error('Failed to load trades')
      return res.json()
    },
  })

  const stats = useMemo(() => {
    const accounts: { id: string; broker?: string | null }[] = accountsData?.accounts ?? []
    const trades: { id: string; accountId?: string | null; entryTime?: string | null }[] = tradesData?.trades ?? []

    // accountId → tile id, through the same alias matching the account
    // counts use (accounts on unlisted brokers — e.g. Fidelity — stay off
    // this directory rather than being shoehorned onto a wrong tile).
    const tileByAccount = new Map<string, string>()
    for (const acc of accounts) {
      const n = normalize(String(acc.broker ?? ''))
      if (!n) continue
      const tile = BROKERS.find((b) => n === normalize(b.name) || b.aliases.includes(n))
      if (tile) tileByAccount.set(acc.id, tile.id)
    }

    const out: Record<string, BrokerStats> = {}
    for (const b of BROKERS) out[b.id] = { ...EMPTY_STATS }
    for (const acc of accounts) {
      const tileId = tileByAccount.get(acc.id)
      if (tileId) out[tileId].accounts += 1
    }
    for (const t of trades) {
      const tileId = t.accountId ? tileByAccount.get(t.accountId) : undefined
      if (!tileId) continue
      const s = out[tileId]
      s.trades += 1
      const ms = t.entryTime ? new Date(t.entryTime).getTime() : NaN
      if (!Number.isNaN(ms) && (s.lastEntryMs === null || ms > s.lastEntryMs)) s.lastEntryMs = ms
    }
    return out
  }, [accountsData, tradesData])

  return (
    <div className="space-y-4" data-testid="settings-connected-accounts">
      <SectionCard
        title="Connected Accounts"
        description="Your broker directory with real usage stats — each tile shows the trading accounts you've added for that broker, how many trades they hold and when you were last active. Auto-syncing to brokers is not available in this local build: bring trades in via the CSV import wizard."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="connected-broker-grid">
          {BROKERS.map((broker) => {
            const s = stats[broker.id] ?? EMPTY_STATS
            const inUse = s.accounts > 0
            const lastDate = s.lastEntryMs !== null ? new Date(s.lastEntryMs) : null
            const formBroker = broker.formBroker
            return (
              <div
                key={broker.id}
                data-testid={`broker-tile-${broker.id}`}
                className={cn(
                  'flex flex-col gap-2 rounded-lg border p-3 transition-colors',
                  inUse
                    ? 'border-emerald-500/30 bg-emerald-500/[0.04]'
                    : 'border-[var(--border-strong)] bg-[var(--bg-inset)]'
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    {broker.csv ? (
                      <FileSpreadsheet className="h-4 w-4 shrink-0 text-emerald-400" />
                    ) : (
                      <Landmark className="h-4 w-4 shrink-0" style={{ color: 'var(--text-secondary)' }} />
                    )}
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                        {broker.name}
                      </p>
                      {broker.note && (
                        <p className="truncate text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                          {broker.note}
                        </p>
                      )}
                    </div>
                  </div>
                  {accountsLoading ? (
                    <Skeleton className="h-5 w-24 shrink-0 rounded-full" />
                  ) : accountsError ? (
                    <Badge className="border-[var(--border-strong)] bg-transparent text-[var(--text-secondary)]">
                      Stats unavailable
                    </Badge>
                  ) : inUse ? (
                    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
                      <CheckCircle2 className="h-3 w-3" />
                      In use · {s.accounts} account{s.accounts === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge className="border-[var(--border-strong)] bg-transparent text-[var(--text-secondary)]">
                      <CircleDashed className="h-3 w-3" />
                      No accounts yet
                    </Badge>
                  )}
                </div>

                {tradesLoading ? (
                  <Skeleton className="h-3.5 w-44" />
                ) : tradesError ? (
                  <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                    Trades: — · Last: —
                  </p>
                ) : (
                  <p
                    className="flex flex-wrap items-center gap-1.5 text-[11px] tnum"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <span>
                      Trades:{' '}
                      <span
                        className="font-semibold"
                        style={{ color: s.trades > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                      >
                        {s.trades}
                      </span>
                    </span>
                    <span aria-hidden>·</span>
                    <span>Last: {formatDate(lastDate)}</span>
                  </p>
                )}

                {/* Real actions — the only two things this build can actually do */}
                <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
                  <Button
                    size="sm"
                    onClick={() => navigate('/trades-import')}
                    title="Open the CSV import wizard"
                    data-testid={`broker-import-${broker.id}`}
                    className="bg-[var(--shell-accent)] text-white hover:bg-[var(--shell-accent-hover)]"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Import trades
                  </Button>
                  {formBroker && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        navigate(`/settings?section=trading-accounts&broker=${encodeURIComponent(formBroker)}`)
                      }
                      title={`Add a ${broker.name} account`}
                      data-testid={`broker-add-account-${broker.id}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add account
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </SectionCard>
    </div>
  )
}
