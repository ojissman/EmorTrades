import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireUser } from '@/lib/server/auth'
import { generateConnectorToken, hashConnectorToken, tokenDisplayPrefix } from '@/lib/connector/tokens'

export const dynamic = 'force-dynamic'

/**
 * CONNECT-1 token rotation (POST /api/connections/[id]/token).
 *
 * Revokes the connection's active tokens and issues a fresh one (returned
 * exactly once). The old EA session dies on its next request (401); the user
 * re-enters the new token in the EA input. Connection identity, history and
 * the journal account are untouched — rotation is purely a credential change.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireUser()
    if (!auth.ok) return auth.response
    const user = auth.user
    if (!user) return NextResponse.json({ error: 'No user' }, { status: 404 })

    const { id } = await params
    const c = await db.platformConnection.findFirst({
      where: { id, userId: user.id },
      select: { id: true, platform: true },
    })
    if (!c) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const now = new Date()
    await db.connectorToken.updateMany({
      where: { connectionId: c.id, status: 'active' },
      data: { status: 'revoked', revokedAt: now },
    })
    const rawToken = generateConnectorToken()
    await db.connectorToken.create({
      data: {
        userId: user.id,
        connectionId: c.id,
        platform: c.platform,
        tokenHash: hashConnectorToken(rawToken),
        prefix: tokenDisplayPrefix(rawToken),
      },
    })
    await db.platformConnection.update({
      where: { id: c.id },
      data: { updatedAt: now },
    })

    return NextResponse.json({ token: rawToken, tokenPrefix: tokenDisplayPrefix(rawToken) })
  } catch {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
