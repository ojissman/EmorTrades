import { db } from '@/lib/db'

/**
 * TAGCORE-A2Z — day-tag application (the write path the Day Tags family was
 * missing). DayDayTag rows link a UTC day (stored as that day's UTC midnight)
 * to a DayTag. Until this lib existed, NOTHING in the app wrote them: the
 * Day Tags analysis family (Individual/Groups/Advanced) and Day Explore's
 * chips could only ever show data that arrived some other way.
 *
 * Date convention: callers pass 'YYYY-MM-DD' (the day-explore dayKey);
 * the row stores new Date(`${date}T00:00:00.000Z`) so every reader that
 * does toISOString().slice(0,10) gets the same key back.
 *
 * Ownership: every operation resolves the DayTag scoped to the user first —
 * a foreign tag id is a 404, never a write.
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export type DayTagApplyResult =
  | { ok: true; date: string; dayTagId: string; applied: boolean }
  | { ok: false; status: number; error: string }

/** Apply a day tag to a UTC date (idempotent — re-applying is a no-op). */
export async function applyDayTag(userId: string, date: string, dayTagId: string): Promise<DayTagApplyResult> {
  if (!DAY_RE.test(date)) return { ok: false, status: 400, error: 'Invalid date (expected YYYY-MM-DD)' }
  if (!dayTagId) return { ok: false, status: 400, error: 'Missing dayTagId' }
  const tag = await db.dayTag.findFirst({ where: { id: dayTagId, userId } })
  if (!tag) return { ok: false, status: 404, error: 'Day tag not found' }
  const when = new Date(`${date}T00:00:00.000Z`)
  await db.dayDayTag.upsert({
    where: { date_dayTagId: { date: when, dayTagId } },
    create: { date: when, dayTagId },
    update: {},
  })
  return { ok: true, date, dayTagId, applied: true }
}

/** Remove a day tag from a UTC date (idempotent — missing rows are fine). */
export async function removeDayTag(userId: string, date: string, dayTagId: string): Promise<DayTagApplyResult> {
  if (!DAY_RE.test(date)) return { ok: false, status: 400, error: 'Invalid date (expected YYYY-MM-DD)' }
  if (!dayTagId) return { ok: false, status: 400, error: 'Missing dayTagId' }
  const tag = await db.dayTag.findFirst({ where: { id: dayTagId, userId } })
  if (!tag) return { ok: false, status: 404, error: 'Day tag not found' }
  const when = new Date(`${date}T00:00:00.000Z`)
  await db.dayDayTag.deleteMany({ where: { date: when, dayTagId } })
  return { ok: true, date, dayTagId, applied: false }
}
