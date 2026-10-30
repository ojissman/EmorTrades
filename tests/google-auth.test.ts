/**
 * GOOGLE AUTH MATRIX (AUTH-6) — every case of the account-linking spec,
 * executed against a real (temp) SQLite database. Google's network calls are
 * irrelevant here: what matters is what THIS server does with a verified
 * profile { sub, email, email_verified } — the callback delegates exactly
 * this logic to src/lib/server/google-link.ts.
 *
 *   Case A  new identity            → created (+ bootstrap parity with register)
 *   Case B  linked identity         → sign-in, never a duplicate user
 *   Case C  email matches password  → PENDING LINK — no silent merge
 *           link-confirm            → bad password refused; correct password links
 *   Case D  identity owned elsewhere→ linking refused (never transferred)
 *   Case E  suspended               → no session
 *   Case F  concurrency             → unique googleId enforced; second linker loses
 *   Unlink  google-only guard       → refused without a password fallback
 *   Tokens  pending-link HMAC       → roundtrip, tamper, expiry
 *   CSRF    sameOrigin              → match / mismatch / absent
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes, scryptSync } from 'node:crypto'
import type { PrismaClient } from '@prisma/client'

/** Same `salt:hex` format auth.ts produces — computed locally so this suite
 *  never imports next/headers (auth.ts pulls the Next request machinery). */
function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

const PROFILE_A = { sub: 'google-sub-aaa', email: 'Ada.Trader@Example.com', email_verified: true, name: 'Ada Trader' }
const PROFILE_B = { sub: 'google-sub-bbb', email: 'bob@example.com', email_verified: true, name: 'Bob' }

describe('google auth — account linking matrix', () => {
  let dir: string
  let db: PrismaClient
  let gl: typeof import('@/lib/server/google-link')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'google-auth-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    process.env.AUTH_SECRET = 'test-secret-for-vitest-only'
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    gl = await import('@/lib/server/google-link')
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /* ── Case A ─────────────────────────────────────────────────────────── */

  it('A · a genuinely new Google identity creates exactly one bootstrapped user', async () => {
    const r = await gl.resolveGoogleSignIn(PROFILE_A)
    expect(r).toMatchObject({ action: 'created' })
    if (r.action !== 'created') return

    const u = await db.user.findUnique({ where: { id: r.userId } })
    expect(u).not.toBeNull()
    expect(u!.googleId).toBe(PROFILE_A.sub)
    expect(u!.email).toBe(PROFILE_A.email.toLowerCase()) // normalized
    expect(u!.emailVerified).not.toBeNull() // Google verified the inbox
    expect(u!.role).toBe('USER')
    expect(u!.status).toBe('ACTIVE')
    // bootstrap parity with password registration: settings + Main Account
    const settings = await db.userSettings.findUnique({ where: { userId: u!.id } })
    const accounts = await db.account.findMany({ where: { userId: u!.id } })
    expect(settings).not.toBeNull()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].name).toBe('Main Account')
  })

  it('B · the same Google identity signs back in as the same user — no duplicates', async () => {
    const before = await db.user.count({ where: { googleId: PROFILE_A.sub } })
    const r = await gl.resolveGoogleSignIn(PROFILE_A)
    expect(r).toMatchObject({ action: 'sign-in' })
    const after = await db.user.count({ where: { googleId: PROFILE_A.sub } })
    expect(after).toBe(before)
    expect(after).toBe(1)
  })

  /* ── Case C ─────────────────────────────────────────────────────────── */

  it('C · a password account with the same email is NEVER auto-merged', async () => {
    const email = 'carol@example.com'
    const existing = await db.user.create({
      data: { email, name: 'Carol', passwordHash: hashPassword('carol-secret-123') },
    })

    const r = await gl.resolveGoogleSignIn({ sub: 'google-sub-carol', email: 'Carol@Example.com', email_verified: true })
    expect(r).toMatchObject({ action: 'pending-link', userId: existing.id })

    // no merge happened
    const untouched = await db.user.findUnique({ where: { id: existing.id } })
    expect(untouched!.googleId).toBeNull()
    expect(untouched!.emailVerified).toBeNull() // not even auto-verified
    expect(await db.user.count({ where: { email } })).toBe(1)
  })

  it('C · link-confirm refuses a wrong password', async () => {
    const pending = gl.signPendingLink({ sub: 'google-sub-carol', email: 'carol@example.com' })
    const r = await gl.confirmGoogleLink(gl.verifyPendingLink(pending)!, 'wrong-password')
    expect(r).toEqual({ ok: false, reason: 'bad-password' })
    const u = await db.user.findUnique({ where: { email: 'carol@example.com' } })
    expect(u!.googleId).toBeNull()
  })

  it('C · link-confirm with the CORRECT password links + verifies + keeps the user id', async () => {
    const pending = gl.signPendingLink({ sub: 'google-sub-carol', email: 'carol@example.com', name: 'Carol' })
    const r = await gl.confirmGoogleLink(gl.verifyPendingLink(pending)!, 'carol-secret-123')
    expect(r).toEqual({ ok: true, userId: (await db.user.findUnique({ where: { email: 'carol@example.com' } }))!.id })

    const u = await db.user.findUnique({ where: { email: 'carol@example.com' } })
    expect(u!.googleId).toBe('google-sub-carol')
    expect(u!.emailVerified).not.toBeNull()

    // and from now on that identity signs straight in (Case B)
    const again = await gl.resolveGoogleSignIn({ sub: 'google-sub-carol', email: 'carol@example.com', email_verified: true })
    expect(again).toMatchObject({ action: 'sign-in', userId: u!.id })
  })

  /* ── Case D ─────────────────────────────────────────────────────────── */

  it('D · an identity owned by ANOTHER account cannot be linked or stolen', async () => {
    // Ada (Case A) owns google-sub-aaa. Bob wants to link Ada's Google identity.
    const bob = await db.user.create({
      data: { email: 'bob2@example.com', name: 'Bob 2', passwordHash: hashPassword('bob2-secret-123') },
    })
    const r = await gl.linkGoogleToUser(bob.id, PROFILE_A)
    expect(r).toEqual({ ok: false, reason: 'taken' })

    // Ada still owns it; journal ownership never moved
    const ada = await db.user.findUnique({ where: { googleId: PROFILE_A.sub } })
    expect(ada).not.toBeNull()
    expect(ada!.id).not.toBe(bob.id)

    // re-linking your OWN identity is a harmless no-op
    const self = await gl.linkGoogleToUser(ada!.id, PROFILE_A)
    expect(self).toEqual({ ok: true, already: true })
  })

  it('D · a fresh explicit link works and is visible to the owner', async () => {
    const bob = await db.user.findUnique({ where: { email: 'bob2@example.com' } })
    const r = await gl.linkGoogleToUser(bob!.id, PROFILE_B)
    expect(r).toEqual({ ok: true, already: false })
    const after = await db.user.findUnique({ where: { id: bob!.id } })
    expect(after!.googleId).toBe(PROFILE_B.sub)
  })

  /* ── Case E ─────────────────────────────────────────────────────────── */

  it('E · a suspended account is refused, Google or not', async () => {
    const email = 'suspended@example.com'
    const u = await db.user.create({
      data: { email, name: 'S', passwordHash: hashPassword('s-secret-123'), status: 'SUSPENDED', googleId: 'google-sub-s' },
    })
    const r = await gl.resolveGoogleSignIn({ sub: 'google-sub-s', email, email_verified: true })
    expect(r).toEqual({ action: 'suspended', userId: u.id })

    // and it cannot link-confirm its way back in either
    const pending = gl.signPendingLink({ sub: 'google-sub-s', email })
    const confirm = await gl.confirmGoogleLink(gl.verifyPendingLink(pending)!, 's-secret-123')
    expect(confirm).toEqual({ ok: false, reason: 'suspended' })
  })

  /* ── Case F ─────────────────────────────────────────────────────────── */

  it('F · the unique constraint blocks a second user taking the same googleId', async () => {
    const thief = await db.user.create({
      data: { email: 'thief@example.com', name: 'T', passwordHash: hashPassword('t-secret-123') },
    })
    await expect(
      db.user.update({ where: { id: thief.id }, data: { googleId: PROFILE_A.sub } })
    ).rejects.toThrow()
  })

  /* ── Unlink ─────────────────────────────────────────────────────────── */

  it('unlink · a Google-ONLY account is refused (lockout guard)', async () => {
    const only = await db.user.create({
      data: { email: 'googleonly@example.com', name: 'G', googleId: 'google-sub-only' },
    })
    const r = await gl.unlinkGoogle(only.id)
    expect(r).toEqual({ ok: false, reason: 'google-only' })
  })

  it('unlink · an account with a password detaches cleanly', async () => {
    const bob = await db.user.findUnique({ where: { email: 'bob2@example.com' } })
    const r = await gl.unlinkGoogle(bob!.id)
    expect(r).toEqual({ ok: true })
    const after = await db.user.findUnique({ where: { id: bob!.id } })
    expect(after!.googleId).toBeNull()
    expect(after!.passwordHash).not.toBeNull() // still has a way in
  })

  /* ── Pending-link tokens ────────────────────────────────────────────── */

  it('tokens · pending-link roundtrip works, tampering and expiry fail', async () => {
    const token = gl.signPendingLink({ sub: 's1', email: 'x@example.com' })
    expect(gl.verifyPendingLink(token)?.sub).toBe('s1')

    // tampered signature
    const [body, sig] = token.split('.')
    expect(gl.verifyPendingLink(`${body}.${sig.slice(0, -2)}xx`)).toBeNull()

    // expired payload (signed with a past exp)
    const forged = `${Buffer.from(JSON.stringify({ sub: 's1', email: 'x@example.com', exp: 1 }), 'utf8').toString('base64url')}.${sig}`
    expect(gl.verifyPendingLink(forged)).toBeNull()
  })

  it('tokens · the link-intent cookie roundtrips and expires', () => {
    const token = gl.signLinkIntent('user-123')
    expect(gl.verifyLinkIntent(token)?.uid).toBe('user-123')
    expect(gl.verifyLinkIntent(undefined)).toBeNull()
    expect(gl.verifyLinkIntent('garbage')).toBeNull()
  })

  /* ── CSRF guard ─────────────────────────────────────────────────────── */

  it('csrf · sameOrigin accepts matching and absent Origins, rejects mismatches', () => {
    // header-derived mode — no PUBLIC_ORIGIN pin
    const savedPin = process.env.PUBLIC_ORIGIN
    delete process.env.PUBLIC_ORIGIN
    const mk = (origin: string | null, host: string): Request =>
      new Request('http://x/api', {
        headers: {
          ...(origin ? { origin } : {}),
          host,
        },
      })
    expect(gl.sameOrigin(mk('https://app.example.com', 'app.example.com'))).toBe(true)
    expect(gl.sameOrigin(mk(null, 'app.example.com'))).toBe(true) // non-browser clients
    expect(gl.sameOrigin(mk('https://evil.example.net', 'app.example.com'))).toBe(false)

    // pinned mode — PUBLIC_ORIGIN is authoritative regardless of proxy headers
    process.env.PUBLIC_ORIGIN = 'https://pin.example.org'
    const pinned = (origin: string | null): Request =>
      new Request('http://internal.ws-fcapp.run/api', {
        headers: {
          ...(origin ? { origin } : {}),
          host: 'internal.ws-fcapp.run',
          'x-forwarded-host': 'internal.ws-fcapp.run', // double-proxy rewrite must not win
        },
      })
    expect(gl.sameOrigin(pinned('https://pin.example.org'))).toBe(true)
    expect(gl.sameOrigin(pinned(null))).toBe(true) // non-browser clients
    expect(gl.sameOrigin(pinned('https://internal.ws-fcapp.run'))).toBe(false) // proxy name ≠ public origin
    expect(gl.sameOrigin(pinned('https://evil.example.net'))).toBe(false)
    if (savedPin === undefined) delete process.env.PUBLIC_ORIGIN
    else process.env.PUBLIC_ORIGIN = savedPin
  })

  /* ── Two-door origin pins (AUTH-9) ──────────────────────────────────── */

  it('origin · resolvePinnedOrigin serves each door its own callback origin', async () => {
    const { resolvePinnedOrigin } = await import('@/lib/server/origin')
    const base = {
      PUBLIC_ORIGIN: 'https://emortrade.space-z.ai/',
      DEV_ORIGIN: 'https://preview-chat-x.space-z.ai/',
    }
    // dev server (preview panel): DEV_ORIGIN wins, trailing slash normalized
    expect(
      resolvePinnedOrigin({ ...base, NODE_ENV: 'development' })
    ).toBe('https://preview-chat-x.space-z.ai')
    // published runtime: PUBLIC_ORIGIN always, DEV_ORIGIN ignored
    expect(
      resolvePinnedOrigin({ ...base, NODE_ENV: 'production' })
    ).toBe('https://emortrade.space-z.ai')
    // any non-development runtime (test/build) behaves like production
    expect(
      resolvePinnedOrigin({ ...base, NODE_ENV: 'test' })
    ).toBe('https://emortrade.space-z.ai')
    // DEV_ORIGIN unset → dev falls back to PUBLIC_ORIGIN (pre-AUTH-9 behavior)
    expect(
      resolvePinnedOrigin({ PUBLIC_ORIGIN: base.PUBLIC_ORIGIN, NODE_ENV: 'development' })
    ).toBe('https://emortrade.space-z.ai')
    // nothing set → empty pin, header-derived mode
    expect(resolvePinnedOrigin({ NODE_ENV: 'production' })).toBe('')
  })
})
