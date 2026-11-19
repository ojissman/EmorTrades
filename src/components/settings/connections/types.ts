/**
 * ============================================================================
 * CONNECT-1 — shared types + presentation constants for the Connections hub.
 * ============================================================================
 * Wire types mirror the /api/connections* routes EXACTLY (verified against
 * src/app/api/connections/** handlers + prisma/schema.prisma CONNECT-1 models).
 * The hub is the only consumer, so the shapes live next to its components.
 *
 * Status semantics (PlatformConnection.status in the schema):
 *   connecting   — created from the UI, waiting for the EA's first pair
 *   connected    — EA paired, heartbeat fresh
 *   syncing      — a batch is being processed right now
 *   complete     — initial history recovery finished
 *   offline      — heartbeat went stale (EA / terminal closed)
 *   reconnecting — EA is re-establishing its session
 *   recovering   — EA is re-running the overlapping history lookback
 *   auth_error   — token rejected (rotate + re-enter in the EA)
 *   sync_error   — last ingest failed (details in lastError / sync logs)
 *   disconnected — user-initiated disconnect (tokens revoked, history kept)
 */

export type ConnectorPlatform = 'mt5' | 'mt4'

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'syncing'
  | 'complete'
  | 'offline'
  | 'reconnecting'
  | 'recovering'
  | 'auth_error'
  | 'sync_error'
  | 'disconnected'

/** Linked journal account as returned by the connections routes (deleted
 * accounts are nulled server-side — this is never a tombstone). */
export interface ConnectionAccountRef {
  id: string
  name: string
  currency: string
}

/** Latest sync log row embedded in the LIST payload (take-1, may be null). */
export interface LastSyncLog {
  kind: string
  status: string
  error: string | null
  startedAt: string
  finishedAt: string
  eventsIn: number
  duplicates: number
}

/** One connection row of GET /api/connections (the list payload). */
export interface ConnectionRow {
  id: string
  platform: ConnectorPlatform
  label: string
  /** EA-reported login — empty string until the EA first pairs. */
  login: string
  broker: string | null
  server: string | null
  status: ConnectionStatus
  lastError: string | null
  account: ConnectionAccountRef | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastEventAt: string | null
  eventsSynced: number
  eventsRecovered: number
  queueDepth: number
  eaVersion: string | null
  syncRequestedAt: string | null
  createdAt: string
  /** Raw connector events recorded (processed + duplicate + failed). */
  tradeCount: number
  lastSyncLog: LastSyncLog | null
}

/** Full sync-log row of GET /api/connections/{id} (the detail payload). */
export interface SyncLogRow {
  id: string
  kind: string
  status: string
  eventsIn: number
  duplicates: number
  tradesCreated: number
  tradesUpdated: number
  executionsCreated: number
  ordersUpserted: number
  positionsUpserted: number
  recovered: number
  error: string | null
  startedAt: string
  finishedAt: string
}

/** Account snapshot of GET /api/connections/{id} (12 newest). */
export interface SnapshotRow {
  id: string
  balance: number | null
  equity: number | null
  floatingPnl: number | null
  currency: string | null
  recordedAt: string
}

/** Token display row of GET /api/connections/{id} — prefix only, never raw. */
export interface TokenRow {
  id: string
  prefix: string
  status: string
  lastUsedAt: string | null
  createdAt: string
}

/** GET /api/connections/{id} — the monitoring detail payload. */
export interface ConnectionDetailRow {
  id: string
  platform: ConnectorPlatform
  label: string
  login: string
  broker: string | null
  server: string | null
  status: ConnectionStatus
  lastError: string | null
  account: ConnectionAccountRef | null
  lastHeartbeatAt: string | null
  lastSyncAt: string | null
  lastEventAt: string | null
  eventsSynced: number
  eventsRecovered: number
  queueDepth: number
  eaVersion: string | null
  syncRequestedAt: string | null
  createdAt: string
  tokens: TokenRow[]
  syncLogs: SyncLogRow[]
  snapshots: SnapshotRow[]
}

/** POST /api/connections 201 payload — the RAW token, shown exactly once. */
export interface CreateConnectionResponse {
  connection: {
    id: string
    platform: ConnectorPlatform
    label: string
    status: string
    createdAt: string
  }
  token: string
  tokenPrefix: string
  download: string
  installGuide: string
}

export const PLATFORM_LABEL: Record<ConnectorPlatform, string> = {
  mt5: 'MetaTrader 5',
  mt4: 'MetaTrader 4',
}

export const PLATFORM_TAG: Record<ConnectorPlatform, string> = {
  mt5: 'MT5',
  mt4: 'MT4',
}

/** EA file names in public/downloads (same as the API's download field). */
export const EA_FILE: Record<ConnectorPlatform, string> = {
  mt5: 'EmorTradesAutoSync-MT5.mq5',
  mt4: 'EmorTradesAutoSync-MT4.mq4',
}

/**
 * Status badge meta — the mt5-page STATUS_META idiom (bg/text/border triads,
 * light + dark pairs). Colors follow the CONNECT-1 brief:
 *   slate  → connecting        green → connected/syncing/complete
 *   amber  → reconnecting/rec   red   → auth_error/sync_error
 *   muted  → offline/disconnected
 */
export const STATUS_META: Record<ConnectionStatus, { label: string; className: string }> = {
  connecting: { label: 'Connecting', className: 'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30' },
  connected: { label: 'Connected', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  syncing: { label: 'Syncing', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  complete: { label: 'Complete', className: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' },
  offline: { label: 'Offline', className: 'bg-slate-500/10 text-slate-500 dark:text-slate-400 border-slate-500/25' },
  reconnecting: { label: 'Reconnecting', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  recovering: { label: 'Recovering', className: 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30' },
  auth_error: { label: 'Auth error', className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' },
  sync_error: { label: 'Sync error', className: 'bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30' },
  disconnected: { label: 'Disconnected', className: 'bg-muted text-muted-foreground border-border' },
}

export function statusMeta(s: string): { label: string; className: string } {
  return STATUS_META[s as ConnectionStatus] ?? STATUS_META.disconnected
}

/**
 * The connector server URL — the one string the EA files, the install steps
 * and the connection-card hint all reference (CONNECT-4: the owner's first
 * live attach failed on exactly this URL not being in the terminal's
 * WebRequest allow-list, invisibly).
 */
export const CONNECTOR_SERVER_URL = 'https://emortrade.space-z.ai'

/**
 * Platform-specific install instructions for the create-success step —
 * verbatim from the CONNECT-1 brief (they mirror the EA file headers in
 * public/downloads, which document the same WebRequest URL and read-only
 * guarantees).
 */
export const INSTALL_STEPS: Record<ConnectorPlatform, string[]> = {
  mt5: [
    'Download the EA file (button above) — EmorTradesAutoSync-MT5.mq5.',
    'In MT5: File → Open Data Folder → MQL5 → Experts — copy the file there.',
    'Open MetaEditor (press F4), open the file, press Compile (F7) — it must compile with no errors.',
    'In MT5: Tools → Options → Expert Advisors — check "Allow WebRequest for listed URL" and add: https://emortrade.space-z.ai',
    'Drag "EmorTradesAutoSync-MT5" onto any chart. In the EA inputs, paste your connection token into EmorToken.',
    'The chart\u2019s top-left shows the live sync status. Your trades appear in EmorTrades within seconds. (AutoTrading does not need to be enabled — the EA is read-only and never trades.)',
  ],
  mt4: [
    'Download the EA file — EmorTradesAutoSync-MT4.mq4.',
    'In MT4: File → Open Data File → MQL4 → Experts — copy the file there. Compile in MetaEditor (F4 → F7).',
    'In MT4: Tools → Options → Expert Advisors → "Allow WebRequest for listed URL" → add https://emortrade.space-z.ai',
    'Attach the EA to any chart and paste your connection token into the EmorToken input.',
    'IMPORTANT: in MT4\u2019s "Account History" tab, right-click → All History (MT4 only syncs what is displayed there).',
    'The chart\u2019s top-left shows the live sync status. (Read-only — never trades.)',
  ],
}

/** Human "x min ago" for heartbeat freshness (null when never seen). */
export function heartbeatAgo(iso: string | null | undefined, now = Date.now()): string | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (isNaN(t)) return null
  const min = Math.floor((now - t) / 60_000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min} min ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}
