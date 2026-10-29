'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { suggestMultiplier, isKnownFuture } from '@/lib/contracts'
import { aggregateLegs, classifyStrategy, STRATEGY_LABELS, type LegInput } from '@/lib/legs'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import { FitValue } from '@/components/fit-value'
import { X, Plus, TriangleAlert, Zap } from 'lucide-react'
import { useToast } from '@/hooks/use-toast'
import { useQueryClient } from '@tanstack/react-query'
import { formatCurrency } from '@/lib/format'
import { cn } from '@/lib/utils'
// Task 10 — economic news-release awareness inside the journaling flow:
// releases near the entry timestamp for the symbol's currencies.
import { currenciesForSymbol, impactRank, ECON_DOT_CLS } from '@/lib/econ-shared'
// Task 22-c — note templates: the applied default prefills NEW trade notes,
// and the "Insert template" control offers the trade-type templates.
import { useUserSettings, settingsSlice } from '@/hooks/use-user-settings'
import { appliedTemplateBody, templatesForType, type NoteTemplate } from '@/lib/note-templates'

// Task 179 — one editable row of the multi-leg structure editor.
type LegRow = {
  legType: 'call' | 'put'
  side: 'long' | 'short'
  quantity: string
  strike: string
  expiry: string
  entryPrice: string
  exitPrice: string
}
const emptyLeg = (): LegRow => ({ legType: 'call', side: 'long', quantity: '1', strike: '', expiry: '', entryPrice: '', exitPrice: '' })
const toLegInput = (r: LegRow): LegInput | null => {
  const qty = parseFloat(r.quantity)
  const entry = parseFloat(r.entryPrice)
  if (!qty || qty <= 0 || !entry || entry <= 0) return null
  return {
    legType: r.legType,
    side: r.side,
    quantity: qty,
    multiplier: 100,
    entryPrice: entry,
    exitPrice: r.exitPrice === '' ? null : parseFloat(r.exitPrice) || null,
    strike: r.strike === '' ? null : parseFloat(r.strike),
    expiry: r.expiry || null,
  }
}

interface Account {
  id: string
  name: string
  color: string
  // TP-7 — equity source for the live risk % check (the /api/accounts rows
  // the modal already fetches carry the balance + realized PnL)
  startingBalance?: number | null
  pnl?: number | null
}

interface Setup {
  id: string
  name: string
  color: string
}

interface Tag {
  id: string
  name: string
  color: string
}

// ── TP: the plan link's cascading pickers' data ───────────────────────────

// Version rows exactly as /api/trading-plans/[id] returns them (contents
// included) — one tree fetch powers the cascading pickers AND the warnings.
interface TpVersionRow {
  id: string
  versionNo: number | null
  status: string
  content: string | null
}

interface TpPlanTree {
  plan: { id: string; currentVersionId: string | null }
  versions: TpVersionRow[]
  systems: {
    id: string
    name: string
    status: string
    currentVersionId?: string | null
    currentVersion?: { id: string } | null
    versions: TpVersionRow[]
    setups: {
      id: string
      name: string
      currentVersionId?: string | null
      currentVersion?: { id: string } | null
      versions: TpVersionRow[]
    }[]
  }[]
}

// Task 10 — economic release context for the entry being journaled:
// relation of each release to the entry/exit timestamps.
interface EconCtxRow {
  id: string
  title: string
  currency: string
  impact: string
  relation: 'near' | 'during' | 'ahead'
  distMin: number
}

interface TradeModalProps {
  accounts?: Account[]
  setups?: Setup[]
  tags?: Tag[]
}

export function TradeModal({ accounts: accountsProp, setups: setupsProp, tags: tagsProp }: TradeModalProps) {
  const { isTradeModalOpen, editingTradeId, closeTradeModal } = useAppStore()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [accounts, setAccounts] = useState<Account[]>(accountsProp || [])
  const [setups, setSetups] = useState<Setup[]>(setupsProp || [])
  const [tags, setTags] = useState<Tag[]>(tagsProp || [])
  // TP — the plan link: plan → system → setup (cascading), plus the
  // rule-engine fields. The link pins the versions in force at entry.
  const [tpPlans, setTpPlans] = useState<{ id: string; name: string; color: string; status: string; isImported: boolean }[]>([])
  const [tpPlanId, setTpPlanId] = useState('')
  const [tpSystems, setTpSystems] = useState<{ id: string; name: string; status: string; setups: { id: string; name: string }[] }[]>([])
  const [tpSystemId, setTpSystemId] = useState('')
  const [tpSetupId, setTpSetupId] = useState('')
  const [tpForm, setTpForm] = useState({ timeframe: '', setupGrade: '', entryNote: '', plannedRiskAmount: '' })
  // TP2 Phase 5 — the non-blocking plan warnings for the form's current
  // values (facts helper + number fields; never blocks saving).
  const [tpWarnings, setTpWarnings] = useState<{ kind: string; message: string }[]>([])
  const tpWarningsAbort = useRef<AbortController | null>(null)
  const tpPlanTreeQ = useQuery({
    queryKey: ['tp-plan-tree-modal', tpPlanId],
    queryFn: async () => {
      const res = await fetch(`/api/trading-plans/${tpPlanId}`)
      if (!res.ok) throw new Error('Failed')
      return res.json() as Promise<TpPlanTree>
    },
    enabled: !!tpPlanId,
  })
  useEffect(() => {
    setTpSystems(tpPlanTreeQ.data?.systems || [])
  }, [tpPlanTreeQ.data])

  const [loading, setLoading] = useState(false)
  const [lossStreak, setLossStreak] = useState(0)
  const [halfApplied, setHalfApplied] = useState(false)
  const [fullQuantity, setFullQuantity] = useState<string>('')
  // Task 22-c — note templates: the trade-type template list (refreshed on
  // every modal open so Settings edits are picked up) + the once-per-open
  // guard for the applied-default prefill.
  const { data: settingsRow } = useUserSettings()
  const [tradeTemplates, setTradeTemplates] = useState<NoteTemplate[]>([])
  const templateAppliedRef = useRef(false)
  // Task 179 — options multi-leg structure editor (visible when assetClass =
  // 'option'). Rows are strings for input ergonomics; aggregated on submit.
  const [legs, setLegs] = useState<LegRow[]>([])
  // Task 176 — onboarding: accounts can be empty (fresh journal). The modal used
  // to dead-end on an empty Select; now it offers inline first-account creation.
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [creatingAccount, setCreatingAccount] = useState(false)
  const [newAccount, setNewAccount] = useState({ name: '', type: 'stock', startingBalance: '10000' })
  // Task 10 — economic releases around the entry being journaled (advisory
  // context strip; null = not loaded / nothing relevant — the strip hides).
  const [econCtx, setEconCtx] = useState<EconCtxRow[] | null>(null)
  const [form, setForm] = useState({
    accountId: '',
    symbol: '',
    side: 'long',
    assetClass: 'stock',
    quantity: '',
    entryPrice: '',
    exitPrice: '',
    entryTime: '',
    exitTime: '',
    stopLoss: '',
    takeProfit: '',
    fees: '0',
    commission: '0',
    // Task 177 — derivatives contract multiplier (futures only; 1 = spot)
    multiplier: '1',
    setupId: '',
    rating: '3',
    notes: '',
    selectedTags: [] as string[],
    status: 'closed',
  })

  // TP2 Phase 5 — fetch the warnings (debounced) once a plan + system +
  // setup are chosen and the core values exist. Non-blocking by design.
  useEffect(() => {
    const ready =
      tpPlanId && tpSystemId && tpSetupId && form.accountId && form.symbol &&
      form.entryPrice !== '' && form.quantity !== '' && form.entryTime
    if (!ready) {
      setTpWarnings([])
      return
    }
    const timer = setTimeout(async () => {
      tpWarningsAbort.current?.abort()
      const ctl = new AbortController()
      tpWarningsAbort.current = ctl
      try {
        const res = await fetch('/api/trades/warnings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: ctl.signal,
          body: JSON.stringify({
            accountId: form.accountId,
            symbol: form.symbol,
            side: form.side,
            entryPrice: form.entryPrice,
            stopLoss: form.stopLoss || null,
            takeProfit: form.takeProfit || null,
            quantity: form.quantity,
            multiplier: form.multiplier || 1,
            entryTime: form.entryTime,
            timeframe: tpForm.timeframe || null,
            tradingPlanId: tpPlanId,
            systemId: tpSystemId,
            setupId: tpSetupId,
            ...(editingTradeId ? { excludeTradeId: editingTradeId } : {}),
          }),
        })
        if (!res.ok) return
        const data = await res.json()
        setTpWarnings(Array.isArray(data.warnings) ? data.warnings : [])
      } catch {
        /* aborted or offline — warnings stay as they were; never blocks */
      }
    }, 600)
    return () => clearTimeout(timer)
  }, [tpPlanId, tpSystemId, tpSetupId, form.accountId, form.symbol, form.side, form.entryPrice, form.stopLoss, form.takeProfit, form.quantity, form.multiplier, form.entryTime, tpForm.timeframe, editingTradeId])

  // Fetch supporting data
  useEffect(() => {
    if (isTradeModalOpen && accounts.length === 0 && !accountsLoaded) {
      Promise.all([
        fetch('/api/accounts').then((r) => r.json()),
        fetch('/api/setups').then((r) => r.json()),
        fetch('/api/trading-plans').then((r) => r.json().catch(() => ({ plans: [] }))),
      ]).then(([accData, setupData, tpData]) => {
        setAccounts(accData.accounts || [])
        setSetups(setupData.setups || [])
        setTags(setupData.tags || [])
        setTpPlans((tpData.plans || []).filter((p: any) => p.status !== 'archived'))
        setAccountsLoaded(true)
        if (accData.accounts?.[0]) {
          setForm((f) => ({ ...f, accountId: f.accountId || accData.accounts[0].id }))
        }
      })
    }
  }, [isTradeModalOpen, accounts.length, accountsLoaded])

  // Task 22-c — refresh the trade-note template list each time the modal
  // opens (localStorage-backed; cheap single read).
  useEffect(() => {
    if (isTradeModalOpen) setTradeTemplates(templatesForType('trade'))
  }, [isTradeModalOpen])

  // Task 10 — economic-release context: when the entry timestamp is set,
  // pull the synced releases around it (±12h window, high+medium, the
  // symbol's currencies) and classify each one's relation to the trade —
  // near (±45min of entry, the app-wide news-trade convention), during
  // (between entry and exit), ahead (open trade, within +4h). Debounced so
  // typing the datetime doesn't hammer the API; failures hide the strip.
  useEffect(() => {
    if (!isTradeModalOpen) {
      setEconCtx(null)
      return
    }
    const sym = form.symbol.trim().toUpperCase()
    if (!sym || !form.entryTime) {
      setEconCtx(null)
      return
    }
    const entry = new Date(form.entryTime)
    if (isNaN(entry.getTime())) {
      setEconCtx(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const from = new Date(entry.getTime() - 12 * 3_600_000).toISOString()
        const to = new Date(entry.getTime() + 12 * 3_600_000).toISOString()
        const res = await fetch(
          `/api/economic-calendar?from=${from}&to=${to}&impact=high,medium&limit=80`,
        )
        if (!res.ok) return
        const data = await res.json()
        const currencies = currenciesForSymbol(sym)
        const entryMs = entry.getTime()
        const exitMs = form.exitTime ? new Date(form.exitTime).getTime() : null
        const rows: EconCtxRow[] = (data.events || [])
          .filter((e: { currency: string }) => currencies.includes(e.currency))
          .map((e: { id: string; title: string; currency: string; impact: string; eventTime: string }) => {
            const t = new Date(e.eventTime).getTime()
            const absDistMin = Math.round(Math.abs(t - entryMs) / 60_000)
            let relation: EconCtxRow['relation'] | null = null
            if (absDistMin <= 45) relation = 'near'
            else if (exitMs && t > entryMs && t <= exitMs) relation = 'during'
            else if (!exitMs && t > entryMs && t - entryMs <= 4 * 3_600_000) relation = 'ahead'
            return { id: e.id, title: e.title, currency: e.currency, impact: e.impact, relation, distMin: absDistMin }
          })
          .filter((r): r is EconCtxRow => r.relation !== null)
          .sort((a, b) => impactRank(a.impact) - impactRank(b.impact) || a.distMin - b.distMin)
          .slice(0, 4)
        setEconCtx(rows)
      } catch {
        /* advisory strip only — API/transport issues just hide it */
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [isTradeModalOpen, form.symbol, form.entryTime, form.exitTime])

  // Task 22-c — "Insert template": put the chosen trade-note template's body
  // into the notes (replace when empty, append on a blank line otherwise).
  function insertTradeTemplate(id: string) {
    const tpl = tradeTemplates.find((t) => t.id === id)
    if (!tpl || !tpl.body) return
    setForm((f) => ({
      ...f,
      notes: f.notes.trim() === '' ? tpl.body : `${f.notes.replace(/\s+$/, '')}\n\n${tpl.body}`,
    }))
  }

  // Task 176 — create the first account inline (no dead-end at 0 accounts)
  async function handleCreateAccount() {
    if (!newAccount.name.trim()) {
      toast({ title: 'Account name required', variant: 'destructive' })
      return
    }
    setCreatingAccount(true)
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newAccount.name.trim(),
          type: newAccount.type,
          startingBalance: newAccount.startingBalance || 0,
        }),
      })
      if (!res.ok) throw new Error()
      const { account } = await res.json()
      setAccounts([account])
      setForm((f) => ({ ...f, accountId: account.id, assetClass: account.type || 'stock' }))
      queryClient.invalidateQueries({ queryKey: ['accounts'] })
      toast({ title: 'Account created', description: `${account.name} is ready — add your trade below.` })
    } catch {
      toast({ title: 'Failed to create account', variant: 'destructive' })
    } finally {
      setCreatingAccount(false)
    }
  }

  // Load existing trade for editing
  useEffect(() => {
    if (!isTradeModalOpen) return
    // Task 22-c — a fresh modal open re-arms the applied-template prefill.
    templateAppliedRef.current = false
    if (editingTradeId) {
      fetch(`/api/trades/${editingTradeId}`)
        .then((r) => r.json())
        .then(({ trade }) => {
          if (!trade) return
          setForm({
            accountId: trade.accountId,
            symbol: trade.symbol,
            side: trade.side,
            assetClass: trade.assetClass,
            quantity: String(trade.quantity),
            entryPrice: String(trade.entryPrice),
            exitPrice: trade.exitPrice ? String(trade.exitPrice) : '',
            entryTime: toLocalInput(trade.entryTime),
            exitTime: trade.exitTime ? toLocalInput(trade.exitTime) : '',
            stopLoss: trade.stopLoss ? String(trade.stopLoss) : '',
            takeProfit: trade.takeProfit ? String(trade.takeProfit) : '',
            fees: String(trade.fees),
            commission: String(trade.commission),
            multiplier: trade.multiplier ? String(trade.multiplier) : '1',
            setupId: trade.setupId || '',
            rating: String(trade.rating || 3),
            notes: trade.notes || '',
            selectedTags: trade.tags?.map((t: any) => t.tagId) || [],
            status: trade.status,
          })
          // Task 179 — prefill the structure editor from stored legs
          setLegs(
            (trade.legs || []).map((l: any): LegRow => ({
              legType: l.legType === 'put' ? 'put' : 'call',
              side: l.side === 'short' ? 'short' : 'long',
              quantity: String(l.quantity),
              strike: l.strike != null ? String(l.strike) : '',
              expiry: l.expiry ? String(l.expiry).slice(0, 10) : '',
              entryPrice: String(l.entryPrice),
              exitPrice: l.exitPrice != null ? String(l.exitPrice) : '',
            }))
          )
          // TP — prefill the plan link + rule-engine fields
          setTpPlanId(trade.tradingPlanId || '')
          setTpSystemId(trade.systemId || '')
          setTpSetupId(trade.setupId || '')
          setTpForm({
            timeframe: trade.timeframe || '',
            setupGrade: trade.setupGrade || '',
            entryNote: trade.entryNote || '',
            plannedRiskAmount: trade.plannedRiskAmount != null ? String(trade.plannedRiskAmount) : '',
          })
        })
    } else {
      // Task 15-W7 — missed-trade conversion ("Take this trade"): when the
      // modal is opened with a prefill (missed-trades page), seed the fresh
      // form with whatever the opportunity row knew. Read via getState() and
      // consume once, so reopening later starts clean.
      const pre = (useAppStore.getState().newTradePrefill ?? {}) as Record<string, unknown>
      const seed = (k: string): string | undefined => {
        const v = pre[k]
        return v == null || String(v) === '' ? undefined : String(v)
      }
      setForm((f) => ({
        ...f,
        symbol: seed('symbol') ?? '',
        side: seed('side') ?? f.side,
        quantity: '',
        entryPrice: seed('entryPrice') ?? '',
        exitPrice: '',
        exitTime: '',
        stopLoss: '',
        takeProfit: seed('takeProfit') ?? '',
        notes: seed('notes') ?? '',
        setupId: seed('setupId') ?? '',
        selectedTags: [],
        status: 'closed',
        entryTime: toLocalInput(new Date()),
        multiplier: '1',
      }))
      setMultTouched(false)
      setLegs([])
      // TP — fresh link state for a new trade
      // Task 15-W7 — consume-once: the prefill never survives a second open.
      useAppStore.getState().clearNewTradePrefill()
    }
  }, [isTradeModalOpen, editingTradeId])

  // Task 22-c — applied trade-notes template (Settings ▸ Notes, Plans & Rules ▸
  // Templates): prefill the notes of a NEW trade once per modal open — only
  // while they start empty (a missed-trade prefill wins) and NEVER in edit
  // mode. Runs after the init effect above (declaration order), and re-arms
  // when the settings row resolves late so the first paint of a fresh modal
  // never misses the template.
  useEffect(() => {
    if (!isTradeModalOpen || editingTradeId || templateAppliedRef.current) return
    const body = appliedTemplateBody('trade', settingsSlice(settingsRow, 'notesPlans'))
    if (body == null) return // nothing applied / settings not loaded yet — keep listening
    templateAppliedRef.current = true
    setForm((f) => (f.notes.trim() === '' ? { ...f, notes: body } : f))
  }, [isTradeModalOpen, editingTradeId, settingsRow])

  // Task 177 — auto-suggest the contract multiplier from the symbol while
  // the trader has not typed one themselves (create mode only).
  const multTouchedRef = useRef(false)
  const [multTouched, setMultTouched] = useState(false)
  const isFuturesForm = form.assetClass === 'future' || form.assetClass === 'futures'
  // Task 179 — options mode: the structure editor replaces the single-leg
  // price/qty fields as the source of truth for those rollups.
  const isOptionsForm = form.assetClass === 'option'
  useEffect(() => {
    if (!isOptionsForm || legs.length === 0) return
    const inputs = legs.map(toLegInput).filter((l): l is LegInput => l !== null)
    if (inputs.length !== legs.length || inputs.length === 0) return
    const agg = aggregateLegs(inputs)
    setForm((f) =>
      f.quantity === String(agg.quantity) && f.side === agg.netSide && Math.abs((parseFloat(f.entryPrice) || 0) - agg.avgEntry) < 1e-9
        ? f
        : { ...f, quantity: String(agg.quantity), side: agg.netSide, entryPrice: String(agg.avgEntry) }
    )
  }, [isOptionsForm, legs])
  useEffect(() => {
    if (editingTradeId || multTouchedRef.current) return
    const suggested = suggestMultiplier(form.symbol, form.assetClass)
    setForm((f) => (f.multiplier !== String(suggested) ? { ...f, multiplier: String(suggested) } : f))
  }, [form.symbol, form.assetClass, editingTradeId])

  // Loss-streak guardrail: fetch recent closed trades in create mode and
  // compute the current consecutive-loss streak (house rule >= 2 → half size)
  useEffect(() => {
    if (!isTradeModalOpen || editingTradeId) {
      setLossStreak(0)
      setHalfApplied(false)
      setFullQuantity('')
      return
    }
    let cancelled = false
    fetch('/api/trades?limit=15&status=closed')
      .then((r) => r.json())
      .then(({ trades }) => {
        if (cancelled || !Array.isArray(trades)) return
        const sorted = [...trades].sort((a: any, b: any) => {
          const ta = a.exitTime ? new Date(a.exitTime).getTime() : 0
          const tb = b.exitTime ? new Date(b.exitTime).getTime() : 0
          return tb - ta
        })
        let streak = 0
        for (const t of sorted) {
          if (t.pnl == null || t.pnl === 0) break
          if (t.pnl < 0) streak++
          else break
        }
        setLossStreak(streak)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [isTradeModalOpen, editingTradeId])

  function halveQuantity() {
    const qty = parseFloat(form.quantity)
    if (!isFinite(qty) || qty <= 0) return
    if (!halfApplied) setFullQuantity(form.quantity)
    const halved = qty / 2
    const pretty = Number.isInteger(halved) ? String(halved) : halved.toFixed(2)
    setForm((f) => ({ ...f, quantity: pretty }))
    setHalfApplied(true)
  }

  function restoreQuantity() {
    if (fullQuantity) setForm((f) => ({ ...f, quantity: fullQuantity }))
    setHalfApplied(false)
  }

  // Live P&L preview
  const previewPnL = (() => {
    const fees = parseFloat(form.fees) || 0
    const commission = parseFloat(form.commission) || 0
    // Task 179 — multi-leg: preview aggregates the structure
    if (isOptionsForm && legs.length > 0) {
      const inputs = legs.map(toLegInput).filter((l): l is LegInput => l !== null)
      if (inputs.length !== legs.length || inputs.length === 0) return null
      return aggregateLegs(inputs, fees, commission).netPnl
    }
    if (!form.entryPrice || !form.quantity) return null
    const entry = parseFloat(form.entryPrice)
    const qty = parseFloat(form.quantity)
    const exit = form.exitPrice ? parseFloat(form.exitPrice) : null
    if (exit === null) return null
    // Task 179 — include the contract multiplier (a GC=F preview used to show
    // $20 for a trade the server correctly saves as $2,000)
    const mult = isFuturesForm ? Number(form.multiplier) || 1 : 1
    const gross = form.side === 'long' ? (exit - entry) * qty * mult : (entry - exit) * qty * mult
    return gross - fees - commission
  })()

  async function handleSubmit() {
    // Task 179 — options mode: every leg needs quantity + entry premium
    if (isOptionsForm && legs.length > 0) {
      const bad = legs.filter((l) => !toLegInput(l))
      if (bad.length > 0) {
        toast({
          title: 'Incomplete leg row' + (bad.length > 1 ? 's' : ''),
          description: 'Every leg needs a quantity and an entry premium.',
          variant: 'destructive',
        })
        return
      }
    }
    if (!form.accountId || !form.symbol || !form.entryPrice || !form.quantity) {
      toast({
        title: 'Missing required fields',
        description: 'Account, symbol, entry price, and quantity are required.',
        variant: 'destructive',
      })
      return
    }
    setLoading(true)
    try {
      const payload: Record<string, unknown> = {
        ...form,
        exitPrice: form.exitPrice || null,
        // Task 177 — empty multiplier box falls back to 1 server-side
        multiplier: form.multiplier === '' ? null : Number(form.multiplier) || 1,
        entryTime: new Date(form.entryTime).toISOString(),
        // Task 176 — a closed trade with no exit time can't be bucketed by
        // session/hold analytics; default it to the entry time rather than
        // leaving a closed trade time-less.
        exitTime: form.exitTime
          ? new Date(form.exitTime).toISOString()
          : form.exitPrice
            ? new Date(form.entryTime).toISOString()
            : null,
        stopLoss: form.stopLoss || null,
        takeProfit: form.takeProfit || null,
        setupId: form.setupId || null,
        rating: form.rating || null,
        tagIds: form.selectedTags,
        status: form.status,
        // TP — rule-engine fields
        timeframe: tpForm.timeframe || null,
        setupGrade: (tpForm.setupGrade as 'A' | 'B') || null,
        entryNote: tpForm.entryNote || null,
        plannedRiskAmount: tpForm.plannedRiskAmount === '' ? null : Number(tpForm.plannedRiskAmount),
        // TP2 Phase 5 — what the warnings panel showed (logged server-side)
        ...(tpWarnings.length > 0 ? { warningsShown: tpWarnings } : {}),
        // TP — the plan link (creation path resolves + pins versions server-side)
        ...(!editingTradeId
          ? {
              tradingPlanId: tpPlanId || null,
              systemId: tpSystemId || null,
              setupId: tpSetupId || null,
            }
          : {}),
      }
      // Task 179 — ship the structure; the server recomputes every rollup
      if (isOptionsForm && legs.length > 0) {
        payload.legs = legs.map((l) => {
          const input = toLegInput(l)!
          return {
            ...input,
            symbol: form.symbol.toUpperCase(),
            entryTime: new Date(form.entryTime).toISOString(),
            exitTime: l.exitPrice !== '' && form.exitTime ? new Date(form.exitTime).toISOString() : null,
          }
        })
      }
      const res = await fetch(
        editingTradeId ? `/api/trades/${editingTradeId}` : '/api/trades',
        {
          method: editingTradeId ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }
      )
      if (!res.ok) throw new Error('Failed')
      // TP — edit path: apply the plan link through the link API when the
      // selection changed (creation already linked via the POST payload).
      if (editingTradeId) {
        const saved = await res.json().catch(() => null)
        const cur = saved?.trade
        if (
          (cur?.tradingPlanId || null) !== (tpPlanId || null) ||
          (cur?.systemId || null) !== (tpSystemId || null) ||
          (cur?.setupId || null) !== (tpSetupId || null)
        ) {
          const linkRes = await fetch(`/api/trades/${editingTradeId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tradingPlanId: tpPlanId || null, systemId: tpSystemId || null, setupId: tpSetupId || null }),
          }).catch(() => null)
          if (linkRes && !linkRes.ok) {
            const err = await linkRes.json().catch(() => null)
            toast({ title: 'Plan link not applied', description: err?.error || 'The link was rejected', variant: 'destructive' })
          }
        }
      }
      toast({
        title: editingTradeId ? 'Trade updated' : 'Trade added',
        description:
          isOptionsForm && legs.length > 0
            ? `${form.symbol} ${STRATEGY_LABELS[classifyStrategy(legs.map((l) => toLegInput(l)!))]}`
            : `${form.symbol} ${form.side} ${form.quantity} shares`,
      })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      queryClient.invalidateQueries({ queryKey: ['analytics'] })
      // Task 8-b — the calendar's ['calendar', …] query would otherwise keep
      // rendering the pre-edit grid until an unrelated refetch.
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      closeTradeModal()
    } catch (e) {
      toast({
        title: 'Error saving trade',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete() {
    if (!editingTradeId) return
    // Task 16-c — one stray click on the modal footer must not permanently
    // erase a trade AND its executions and screenshots (the cascades
    // the schema deletes). Same guard the trades table rows already use.
    if (
      !window.confirm(
        `Delete this trade${form.symbol ? ` (${form.symbol})` : ''}? Its executions and screenshots are deleted with it — this cannot be undone.`
      )
    )
      return
    setLoading(true)
    try {
      await fetch(`/api/trades/${editingTradeId}`, { method: 'DELETE' })
      toast({ title: 'Trade deleted' })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['trades'] })
      // Task 8-b — keep the calendar grid in sync on deletes too.
      queryClient.invalidateQueries({ queryKey: ['calendar'] })
      closeTradeModal()
    } catch {
      toast({ title: 'Delete failed', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={isTradeModalOpen} onOpenChange={(o) => !o && closeTradeModal()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editingTradeId ? 'Edit Trade' : 'Add New Trade'}
          </DialogTitle>
        </DialogHeader>
<DialogDescription className="sr-only">Create or edit a trade.</DialogDescription>

        {lossStreak >= 2 && !editingTradeId && (
          <div
            role="alert"
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5"
          >
            <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" />
            {halfApplied ? (
              <p className="text-xs text-amber-200/90 flex-1 min-w-[12rem]">
                Quantity halved per house rule — full size reserved for A+ setups only.
              </p>
            ) : (
              <p className="text-xs text-amber-200/90 flex-1 min-w-[12rem]">
                <span className="font-semibold">{lossStreak} losses in a row.</span> House rule:
                halve size until the first win to protect capital and break the tilt.
              </p>
            )}
            {halfApplied ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-amber-300 hover:text-amber-200 hover:bg-amber-500/15"
                onClick={restoreQuantity}
              >
                Restore full size
              </Button>
            ) : (
              <Button
                type="button"
                size="sm"
                className="h-7 px-2.5 text-xs bg-amber-500/90 hover:bg-amber-500 text-amber-950 font-semibold"
                onClick={halveQuantity}
                disabled={!form.quantity}
              >
                Halve quantity
              </Button>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="col-span-2">
            {accountsLoaded && accounts.length === 0 ? (
              /* Task 176 — first-run path: create the first account right here */
              <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <Plus className="h-4 w-4 text-primary" />
                  <p className="text-sm font-medium">Create your first trading account</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Trades belong to an account. Name it after your broker or book — you can add more later in Settings.
                </p>
                <div className="grid grid-cols-3 gap-2">
                  <Input
                    placeholder="e.g. Main, FTMO, Binance"
                    value={newAccount.name}
                    onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                  />
                  <Select value={newAccount.type} onValueChange={(v) => setNewAccount({ ...newAccount, type: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stock">Stocks</SelectItem>
                      <SelectItem value="forex">Forex</SelectItem>
                      <SelectItem value="crypto">Crypto</SelectItem>
                      <SelectItem value="futures">Futures</SelectItem>
                      <SelectItem value="options">Options</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input
                    type="number"
                    step="any"
                    placeholder="Starting balance"
                    value={newAccount.startingBalance}
                    onChange={(e) => setNewAccount({ ...newAccount, startingBalance: e.target.value })}
                  />
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="bg-emerald-600 hover:bg-emerald-700"
                  onClick={handleCreateAccount}
                  disabled={creatingAccount}
                >
                  {creatingAccount ? 'Creating…' : 'Create account & continue'}
                </Button>
              </div>
            ) : (
              <>
                <Label>Account</Label>
                <Select value={form.accountId} onValueChange={(v) => setForm({ ...form, accountId: v })}>
                  <SelectTrigger className="mt-1.5">
                    <SelectValue placeholder="Select account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-2 rounded-full" style={{ background: a.color }} />
                          {a.name}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </>
            )}
          </div>

          <div>
            <Label>Symbol</Label>
            <Input
              className="mt-1.5 uppercase"
              placeholder="AAPL"
              value={form.symbol}
              onChange={(e) => setForm({ ...form, symbol: e.target.value.toUpperCase() })}
            />
          </div>

          <div>
            <Label>Side</Label>
            <Select value={form.side} onValueChange={(v) => setForm({ ...form, side: v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="long">Long</SelectItem>
                <SelectItem value="short">Short</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>
              Quantity
              {isOptionsForm && legs.length > 0 && (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">auto from legs</span>
              )}
            </Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="100"
              value={form.quantity}
              readOnly={isOptionsForm && legs.length > 0}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
            />
          </div>

          {isFuturesForm && (
            <div>
              <Label>
                Contract Multiplier
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">
                  P&L = move × qty × multiplier
                </span>
              </Label>
              <Input
                className="mt-1.5"
                type="number"
                step="any"
                min="0.01"
                placeholder="100"
                value={form.multiplier}
                onChange={(e) => {
                  multTouchedRef.current = e.target.value !== ''
                  setMultTouched(e.target.value !== '')
                  setForm({ ...form, multiplier: e.target.value })
                }}
                title={
                  isKnownFuture(form.symbol)
                    ? `Auto-filled from the ${form.symbol} contract spec`
                    : 'Per-contract multiplier (e.g. GC=F: 100, ES=F: 50)'
                }
              />
              {isKnownFuture(form.symbol) && !multTouched && (
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Auto-detected from {form.symbol} contract spec — override if your broker differs.
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Asset Class</Label>
            <Select value={form.assetClass} onValueChange={(v) => setForm({ ...form, assetClass: v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="stock">Stock</SelectItem>
                <SelectItem value="option">Option</SelectItem>
                <SelectItem value="future">Future</SelectItem>
                <SelectItem value="forex">Forex</SelectItem>
                <SelectItem value="crypto">Crypto</SelectItem>
                <SelectItem value="index">Index</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Task 179 — multi-leg structure editor (options). Each leg is one
              contract row; the structure auto-classifies (vertical/straddle/
              strangle/iron condor/butterfly) and the trade-level rollups
              (qty / avg premium / net side / P&L preview) recompute live. */}
          {isOptionsForm && (
            <div className="col-span-2 space-y-2 rounded-lg border border-dashed p-3" data-testid="legs-editor">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium">
                  Structure legs
                  {(() => {
                    const inputs = legs.map(toLegInput).filter((l): l is LegInput => l !== null)
                    if (legs.length > 1 && inputs.length === legs.length) {
                      return (
                        <Badge variant="secondary" className="text-[10px]">
                          {STRATEGY_LABELS[classifyStrategy(inputs)]}
                        </Badge>
                      )
                    }
                    return null
                  })()}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setLegs((ls) => [...ls, emptyLeg()])}
                >
                  <Plus className="mr-1 h-3 w-3" /> Add leg
                </Button>
              </div>
              {legs.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Add legs to build a spread — vertical, straddle, strangle, iron condor, butterfly. Leave empty for a single-leg option (use the fields below).
                </p>
              ) : (
                <div className="space-y-2">
                  {legs.map((leg, i) => (
                    <div key={i} className="space-y-1.5 rounded-md border p-2">
                      <div className="grid grid-cols-12 gap-1.5">
                        <div className="col-span-3">
                          <Select
                            value={leg.legType}
                            onValueChange={(v) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, legType: v as 'call' | 'put' } : l)))}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="call">Call</SelectItem>
                              <SelectItem value="put">Put</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-3">
                          <Select
                            value={leg.side}
                            onValueChange={(v) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, side: v as 'long' | 'short' } : l)))}
                          >
                            <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="long">Buy</SelectItem>
                              <SelectItem value="short">Sell</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="col-span-2">
                          <Input className="h-8" type="number" step="any" min="0" placeholder="Qty" value={leg.quantity}
                            onChange={(e) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, quantity: e.target.value } : l)))} />
                        </div>
                        <div className="col-span-4">
                          <Input className="h-8" type="number" step="any" min="0" placeholder="Strike" value={leg.strike}
                            onChange={(e) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, strike: e.target.value } : l)))} />
                        </div>
                      </div>
                      <div className="grid grid-cols-12 gap-1.5">
                        <div className="col-span-4">
                          <Input className="h-8" type="date" title="Expiration" value={leg.expiry}
                            onChange={(e) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, expiry: e.target.value } : l)))} />
                        </div>
                        <div className="col-span-3">
                          <Input className="h-8" type="number" step="any" min="0" placeholder="Entry premium" value={leg.entryPrice}
                            onChange={(e) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, entryPrice: e.target.value } : l)))} />
                        </div>
                        <div className="col-span-3">
                          <Input className="h-8" type="number" step="any" min="0" placeholder="Exit premium" value={leg.exitPrice}
                            onChange={(e) => setLegs((ls) => ls.map((l, j) => (j === i ? { ...l, exitPrice: e.target.value } : l)))} />
                        </div>
                        <div className="col-span-2">
                          <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-400"
                            onClick={() => setLegs((ls) => ls.filter((_, j) => j !== i))}
                            aria-label={`Remove leg ${i + 1}`}>
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                  {(() => {
                    const inputs = legs.map(toLegInput).filter((l): l is LegInput => l !== null)
                    if (inputs.length !== legs.length || inputs.length === 0) return null
                    const agg = aggregateLegs(inputs)
                    const unitBase = inputs.reduce((a, l) => a + l.quantity * (l.multiplier ?? 1), 0)
                    const perUnit = unitBase > 0 ? agg.netPremium / unitBase : 0
                    return (
                      <p className="text-[11px] text-muted-foreground">
                        {perUnit >= 0 ? 'Net debit' : 'Net credit'} {formatCurrency(Math.abs(perUnit), 'USD')}/contract
                        {agg.closed ? ` · projected ${agg.netPnl >= 0 ? '+' : ''}${formatCurrency(agg.netPnl, 'USD')}` : ' · structure still open'}
                      </p>
                    )
                  })()}
                </div>
              )}
            </div>
          )}

          <div>
            <Label>
              Entry Price
              {isOptionsForm && legs.length > 0 && (
                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground">avg premium</span>
              )}
            </Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="0.00"
              value={form.entryPrice}
              readOnly={isOptionsForm && legs.length > 0}
              onChange={(e) => setForm({ ...form, entryPrice: e.target.value })}
            />
          </div>

          <div>
            <Label>Exit Price</Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="Leave empty for open"
              value={form.exitPrice}
              onChange={(e) => setForm({ ...form, exitPrice: e.target.value })}
            />
          </div>

          <div>
            <Label>Entry Time</Label>
            <Input
              className="mt-1.5"
              type="datetime-local"
              value={form.entryTime}
              onChange={(e) => setForm({ ...form, entryTime: e.target.value })}
            />
          </div>

          <div>
            <Label>Exit Time</Label>
            <Input
              className="mt-1.5"
              type="datetime-local"
              value={form.exitTime}
              onChange={(e) => setForm({ ...form, exitTime: e.target.value })}
            />
          </div>

          {/* Task 10 — economic-release context for the entry being journaled:
              releases near/during/ahead of the trade for the symbol's
              currencies. Rendered only when relevant releases exist in the
              synced feed — honest absence otherwise. */}
          {econCtx && econCtx.length > 0 && (
            <div className="col-span-2" data-testid="trade-modal-econ-context">
              <div className="rounded-lg border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-amber-400/90">
                  <Zap className="h-3 w-3" aria-hidden />
                  Economic releases around this entry
                </p>
                <div className="mt-1.5 space-y-1">
                  {econCtx.map((r) => (
                    <div key={r.id} className="flex items-center gap-2 text-[11px]" title={`${r.title} · ${r.currency} · ${r.impact} impact`}>
                      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', ECON_DOT_CLS[r.impact] ?? 'bg-slate-400')} aria-label={`${r.impact} impact`} />
                      <span className="shrink-0 rounded border border-border px-1 text-[9px] font-bold text-muted-foreground">
                        {r.currency === 'ALL' ? '🌍' : r.currency}
                      </span>
                      <span className="min-w-0 truncate font-medium">{r.title}</span>
                      <span className="ml-auto shrink-0 text-muted-foreground tnum">
                        {r.relation === 'near' && (
                          <span className="font-semibold text-amber-400">{r.distMin}m from entry</span>
                        )}
                        {r.relation === 'during' && <span>during trade</span>}
                        {r.relation === 'ahead' && <span>after entry</span>}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="mt-1.5 text-[9px] text-muted-foreground/70">
                  Synced ForexFactory feed — the trade's news context is auto-linked on save.
                </p>
              </div>
            </div>
          )}

          <div>
            <Label>Stop Loss</Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="0.00"
              value={form.stopLoss}
              onChange={(e) => setForm({ ...form, stopLoss: e.target.value })}
            />
          </div>

          <div>
            <Label>Take Profit</Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="0.00"
              value={form.takeProfit}
              onChange={(e) => setForm({ ...form, takeProfit: e.target.value })}
            />
          </div>

          <div>
            <Label>Fees</Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="0.00"
              value={form.fees}
              onChange={(e) => setForm({ ...form, fees: e.target.value })}
            />
          </div>

          <div>
            <Label>Commission</Label>
            <Input
              className="mt-1.5"
              type="number"
              step="any"
              placeholder="0.00"
              value={form.commission}
              onChange={(e) => setForm({ ...form, commission: e.target.value })}
            />
          </div>

          <div>
            <Label>Setup</Label>
            <Select value={form.setupId} onValueChange={(v) => setForm({ ...form, setupId: v === 'none' ? '' : v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue placeholder="Select setup" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {setups.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-2 rounded-full" style={{ background: s.color }} />
                      {s.name}
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>Rating</Label>
            <Select value={form.rating} onValueChange={(v) => setForm({ ...form, rating: v })}>
              <SelectTrigger className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[1, 2, 3, 4, 5].map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {'★'.repeat(r)}{'☆'.repeat(5 - r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-2">
            <Label>Tags</Label>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {tags.map((tag) => {
                const sel = form.selectedTags.includes(tag.id)
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setForm({
                        ...form,
                        selectedTags: sel
                          ? form.selectedTags.filter((t) => t !== tag.id)
                          : [...form.selectedTags, tag.id],
                      })
                    }
                    className={`text-xs px-2 py-1 rounded-md border transition-all ${
                      sel
                        ? 'border-transparent text-white'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                    style={sel ? { background: tag.color } : {}}
                  >
                    {tag.name}
                  </button>
                )
              })}
            </div>
          </div>

          {/* TP — the plan link: plan → system → setup. The versions in force
              at entry are resolved and pinned server-side. */}
          <div className="col-span-2" data-testid="tp-link-step">
            <Label>Plan link (versioned)</Label>
            <div className="mt-1.5 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Select
                value={tpPlanId || 'none'}
                onValueChange={(v) => {
                  setTpPlanId(v === 'none' ? '' : v)
                  setTpSystemId('')
                  setTpSetupId('')
                }}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="No plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No plan (unlinked)</SelectItem>
                  {tpPlans.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: p.color }} />
                        {p.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tpSystemId || 'none'}
                onValueChange={(v) => {
                  setTpSystemId(v === 'none' ? '' : v)
                  setTpSetupId('')
                }}
                disabled={!tpPlanId || tpSystems.length === 0}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={tpPlanId ? (tpSystems.length ? 'System…' : 'No systems') : 'Pick a plan first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No system</SelectItem>
                  {tpSystems.map((sy) => (
                    <SelectItem key={sy.id} value={sy.id}>{sy.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={tpSetupId || 'none'}
                onValueChange={(v) => setTpSetupId(v === 'none' ? '' : v)}
                disabled={!tpSystemId || (tpSystems.find((sy) => sy.id === tpSystemId)?.setups.length || 0) === 0}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder={tpSystemId ? (tpSystems.find((sy) => sy.id === tpSystemId)?.setups.length ? 'Setup…' : 'No setups in system') : 'Pick a system first'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No setup</SelectItem>
                  {(tpSystems.find((sy) => sy.id === tpSystemId)?.setups || []).map((st) => (
                    <SelectItem key={st.id} value={st.id}>{st.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {tpPlanId && (
              <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">Timeframe</Label>
                  <Input
                    className="h-8 mt-1 text-xs"
                    placeholder="e.g. 5m"
                    value={tpForm.timeframe}
                    onChange={(e) => setTpForm((f) => ({ ...f, timeframe: e.target.value }))}
                    data-testid="tp-timeframe"
                  />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Setup grade</Label>
                  <Select value={tpForm.setupGrade || 'none'} onValueChange={(v) => setTpForm((f) => ({ ...f, setupGrade: v === 'none' ? '' : v }))}>
                    <SelectTrigger className="h-8 mt-1 text-xs">
                      <SelectValue placeholder="—" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="A">A</SelectItem>
                      <SelectItem value="B">B</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">Planned risk</Label>
                  <Input
                    className="h-8 mt-1 text-xs"
                    type="number"
                    step="any"
                    placeholder="amount"
                    value={tpForm.plannedRiskAmount}
                    onChange={(e) => setTpForm((f) => ({ ...f, plannedRiskAmount: e.target.value }))}
                  />
                </div>
                <div className="col-span-2 sm:col-span-1">
                  <Label className="text-[10px] text-muted-foreground">Entry note</Label>
                  <Input
                    className="h-8 mt-1 text-xs"
                    placeholder="written at entry"
                    value={tpForm.entryNote}
                    onChange={(e) => setTpForm((f) => ({ ...f, entryNote: e.target.value }))}
                    data-testid="tp-entry-note"
                  />
                </div>
              </div>
            )}
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              The link pins the plan, system and setup versions in force at this trade&apos;s entry — it can be changed later, and every change is kept in history.
            </p>
            {/* TP2 Phase 5 — the plan warnings: non-blocking lines from the
                facts helper + the plan's number fields. No boxes, no gating. */}
            {tpWarnings.length > 0 && (
              <div
                className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5"
                data-testid="tp-warnings"
                role="status"
                aria-live="polite"
              >
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-500">
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Plan warnings — the trade can still be saved
                </div>
                <ul className="mt-1.5 space-y-1">
                  {tpWarnings.map((w, i) => (
                    <li key={`${w.kind}-${i}`} className="text-xs text-amber-600 dark:text-amber-400">
                      <span className="mr-1" aria-hidden>·</span>
                      {w.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

          </div>

          <div className="col-span-2">
            <div className="flex items-center justify-between gap-2">
              <Label>Notes</Label>
              {/* Task 22-c — Insert template (trade-note templates; hidden
                  entirely when none exist). Sentinel-controlled select: the
                  value never matches an item, so every pick re-fires and the
                  trigger keeps its placeholder label. */}
              {tradeTemplates.length > 0 ? (
                <Select value="" onValueChange={insertTradeTemplate}>
                  <SelectTrigger
                    className="h-7 w-[190px] text-xs"
                    aria-label="Insert template into notes"
                    data-testid="trade-notes-template"
                  >
                    <SelectValue placeholder="Insert template…" />
                  </SelectTrigger>
                  <SelectContent>
                    {tradeTemplates.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                        {t.isDefault ? (
                          <Badge variant="outline" className="ml-1.5 text-[10px]">
                            default
                          </Badge>
                        ) : null}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null}
            </div>
            <Textarea
              className="mt-1.5"
              rows={3}
              placeholder="What was your thesis? What did you learn?"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>

          {previewPnL !== null && (
            <div className="col-span-2 p-3 rounded-md bg-muted/40 border border-border flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Calculated P&L</span>
              <FitValue
                className={`text-lg font-bold tnum text-right ${previewPnL >= 0 ? 'text-emerald-400' : 'text-red-400'}`}
                origin="right"
              >
                {previewPnL >= 0 ? '+' : ''}{formatCurrency(previewPnL)}
              </FitValue>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          {editingTradeId && (
            <Button variant="destructive" onClick={handleDelete} disabled={loading} className="mr-auto">
              Delete
            </Button>
          )}
          <Button variant="outline" onClick={closeTradeModal} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading} className="bg-emerald-600 hover:bg-emerald-700">
            {loading ? 'Saving...' : editingTradeId ? 'Update Trade' : 'Add Trade'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function toLocalInput(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}
