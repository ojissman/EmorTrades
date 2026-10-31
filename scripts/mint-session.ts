/**
 * Mint a session cookie for E2E testing (admin demo@emortrades.com by default).
 * Usage: bun /home/z/my-project/scripts/mint-session.ts [email]
 */
import { createHmac } from 'crypto'
import { db } from '../src/lib/db'

const email = process.argv[2] || 'demo@emortrades.com'
const user = await db.user.findUnique({ where: { email } })
if (!user) {
  console.error('user not found:', email)
  process.exit(1)
}
const secret = process.env.AUTH_SECRET!
const now = Math.floor(Date.now() / 1000)
const payload = { uid: user.id, iat: now, exp: now + 30 * 86400 }
const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
const sig = createHmac('sha256', secret).update(body).digest('base64url')
console.log(`v1.${body}.${sig}`)
process.exit(0)
