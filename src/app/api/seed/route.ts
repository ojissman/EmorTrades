import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// Returns current demo user info
export async function GET() {
  try {
    const user = await db.user.findFirst({
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
    if (!user) {
      return NextResponse.json({ user: null })
    }
    return NextResponse.json({ user })
  } catch (e) {
    console.error("Error in src/app/api/seed/route.ts:", e)
    return NextResponse.json ({ error: 'Failed' }, { status: 500 })
  }
}
