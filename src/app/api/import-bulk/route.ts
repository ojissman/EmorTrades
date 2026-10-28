import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { autoAttachNewsToTrade } from '../trade-news/route'
import { suggestMultiplier } from '@/lib/contracts'
import { recordStopChange } from '@/lib/plan-link'
import { writeManifest, type ImportManifest } from '@/lib/import/store'
import type { RowOutcome } from '@/lib/import/types'

export const dynamic = 'force-dynamic'

interface BulkTrade {
  symbol: string
  side: 'long' | 'short'
  quantity: number
  entryPrice: number
  exitPrice: number | null
  entryTime: string
  exitTime: string | null
  fees: number
  commission: number
  swap?: number
  stopLoss?: number | null
  takeProfit?: number | null
  multiplier?: number
  pnl: number
  status: 'open' | 'closed'
  notes?: string
}

interface ImportSource {
  fileToken?: string
  fileName?: string
  detectedFormat?: string
  engine?: string
  mappingSource?: string
  timezoneMinutes?: number
}

// POST /api/import-bulk - Bulk import trades with duplicate detection
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { accountId, trades, skipDuplicates = true, source } = body as {
      accountId: string
      trades: BulkTrade[]
      skipDuplicates?: boolean
      source?: ImportSource
    }

    const user = await db.user.findFirst()
    if (!user) {
      return NextResponse.json({ error: 'No user found' }, { status: 404 })
    }

    if (!accountId) {
      return NextResponse.json({ error: 'Account ID required' }, { status: 400 })
    }

    // Task 176 — the destination account must exist and belong to the user;
    // its type also drives the imported trades' assetClass (previously
    // hardcoded 'stock' — wrong for forex/crypto/futures imports).
    const account = await db.account.findFirst({ where: { id: accountId, userId: user.id } })
    if (!account) {
      return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const assetClass = account.type || 'stock'

    if (!trades || !Array.isArray(trades) || trades.length === 0) {
      return NextResponse.json({ error: 'No trades to import' }, { status: 400 })
    }

    // Fetch existing trades for duplicate detection
    const existingTrades = await db.trade.findMany({
      where: { userId: user.id, accountId },
      select: { symbol: true, entryTime: true, exitTime: true, quantity: true, entryPrice: true, side: true },
    })

    // TASK-Tradesviz — idempotency hash includes side, per spec:
    // hash(account, symbol, time, qty, price, side). A long and a short with
    // otherwise identical parameters are genuinely different trades.
    const existingKeys = new Set(
      existingTrades.map((t) => {
        const entryKey = new Date(t.entryTime).getTime()
        const exitKey = t.exitTime ? new Date(t.exitTime).getTime() : 0
        return `${t.symbol}-${entryKey}-${exitKey}-${t.quantity}-${t.entryPrice}-${t.side}`
      })
    )

    const inserted: any[] = []
    const skipped: any[] = []
    const errors: any[] = []

    // Insert trades in batches of 10 to avoid overwhelming the DB
    for (let i = 0; i < trades.length; i++) {
      const t = trades[i]
      try {
        // Validation (Task 176 — reject NaN / non-positive instead of persisting garbage)
        const qty = Number(t.quantity)
        const entryP = Number(t.entryPrice)
        const exitP = t.exitPrice === null || t.exitPrice === undefined ? null : Number(t.exitPrice)
        if (!t.symbol || !Number.isFinite(entryP) || !Number.isFinite(qty) || entryP <= 0 || qty <= 0) {
          errors.push({ index: i, symbol: t.symbol, error: 'Missing or invalid required fields (symbol, quantity > 0, entryPrice > 0)' })
          continue
        }
        if (exitP !== null && (!Number.isFinite(exitP) || exitP <= 0)) {
          errors.push({ index: i, symbol: t.symbol, error: 'Invalid exit price' })
          continue
        }
        t.quantity = qty
        t.entryPrice = entryP
        if (exitP !== null) t.exitPrice = exitP
        t.fees = Number.isFinite(Number(t.fees)) ? Number(t.fees) : 0
        t.commission = Number.isFinite(Number(t.commission)) ? Number(t.commission) : 0
        if (!Number.isFinite(Number(t.pnl))) t.pnl = 0
        // Task 177 — contract multiplier: explicit column wins, else inferred
        // from the symbol's futures contract (GC=F -> 100, stocks stay 1)
        const mult =
          Number.isFinite(Number(t.multiplier)) && Number(t.multiplier) > 0
            ? Number(t.multiplier)
            : suggestMultiplier(String(t.symbol), assetClass)

        const entryTime = new Date(t.entryTime)
        const exitTime = t.exitTime ? new Date(t.exitTime) : null

        // Duplicate check
        if (skipDuplicates) {
          const entryKey = entryTime.getTime()
          const exitKey = exitTime ? exitTime.getTime() : 0
          const key = `${t.symbol.toUpperCase()}-${entryKey}-${exitKey}-${t.quantity}-${t.entryPrice}-${t.side}`
          if (existingKeys.has(key)) {
            skipped.push({ index: i, symbol: t.symbol, reason: 'duplicate' })
            continue
          }
          existingKeys.add(key)
        }

        // Calculate P&L if not provided
        let pnl = t.pnl || 0
        let pnlPercent = 0
        let rMultiple: number | null = null

        if (t.exitPrice !== null && t.exitPrice !== undefined) {
          const grossPnl =
            (t.side === 'long'
              ? t.exitPrice - t.entryPrice
              : t.entryPrice - t.exitPrice) *
            t.quantity *
            mult
          const totalFees = (t.fees || 0) + (t.commission || 0)
          if (!t.pnl) {
            pnl = +(grossPnl - totalFees).toFixed(2)
          }
          pnlPercent = +(
            ((t.exitPrice - t.entryPrice) / t.entryPrice) *
            100 *
            (t.side === 'long' ? 1 : -1)
          ).toFixed(2)

          if (t.stopLoss) {
            const risk = Math.abs(t.entryPrice - t.stopLoss)
            const reward =
              t.side === 'long' ? t.exitPrice - t.entryPrice : t.entryPrice - t.exitPrice
            rMultiple = risk > 0 ? +(reward / risk).toFixed(2) : null
          }
        }

        let holdingPeriod: number | null = null
        if (exitTime && entryTime) {
          holdingPeriod = Math.round((exitTime.getTime() - entryTime.getTime()) / 60000)
        }

        const stopLoss = t.stopLoss ? parseFloat(String(t.stopLoss)) : null

        const trade = await db.trade.create({
          data: {
            userId: user.id,
            accountId,
            symbol: t.symbol.toUpperCase(),
            side: t.side,
            assetClass,
            multiplier: mult,
            quantity: t.quantity,
            entryPrice: t.entryPrice,
            exitPrice: t.exitPrice ?? null,
            entryTime,
            exitTime,
            stopLoss,
            takeProfit: t.takeProfit ? parseFloat(String(t.takeProfit)) : null,
            fees: t.fees,
            commission: t.commission,
            pnl,
            pnlPercent,
            rMultiple,
            status: t.status || (t.exitPrice ? 'closed' : 'open'),
            notes: t.notes || null,
            holdingPeriod,
          },
        })

        // Also create executions for this trade (entry + exit)
        await db.execution.create({
          data: {
            userId: user.id,
            accountId,
            tradeId: trade.id,
            symbol: t.symbol.toUpperCase(),
            side: t.side === 'long' ? 'buy' : 'sell',
            quantity: parseFloat(String(t.quantity)),
            price: parseFloat(String(t.entryPrice)),
            timestamp: entryTime,
            fees: parseFloat(String(t.fees || 0)) / 2,
            commission: parseFloat(String(t.commission || 0)) / 2,
          },
        })
        if (exitTime && t.exitPrice) {
          await db.execution.create({
            data: {
              userId: user.id,
              accountId,
              tradeId: trade.id,
              symbol: t.symbol.toUpperCase(),
              side: t.side === 'long' ? 'sell' : 'buy',
              quantity: parseFloat(String(t.quantity)),
              price: parseFloat(String(t.exitPrice)),
              timestamp: exitTime,
              fees: parseFloat(String(t.fees || 0)) / 2,
              commission: parseFloat(String(t.commission || 0)) / 2,
            },
          })
        }

        // TP-7-l — an imported stop is the trade's INITIAL stop: append the
        // append-only TradeStopEvent (source='import') and stamp
        // initialStopLoss/stopSetAt, mirroring the trades POST create-with-stop
        // path (tpPostCreate). setAt is the trade's entryTime — the honest
        // time the file records for the stop — falling back to now when the
        // row carries no usable time. previousStop is passed explicitly as null
        // because the row was just created holding the NEW stop (the
        // recordStopChange contract — re-reading the row would no-op). A
        // failure here never fails the imported row (the trade itself is
        // already saved); it logs, same as tpPostCreate. Idempotency: this
        // runs ONLY on the created path — re-imported rows are caught by the
        // duplicate check above and skipped before reaching this point, so
        // re-importing a file never duplicates stop events. The route has no
        // update-existing-trades path (dedupe skips, never upserts); if an
        // upsert ever lands, its changed-stop branch should call
        // recordStopChange(userId, tradeId, next, 'import', previous) with note
        // 'stop updated by import' — the unchanged case is a no-op there by
        // design.
        if (stopLoss !== null) {
          const stopSetAt = !Number.isNaN(entryTime.getTime()) ? entryTime : new Date()
          try {
            await recordStopChange(
              user.id,
              trade.id,
              stopLoss,
              'import',
              null,
              stopSetAt,
              'stop imported with trade',
            )
          } catch (e) {
            console.error('TP import stop event failed for trade', trade.id, e)
          }
        }

        inserted.push(trade)

        // Auto-attach economic news for this trade's date
        // This runs asynchronously - won't block the import
        autoAttachNewsToTrade(trade.id).catch((e) => {
          console.error('Failed to auto-attach news for trade', trade.id, e)
        })
      } catch (e: any) {
        errors.push({ index: i, error: e.message })
      }
    }

    // TASK-Tradesviz — retention manifest: what was imported, from which
    // file, with which mapping — so rows can be re-parsed after a bug fix.
    if (source?.fileToken || source?.fileName) {
      try {
        const outcomes: RowOutcome[] = []
        for (const s of skipped.slice(0, 500)) {
          outcomes.push({
            rowIndex: s.index,
            symbol: String(s.symbol ?? ''),
            status: 'skipped',
            reason: String(s.reason ?? 'duplicate'),
          })
        }
        for (const e of errors.slice(0, 500)) {
          outcomes.push({
            rowIndex: e.index,
            symbol: String(e.symbol ?? ''),
            status: 'skipped',
            reason: String(e.error ?? 'invalid'),
          })
        }
        const manifest: ImportManifest = {
          storedAt: new Date().toISOString(),
          originalName: source.fileName ?? 'unknown',
          storedName: `upload-${(source.fileToken ?? '').slice(0, 16)}__${(source.fileName ?? 'unknown').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 120)}`,
          sha256: source.fileToken ?? '',
          sizeBytes: 0,
          detectedFormat: source.detectedFormat ?? '',
          engine: source.engine ?? '',
          mappingSource: source.mappingSource,
          timezoneMinutes: source.timezoneMinutes,
          accountId,
          importedTrades: inserted.length,
          outcomes,
        }
        await writeManifest(manifest)
      } catch (err) {
        console.error('import manifest write failed:', err)
      }
    }

    return NextResponse.json({
      success: true,
      inserted: inserted.length,
      skipped: skipped.length,
      errors: errors.length,
      skippedDetails: skipped.slice(0, 10),
      errorDetails: errors.slice(0, 10),
      totalProvided: trades.length,
      newsAutoAttached: true,
    })
  } catch (e: any) {
    console.error('POST /api/import-bulk error:', e)
    return NextResponse.json(
      { error: 'Failed to import trades', message: e.message },
      { status: 500 }
    )
  }
}
