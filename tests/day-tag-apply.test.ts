/**
 * TAGCORE-A2Z tests — the day-tag APPLICATION write path (the link the Day
 * Tags family was missing). These tests pin the lib contract Day Explore
 * rides on:
 *
 *  1. applyDayTag writes a DayDayTag at the date's UTC midnight — the exact
 *     convention every reader (day-explore dayKey, /api/day-tags GET days[])
 *     reverses with toISOString().slice(0,10).
 *  2. applyDayTag is idempotent (re-applying does not duplicate or throw —
 *     the composite PK guards it and upsert absorbs it).
 *  3. removeDayTag deletes exactly that (date, tag) pair — other dates and
 *     other tags keep their links.
 *  4. ownership: a foreign user's tag id is a 404 and writes NOTHING.
 *  5. validation: a malformed date is a 400 before any DB touch.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PrismaClient } from '@prisma/client'

describe('day-tag-apply — TAGCORE-A2Z', () => {
  let dir: string
  let db: PrismaClient
  let apply: typeof import('@/lib/server/day-tag-apply')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'day-tag-apply-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    apply = await import('@/lib/server/day-tag-apply')
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  it('applyDayTag writes the DayDayTag at the UTC midnight of the date key', async () => {
    const user = await db.user.create({ data: { email: 'apply-owner@test.local', passwordHash: 'x' } })
    const tag = await db.dayTag.create({ data: { userId: user.id, name: 'FOMC Day', color: '#ef4444' } })

    const res = await apply.applyDayTag(user.id, '2026-11-04', tag.id)
    expect(res.ok).toBe(true)

    const rows = await db.dayDayTag.findMany({ where: { dayTagId: tag.id } })
    expect(rows).toHaveLength(1)
    // The convention: the stored instant IS the date's UTC midnight, so every
    // toISOString().slice(0,10) reader gets '2026-11-04' back.
    expect(rows[0].date.toISOString()).toBe('2026-11-04T00:00:00.000Z')
  })

  it('applyDayTag is idempotent — re-applying neither duplicates nor throws', async () => {
    const user = await db.user.create({ data: { email: 'apply-idem@test.local', passwordHash: 'x' } })
    const tag = await db.dayTag.create({ data: { userId: user.id, name: 'CPI Day' } })

    const first = await apply.applyDayTag(user.id, '2026-10-01', tag.id)
    const second = await apply.applyDayTag(user.id, '2026-10-01', tag.id)
    expect(first.ok).toBe(true)
    expect(second.ok).toBe(true)

    const rows = await db.dayDayTag.findMany({ where: { dayTagId: tag.id } })
    expect(rows).toHaveLength(1)
  })

  it('removeDayTag deletes exactly the (date, tag) pair — other dates and tags survive', async () => {
    const user = await db.user.create({ data: { email: 'apply-rm@test.local', passwordHash: 'x' } })
    const a = await db.dayTag.create({ data: { userId: user.id, name: 'High Volatility' } })
    const b = await db.dayTag.create({ data: { userId: user.id, name: 'Quad Witching' } })
    await apply.applyDayTag(user.id, '2026-09-15', a.id)
    await apply.applyDayTag(user.id, '2026-09-16', a.id)
    await apply.applyDayTag(user.id, '2026-09-15', b.id)

    const res = await apply.removeDayTag(user.id, '2026-09-15', a.id)
    expect(res.ok).toBe(true)

    const aRows = await db.dayDayTag.findMany({ where: { dayTagId: a.id } })
    expect(aRows).toHaveLength(1)
    expect(aRows[0].date.toISOString()).toBe('2026-09-16T00:00:00.000Z')
    const bRows = await db.dayDayTag.findMany({ where: { dayTagId: b.id } })
    expect(bRows).toHaveLength(1)
  })

  it('a foreign user’s tag id is a 404 and writes nothing', async () => {
    const owner = await db.user.create({ data: { email: 'apply-owner2@test.local', passwordHash: 'x' } })
    const tag = await db.dayTag.create({ data: { userId: owner.id, name: 'Locked' } })
    const intruder = await db.user.create({ data: { email: 'apply-intruder@test.local', passwordHash: 'x' } })

    const res = await apply.applyDayTag(intruder.id, '2026-08-01', tag.id)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(404)

    const rows = await db.dayDayTag.findMany({ where: { dayTagId: tag.id } })
    expect(rows).toHaveLength(0)
  })

  it('a malformed date is a 400 before any DB touch', async () => {
    const user = await db.user.create({ data: { email: 'apply-bad@test.local', passwordHash: 'x' } })
    const tag = await db.dayTag.create({ data: { userId: user.id, name: 'Any' } })

    const res = await apply.applyDayTag(user.id, 'not-a-date', tag.id)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.status).toBe(400)
    const rm = await apply.removeDayTag(user.id, '11/04/2026', tag.id)
    expect(rm.ok).toBe(false)
  })
})
