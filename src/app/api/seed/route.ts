import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'

export const dynamic = 'force-dynamic'

// Returns current demo user info
export async function GET() {
  try {
    const auth = await requireUser({
      select: {
        id: true,
        name: true,
        email: true,
        startingCapital: true,
        riskPerTrade: true,
        timezone: true,
        defaultCurrency: true,
      },
    })
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) {
      return NextResponse.json({ user: null })
    }
    return NextResponse.json({ user })
  } catch (e) {
    console.error("Error in src/app/api/seed/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
