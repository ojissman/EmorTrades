/**
 * AUTH-2 BOOTSTRAP — one-time (idempotent) setup for the hardened auth system.
 *
 *   bun scripts/auth2-bootstrap.ts [admin-email]
 *
 *  1. Grandfathers every EXISTING account as email-verified (they were
 *     created before verification existed — nobody gets locked out).
 *  2. Writes the default SystemSetting (email verification ON).
 *  3. Creates the ADMIN account (default admin@emortrades.com) with a strong
 *     generated password — printed ONCE below. The owner signs in and changes
 *     it in Settings ▸ Account. Re-running never resets an existing password.
 */
import { PrismaClient } from '@prisma/client'
import { randomBytes, scryptSync } from 'crypto'

const db = new PrismaClient()

function generatePassword(): string {
  // Pronounceable-ish but strong: 4 blocks of 4 chars from a safe alphabet.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  const block = () =>
    Array.from(randomBytes(4)).map((b) => alphabet[b % alphabet.length]).join('')
  return [block(), block(), block(), block()].join('-')
}

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
}

async function main() {
  // 1 · Grandfather existing users as verified (once — only where null).
  const grandfathered = await db.user.updateMany({
    where: { emailVerified: null },
    data: { emailVerified: new Date() },
  })
  console.log(`✓ Grandfathered ${grandfathered.count} existing account(s) as email-verified.`)

  // 2 · Default system flag: email verification required.
  await db.systemSetting.upsert({
    where: { key: 'auth.requireEmailVerification' },
    update: {},
    create: { key: 'auth.requireEmailVerification', value: 'true' },
  })
  console.log('✓ Email verification enabled (admin can toggle it in the Admin Console).')

  // 3 · The admin account.
  const email = (process.argv[2] || 'admin@emortrades.com').toLowerCase()
  const existing = await db.user.findUnique({ where: { email } })

  if (existing) {
    const updated = await db.user.update({
      where: { email },
      data: {
        role: 'ADMIN',
        status: 'ACTIVE',
        ...(existing.emailVerified ? {} : { emailVerified: new Date() }),
      },
      select: { email: true, role: true },
    })
    console.log(`✓ Admin account already exists — ${updated.email} ensured ADMIN/ACTIVE (password untouched).`)
    return
  }

  const password = generatePassword()
  const user = await db.user.create({
    data: {
      email,
      name: 'EmorTrades Admin',
      passwordHash: hashPassword(password),
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: new Date(),
      settings: { create: {} },
      accounts: { create: { name: 'Main Account', broker: 'Manual', type: 'stock', startingBalance: 10000 } },
    },
    select: { email: true, role: true },
  })

  console.log('\n┌──────────────────────────────────────────────────┐')
  console.log('│  ADMIN ACCOUNT CREATED — credentials below       │')
  console.log('└──────────────────────────────────────────────────┘')
  console.log(`  Email:    ${user.email}`)
  console.log(`  Password: ${password}`)
  console.log('\n  ⚠ Change the email + password in Settings ▸ Account')
  console.log('    after first sign-in. This will not be shown again.\n')
}

main()
  .catch((e) => {
    console.error('Bootstrap failed:', e)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
