import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

/**
 * TP2 — POST /api/trading-plans/migrate
 * Reports whether the Imported plan exists (and runs the server-side
 * migration when missing — see scripts/migrate-trading-plans.ts).
 *
 * The old `rules` body (localStorage cadence rules → projected process-rule
 * rows) was removed with the rules engine: the weekly/monthly rules now live
 * in the plan content itself and are read by the review endpoints from the
 * published version. Old clients that still POST a `rules` body get a 410
 * hint so they stop retrying.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const body = await req.json().catch(() => ({}))
    const dryRun = body.dryRun === true

    if (body.rules) {
      return NextResponse.json(
        {
          error: 'rules-migration-removed',
          hint: 'Cadence rules are part of the plan content now — add them in the plan editor (section 6.6/5.3).',
        },
        { status: 410 },
      )
    }

    const imported = await db.tradingPlan.findFirst({
      where: { userId: user.id, isImported: true },
      include: { currentVersion: true },
    })

    return NextResponse.json({
      dryRun,
      importedPlanExists: !!imported,
      importedPlanId: imported?.id ?? null,
      currentVersionNo: imported?.currentVersion?.versionNo ?? null,
    })
  } catch (e) {
    console.error('Error in src/app/api/trading-plans/migrate/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
