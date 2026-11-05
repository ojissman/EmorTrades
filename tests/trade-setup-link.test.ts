/**
 * MODAL-SETUP-UNIFY tests — the Trade Modal's two "Setup" linkings (the
 * Setup field and the plan chain's third picker) are ONE link on ONE column
 * (Trade.setupId). These tests pin the server contract the unified modal
 * flow rides on:
 *
 *  1. shouldCreateLink — a setup value alone is a PLAIN link persisted by the
 *     trade write itself; it must NOT be pushed through linkTrade (which
 *     rejects it with a spurious "Pick a plan"). Only a real chain (a plan,
 *     or at least a system) starts a versioned link.
 *  2. linkTrade full chain — pins the versions in force at entry, writes the
 *     append-only TradeLinkEvent, and lands the chain's setup on the SAME
 *     Trade.setupId column the Setup field writes.
 *  3. linkTrade clear — nulls the chain AND setupId. This is exactly why the
 *     modal clears BEFORE the PUT on a downgrade: the PUT's new plain
 *     setupId has to land on top of the clear.
 *  4. linkTrade rejects a setup without a plan — the documented reason
 *     shouldCreateLink exists.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { PrismaClient } from '@prisma/client'

const ENTRY = new Date('2026-11-04T10:00:00.000Z')

describe('trade-setup-link — MODAL-SETUP-UNIFY', () => {
  let dir: string
  let db: PrismaClient
  let planLink: typeof import('@/lib/plan-link')

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'setup-link-'))
    process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`
    execSync('bunx prisma db push --skip-generate --schema prisma/schema.prisma', {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      stdio: 'pipe',
    })
    const dbMod = await import('@/lib/db')
    db = dbMod.db
    planLink = await import('@/lib/plan-link')
  })

  afterAll(async () => {
    await db?.$disconnect()
    rmSync(dir, { recursive: true, force: true })
  })

  /* ── 1. shouldCreateLink (pure) ─────────────────────────────────────── */

  it('all null → no link call (the trade write stands alone)', () => {
    expect(planLink.shouldCreateLink({ tradingPlanId: null, systemId: null, setupId: null })).toBe(false)
  })

  it('setup-only → NO link call — a plain link is not a chain (the spurious "Pick a plan" fix)', () => {
    expect(planLink.shouldCreateLink({ tradingPlanId: null, systemId: null, setupId: 'setup_x' })).toBe(false)
  })

  it('plan present → link call', () => {
    expect(planLink.shouldCreateLink({ tradingPlanId: 'plan_x', systemId: null, setupId: null })).toBe(true)
  })

  it('system present → link call', () => {
    expect(planLink.shouldCreateLink({ tradingPlanId: null, systemId: 'sys_x', setupId: null })).toBe(true)
  })

  it('full chain → link call', () => {
    expect(planLink.shouldCreateLink({ tradingPlanId: 'plan_x', systemId: 'sys_x', setupId: 'setup_x' })).toBe(true)
  })

  /* ── fixtures for the linkTrade contract ────────────────────────────── */

  async function fixtures() {
    const user = await db.user.create({ data: { email: `sl-${Date.now()}@test.dev` } })
    const account = await db.account.create({ data: { userId: user.id, name: 'A', startingBalance: 10000 } })
    const plan = await db.tradingPlan.create({ data: { userId: user.id, name: 'P', status: 'active' } })
    const group = await db.systemGroup.create({ data: { userId: user.id, name: 'G' } })
    const system = await db.system.create({ data: { userId: user.id, planId: plan.id, groupId: group.id, name: 'S' } })
    const setup = await db.setup.create({ data: { userId: user.id, name: 'U', systemId: system.id } })
    // published versions in force before the trade's entry
    const pv = await db.planVersion.create({
      data: { planId: plan.id, versionNo: 1, status: 'published', templateVersion: 'master-template', content: '{}', effectiveFrom: new Date(ENTRY.getTime() - 3600_000) },
    })
    const sv = await db.systemVersion.create({
      data: { systemId: system.id, versionNo: 1, status: 'published', templateVersion: 'master-template', content: '{}', effectiveFrom: new Date(ENTRY.getTime() - 3600_000) },
    })
    const uv = await db.setupVersion.create({
      data: { setupId: setup.id, versionNo: 1, status: 'published', templateVersion: 'master-template', content: '{}', effectiveFrom: new Date(ENTRY.getTime() - 3600_000) },
    })
    const trade = await db.trade.create({
      data: { userId: user.id, accountId: account.id, symbol: 'ES', side: 'long', quantity: 1, entryPrice: 200, entryTime: ENTRY, status: 'open' },
    })
    return { user, account, plan, group, system, setup, pv, sv, uv, trade }
  }

  /* ── 2. full chain: pins + append-only event + same column ──────────── */

  it('linkTrade full chain — pins versions in force, records the event, lands on Trade.setupId', async () => {
    const f = await fixtures()
    const out = await planLink.linkTrade(f.user.id, f.trade.id, {
      tradingPlanId: f.plan.id,
      systemId: f.system.id,
      setupId: f.setup.id,
    })
    expect(out.ok).toBe(true)

    const row = await db.trade.findUnique({ where: { id: f.trade.id } })
    expect(row?.tradingPlanId).toBe(f.plan.id)
    expect(row?.systemId).toBe(f.system.id)
    // the chain's setup lands on the SAME column the Setup field writes —
    // the two pickers of the modal are one link
    expect(row?.setupId).toBe(f.setup.id)
    expect(row?.planVersionId).toBe(f.pv.id)
    expect(row?.systemVersionId).toBe(f.sv.id)
    expect(row?.setupVersionId).toBe(f.uv.id)
    expect(row?.linkedAt).toBeInstanceOf(Date)
    expect(['before_entry', 'while_open', 'after_close']).toContain(row?.linkTiming)

    const events = await db.tradeLinkEvent.findMany({ where: { tradeId: f.trade.id } })
    expect(events).toHaveLength(1)
    expect(events[0].action).toBe('set')
    expect(events[0].setupId).toBe(f.setup.id)
    expect(events[0].setupVersionId).toBe(f.uv.id)
  })

  /* ── 3. the clear path nulls the chain AND setupId ──────────────────── */

  it('linkTrade clear — nulls chain AND setupId: the downgrade must run BEFORE the PUT', async () => {
    const f = await fixtures()
    await planLink.linkTrade(f.user.id, f.trade.id, {
      tradingPlanId: f.plan.id,
      systemId: f.system.id,
      setupId: f.setup.id,
    })
    // simulate the modal's downgrade: plain link desired afterwards
    const out = await planLink.linkTrade(f.user.id, f.trade.id, {
      tradingPlanId: null,
      systemId: null,
      setupId: null,
    })
    expect(out.ok).toBe(true)

    const row = await db.trade.findUnique({ where: { id: f.trade.id } })
    expect(row?.tradingPlanId).toBeNull()
    expect(row?.systemId).toBeNull()
    // the clear wipes setupId too — exactly why the modal clears first and
    // lets the PUT's new plain setupId land on top
    expect(row?.setupId).toBeNull()
    expect(row?.setupVersionId).toBeNull()

    const events = await db.tradeLinkEvent.findMany({ where: { tradeId: f.trade.id }, orderBy: { linkedAt: 'asc' } })
    expect(events.map((e) => e.action)).toEqual(['set', 'cleared'])
  })

  /* ── 4. the server contract that motivates shouldCreateLink ─────────── */

  it('linkTrade rejects a setup without a plan — why plain links skip it', async () => {
    const f = await fixtures()
    await expect(
      planLink.linkTrade(f.user.id, f.trade.id, { tradingPlanId: null, systemId: null, setupId: f.setup.id }),
    ).rejects.toThrow('Pick a plan')
    // nothing was written
    const row = await db.trade.findUnique({ where: { id: f.trade.id } })
    expect(row?.tradingPlanId).toBeNull()
    expect(row?.setupId).toBeNull()
  })
})
