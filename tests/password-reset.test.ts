/**
 * PASSWORD RESET (LAND-1) — the forgot/reset flow, end to end at the unit and
 * route level against a real (temp) database:
 *
 *   Tokens     single-use · purpose-checked · re-issue consumes the old one
 *              · expiry enforced
 *   Epoch      sessionInvalidatedBy matrix · second-floored epoch helper
 *   Routes     forgot: anti-enumeration (unknown/google-only → same generic
 *              answer, no devLink), real account → dev delivery link
 *              reset: happy path (hash changed, epoch set, token consumed),
 *              unknown token, short password, replay
 *
 * ENV NOTES (observed, not assumed):
 *   · Prisma Client's runtime auto-loads .env at construction and RESTORES
 *     unset keys — so the env scrub (PUBLIC_ORIGIN etc.) must happen AFTER
 *     the db module import, or pins resurrect mid-test.
 *   · The in-memory rate limiter is shared per worker: every test sends with
 *     a UNIQUE x-forwarded-for so the 3/10-min forgot limit never bleeds
 *     between tests.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { PrismaClient } from '@prisma/client'

function jsonReq(body: unknown, ip: string) {
  return new Request('http://localhost:3000/api/auth/forgot-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  })
}

/** Token out of any devLink, whatever origin the pin resolved to. */
function tokenFrom(devLink: string): string {
  const m = devLink.match(/reset=([0-9a-f]{64})/)
  if (!m) throw new Error(`devLink has no reset token: ${devLink}`)
  return m[1]
}

describe('password reset — LAND-1', () => {
  let dir: string
  let db: PrismaClient
  let resetLib: typeof import('@/lib/server/password-reset')
  let verifyLib: typeof import('@/lib/server/verification')
  let authLib: typeof import('@/lib/server/auth')
  let forgotRoute: typeof import('@/app/api/auth/forgot-password/route')
  let resetRoute: typeof import('@/app/api/auth/reset-password/route')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'pw-reset-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    // AFTER the client exists (Prisma's .env auto-load already ran):
    // dev delivery (no Resend key) + no pinned origin in these tests.
    delete process.env.RESEND_API_KEY
    delete process.env.PUBLIC_ORIGIN
    delete process.env.DEV_ORIGIN
    resetLib = await import('@/lib/server/password-reset')
    verifyLib = await import('@/lib/server/verification')
    authLib = await import('@/lib/server/auth')
    forgotRoute = await import('@/app/api/auth/forgot-password/route')
    resetRoute = await import('@/app/api/auth/reset-password/route')
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /* ── token lifecycle ─────────────────────────────────────────────────── */

  it('round-trips: issue → consume → userId', async () => {
    const u = await db.user.create({
      data: { email: 'lifecycle@test.dev', passwordHash: authLib.hashPassword('old-password-1') },
    })
    const token = await resetLib.issuePasswordResetToken(u.id)
    const consumed = await resetLib.consumePasswordResetToken(token)
    expect(consumed).toEqual({ ok: true, userId: u.id })
  })

  it('is single-use — a second consume fails as consumed', async () => {
    const u = await db.user.create({ data: { email: 'single-use@test.dev', passwordHash: 'x' } })
    const token = await resetLib.issuePasswordResetToken(u.id)
    await resetLib.consumePasswordResetToken(token)
    const again = await resetLib.consumePasswordResetToken(token)
    expect(again).toEqual({ ok: false, reason: 'consumed' })
  })

  it('rejects expired tokens', async () => {
    const u = await db.user.create({ data: { email: 'expired@test.dev', passwordHash: 'x' } })
    const token = await resetLib.issuePasswordResetToken(u.id)
    await db.verificationToken.updateMany({
      where: { token },
      data: { expiresAt: new Date(Date.now() - 1000) },
    })
    const consumed = await resetLib.consumePasswordResetToken(token)
    expect(consumed).toEqual({ ok: false, reason: 'expired' })
  })

  it('never accepts an EMAIL_VERIFY token as a reset token (purpose check)', async () => {
    const u = await db.user.create({ data: { email: 'cross-purpose@test.dev', passwordHash: 'x' } })
    const verifyToken = await verifyLib.issueVerificationToken(u.id)
    const consumed = await resetLib.consumePasswordResetToken(verifyToken)
    expect(consumed).toEqual({ ok: false, reason: 'not-found' })
  })

  it('issuing a new reset link consumes the outstanding one', async () => {
    const u = await db.user.create({ data: { email: 'reissue@test.dev', passwordHash: 'x' } })
    const first = await resetLib.issuePasswordResetToken(u.id)
    await resetLib.issuePasswordResetToken(u.id)
    const consumed = await resetLib.consumePasswordResetToken(first)
    expect(consumed).toEqual({ ok: false, reason: 'consumed' })
  })

  /* ── session epoch ───────────────────────────────────────────────────── */

  it('sessionInvalidatedBy: no epoch → alive; older iat → dead; equal/newer → alive', () => {
    const epoch = new Date('2026-10-30T12:00:00Z')
    expect(authLib.sessionInvalidatedBy(1000, null)).toBe(false)
    expect(authLib.sessionInvalidatedBy(1000, undefined)).toBe(false)
    // iat strictly before the epoch → dead
    expect(authLib.sessionInvalidatedBy(Math.floor(epoch.getTime() / 1000) - 1, epoch)).toBe(true)
    // equal second → alive (same-second re-issue, e.g. change-password response)
    expect(authLib.sessionInvalidatedBy(Math.floor(epoch.getTime() / 1000), epoch)).toBe(false)
    expect(authLib.sessionInvalidatedBy(Math.floor(epoch.getTime() / 1000) + 5, epoch)).toBe(false)
  })

  it('sessionEpochNow is second-floored (iat granularity)', () => {
    const e = authLib.sessionEpochNow()
    expect(e.getTime() % 1000).toBe(0)
    expect(Math.abs(Date.now() - e.getTime())).toBeLessThan(1500)
  })

  it('verifySessionTokenPayload exposes iat; verifySessionToken still returns uid', () => {
    const token = authLib.createSessionToken('user-123')
    const payload = authLib.verifySessionTokenPayload(token)
    expect(payload?.uid).toBe('user-123')
    expect(typeof payload?.iat).toBe('number')
    expect(typeof payload?.exp).toBe('number')
    expect(authLib.verifySessionToken(token)).toBe('user-123')
    expect(authLib.verifySessionTokenPayload(`${token}x`)).toBeNull()
  })

  /* ── forgot-password route ───────────────────────────────────────────── */

  it('real password account → 200 + dev-delivery link + token row', async () => {
    const email = 'real@forgot.dev'
    await db.user.create({ data: { email, passwordHash: authLib.hashPassword('old-password-1') } })
    const res = await forgotRoute.POST(jsonReq({ email }, '10.1.0.1') as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toContain('If an account exists')
    expect(data.devLink).toMatch(/reset=[0-9a-f]{64}/)
    const rows = await db.verificationToken.count({
      where: { user: { email }, purpose: 'PASSWORD_RESET', consumedAt: null },
    })
    expect(rows).toBe(1)
    const audit = await db.authLog.findFirst({
      where: { kind: 'RESET', email }, orderBy: { createdAt: 'desc' },
    })
    expect(audit?.outcome).toBe('OK')
  })

  it('unknown email → same generic answer, NO devLink, no user, no token', async () => {
    const res = await forgotRoute.POST(jsonReq({ email: 'ghost@forgot.dev' }, '10.1.0.2') as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.message).toContain('If an account exists')
    expect(data.devLink).toBeUndefined()
    expect(await db.user.count({ where: { email: 'ghost@forgot.dev' } })).toBe(0)
    expect(
      await db.verificationToken.count({
        where: { user: { email: 'ghost@forgot.dev' }, purpose: 'PASSWORD_RESET' },
      })
    ).toBe(0)
    const audit = await db.authLog.findFirst({
      where: { kind: 'RESET', email: 'ghost@forgot.dev' }, orderBy: { createdAt: 'desc' },
    })
    expect(audit?.outcome).toBe('FAIL')
  })

  it('google-only account (no password) → generic answer, no link', async () => {
    await db.user.create({ data: { email: 'googleonly@forgot.dev', googleId: 'g-1', passwordHash: null } })
    const res = await forgotRoute.POST(jsonReq({ email: 'googleonly@forgot.dev' }, '10.1.0.3') as never)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.devLink).toBeUndefined()
  })

  it('malformed email → 400', async () => {
    const res = await forgotRoute.POST(jsonReq({ email: 'not-an-email' }, '10.1.0.4') as never)
    expect(res.status).toBe(400)
  })

  /* ── reset-password route ────────────────────────────────────────────── */

  it('happy path: new password set, epoch set, token consumed, cookie cleared', async () => {
    const email = 'happy@reset.dev'
    const u = await db.user.create({
      data: { email, passwordHash: authLib.hashPassword('old-password-1') },
    })
    // A session issued BEFORE the reset must die (the epoch's whole point).
    // The 1.1s wait is deliberate: tokens issued in the SAME second as the
    // reset survive by design (the change-password flow re-issues its cookie
    // in the same second) — so the stale one has to be a real second older.
    const staleToken = authLib.createSessionToken(u.id)
    await new Promise((r) => setTimeout(r, 1100))

    const res1 = await forgotRoute.POST(jsonReq({ email }, '10.1.1.1') as never)
    const token = tokenFrom((await res1.json()).devLink as string)

    const res = await resetRoute.POST(jsonReq({ token, password: 'brand-new-pass-2' }, '10.1.1.2') as never)
    expect(res.status).toBe(200)

    const fresh = await db.user.findUnique({ where: { email } })
    expect(authLib.verifyPassword('brand-new-pass-2', fresh?.passwordHash)).toBe(true)
    expect(authLib.verifyPassword('old-password-1', fresh?.passwordHash)).toBe(false)
    expect(fresh?.sessionsValidFrom).toBeInstanceOf(Date)
    // The stale session is dead by the epoch rule.
    const stalePayload = authLib.verifySessionTokenPayload(staleToken)
    expect(authLib.sessionInvalidatedBy(stalePayload!.iat, fresh?.sessionsValidFrom)).toBe(true)
    // The token is consumed.
    expect(await resetLib.consumePasswordResetToken(token)).toEqual({ ok: false, reason: 'consumed' })
    // The response clears the session cookie.
    const setCookie = res.headers.getSetCookie?.().join(';') ?? res.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('emorta_session')
    // Audited.
    const audit = await db.authLog.findFirst({
      where: { kind: 'RESET', email, outcome: 'OK' }, orderBy: { createdAt: 'desc' },
    })
    expect(audit?.reason).toBe('password reset via email link')
  })

  it('unknown token → 400 RESET_INVALID', async () => {
    const res = await resetRoute.POST(
      jsonReq({ token: 'deadbeef'.repeat(8), password: 'some-new-pass-3' }, '10.1.2.1') as never
    )
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.code).toBe('RESET_INVALID')
  })

  it('short password → 400 without consuming the token', async () => {
    const email = 'shortpw@reset.dev'
    await db.user.create({ data: { email, passwordHash: authLib.hashPassword('old-password-1') } })
    const res1 = await forgotRoute.POST(jsonReq({ email }, '10.1.3.1') as never)
    const token = tokenFrom((await res1.json()).devLink as string)

    const res = await resetRoute.POST(jsonReq({ token, password: 'short' }, '10.1.3.2') as never)
    expect(res.status).toBe(400)
    // The token survives a validation failure — the user can retry.
    expect(await resetLib.consumePasswordResetToken(token)).toMatchObject({ ok: true })
  })

  it('reset is replay-proof: a used token cannot reset again', async () => {
    const email = 'replay@reset.dev'
    await db.user.create({ data: { email, passwordHash: authLib.hashPassword('old-password-1') } })
    const res1 = await forgotRoute.POST(jsonReq({ email }, '10.1.4.1') as never)
    const token = tokenFrom((await res1.json()).devLink as string)

    const first = await resetRoute.POST(jsonReq({ token, password: 'first-reset-4' }, '10.1.4.2') as never)
    expect(first.status).toBe(200)
    const second = await resetRoute.POST(jsonReq({ token, password: 'second-reset-5' }, '10.1.4.3') as never)
    expect(second.status).toBe(400)
    const fresh = await db.user.findUnique({ where: { email } })
    expect(authLib.verifyPassword('first-reset-4', fresh?.passwordHash)).toBe(true)
  })
})
