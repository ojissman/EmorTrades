import { db } from '@/lib/db'

/**
 * SYSTEM FLAGS — server-wide, DB-backed switches the Admin Console can flip
 * at runtime (no redeploy). Typed helpers around the SystemSetting table.
 */

export const FLAG_REQUIRE_EMAIL_VERIFICATION = 'auth.requireEmailVerification'

export async function getFlag(key: string, fallback: string): Promise<string> {
  try {
    const row = await db.systemSetting.findUnique({ where: { key } })
    return row?.value ?? fallback
  } catch {
    return fallback
  }
}

export async function setFlag(key: string, value: string): Promise<void> {
  await db.systemSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  })
}

/** Whether new email/password registrations must verify their email (default: on). */
export async function requireEmailVerification(): Promise<boolean> {
  return (await getFlag(FLAG_REQUIRE_EMAIL_VERIFICATION, 'true')) === 'true'
}
