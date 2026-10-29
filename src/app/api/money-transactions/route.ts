import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// Task 148 — L2 money transactions: deposits/withdrawals that link cash
// activity into the equity curve (broker imports bring trades only).

export async function GET() {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    const transactions = await db.moneyTransaction.findMany({
      where: { userId: user.id },
      include: { account: true },
      orderBy: { date: 'desc' },
    })
    return NextResponse.json({ transactions })
  } catch (e) {
    console.error('Error in src/app/api/money-transactions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const type = body.type === 'withdrawal' ? 'withdrawal' : 'deposit'
    const amount = parseFloat(body.amount)
    if (!body.accountId || !Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'accountId and amount > 0 are required' }, { status: 400 })
    }
    const date = body.date ? new Date(body.date) : null
    if (!date || isNaN(date.getTime())) {
      return NextResponse.json({ error: 'Valid date required' }, { status: 400 })
    }
    // Ownership: the transaction can only land on one of the user's accounts.
    const account = await db.account.findFirst({ where: { id: body.accountId, userId: user.id } })
    if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

    const transaction = await db.moneyTransaction.create({
      data: {
        userId: user.id,
        accountId: body.accountId,
        type,
        amount,
        date,
        currency: body.currency || 'USD',
        notes: body.notes || null,
      },
    })
    return NextResponse.json({ transaction })
  } catch (e) {
    console.error('Error in src/app/api/money-transactions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })
    if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    // Verify ownership
    const existing = await db.moneyTransaction.findFirst({
      where: { id: body.id, userId: user.id },
    })
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

    const type = body.type === 'withdrawal' ? 'withdrawal' : 'deposit'
    const amount = parseFloat(body.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      return NextResponse.json({ error: 'amount must be > 0' }, { status: 400 })
    }
    if (body.accountId && body.accountId !== existing.accountId) {
      const account = await db.account.findFirst({ where: { id: body.accountId, userId: user.id } })
      if (!account) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    }
    const date = body.date ? new Date(body.date) : null
    if (!date || isNaN(date.getTime())) {
      return NextResponse.json({ error: 'Valid date required' }, { status: 400 })
    }

    const transaction = await db.moneyTransaction.update({
      where: { id: existing.id },
      data: {
        accountId: body.accountId || existing.accountId,
        type,
        amount,
        date,
        currency: body.currency || 'USD',
        notes: body.notes || null,
      },
    })
    return NextResponse.json({ transaction })
  } catch (e) {
    console.error('Error in src/app/api/money-transactions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    // Verify ownership
    const existing = await db.moneyTransaction.findFirst({
      where: { id, userId: user.id },
    })
    if (!existing) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })

    await db.moneyTransaction.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('Error in src/app/api/money-transactions/route.ts:', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
