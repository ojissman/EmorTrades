/**
 * secrets-backup.ts — Option A of the restart-recovery plan (RESTART-RECOVERY).
 *
 * WHY THIS EXISTS: a platform restart truncates the workspace `.env` to
 * DATABASE_URL-only (happened Oct 30 18:52 and Oct 31 06:58). `.env` is
 * deliberately gitignored — secrets never enter git in plain form — so after
 * a restart the keys had NO recovery source: not in GitHub (by design), not
 * on disk (swept). Two keys had to be regenerated; one (Google OAuth client
 * secret) only the owner can reissue.
 *
 * THE FIX (owner-approved "Option A + B"): keep an ENCRYPTED copy of `.env`
 * inside the private GitHub repo — `backups/secrets.enc`. The repo can then
 * restore every key exactly (no re-pairing, no broken Google login) while
 * still never containing readable secrets. The passphrase is NOT stored
 * anywhere on this machine; the owner holds it (password manager) and
 * supplies it once, in chat, when a restore is needed.
 *
 * CRYPTO: AES-256-GCM, key derived from the passphrase via scrypt
 * (N=2^15, r=8, p=1 — ~100ms, brute-force hostile), fresh random salt+IV
 * per backup, auth tag verifies both the ciphertext AND the passphrase
 * (wrong passphrase ⇒ clean decrypt failure, never garbage output).
 *
 * USAGE (passphrase always on stdin — never a CLI arg, never echoed):
 *   echo "$PASSPHRASE" | bun scripts/secrets-backup.ts backup [--allow-incomplete]
 *   echo "$PASSPHRASE" | bun scripts/secrets-backup.ts restore
 *   echo "$PASSPHRASE" | bun scripts/secrets-backup.ts verify
 *   bun scripts/secrets-backup.ts status
 *
 * SAFETY RULES:
 *   - backup REFUSES while any required key is empty, unless --allow-incomplete
 *     (an incomplete backup is a false sense of security — it would cement
 *     empty values over a future good .env).
 *   - restore REFUSES to clobber a complete .env unless --force (accident
 *     guard); a truncated/missing .env restores freely (that's the disaster).
 *   - status prints key NAMES and presence only — never values.
 *   - all exits non-zero on refusal; files written 0600.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const ROOT = path.resolve(import.meta.dir, '..')
const ENV_PATH = path.join(ROOT, '.env')
const BACKUP_PATH = path.join(ROOT, 'backups', 'secrets.enc')

/** Must mirror REQUIRED_ENV_KEYS in scripts/build-guarded.sh (the env gate). */
const REQUIRED_KEYS = [
  'DATABASE_URL',
  'PUBLIC_ORIGIN',
  'DEV_ORIGIN',
  'AUTH_SECRET',
  'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET',
  'GOOGLE_INTEGRATION_CLIENT_ID',
  'GOOGLE_INTEGRATION_CLIENT_SECRET',
  'DB_EXPORT_TOKEN',
] as const

/**
 * GOOGLE_SERVICE_ACCOUNT_JSON (Drive · Sheets · Calendar) is deliberately
 * NOT required: those Workspace APIs are on-demand features and the owner
 * has not yet supplied the key file. Backup/restore is whole-file, so the
 * key is captured automatically the moment it lands in .env — only the
 * required-missing refusal and the publish gate skip it until then.
 */

const SCRYPT_N = 1 << 15 // 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEY_LEN = 32 // AES-256
const IV_LEN = 12
const SALT_LEN = 32
const TAG_LEN = 16
const VERSION = 1

/* ── helpers ─────────────────────────────────────────────────────────── */

function die(msg: string, code = 1): never {
  console.error(`[secrets-backup] ${msg}`)
  process.exit(code)
}

function info(msg: string): void {
  console.log(`[secrets-backup] ${msg}`)
}

/** Reads the passphrase from stdin (all of it, minus trailing newline). */
async function readPassphrase(): Promise<string> {
  const text = await Bun.stdin.text()
  const pass = text.replace(/\r?\n$/, '')
  if (pass.length < 8) die('passphrase too short (min 8 chars) — nothing written.')
  return pass
}

/** Parses .env into key→value (value = everything after first '=', verbatim). */
function parseEnv(raw: string): Map<string, string> {
  const map = new Map<string, string>()
  for (const line of raw.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line)
    if (m) map.set(m[1], m[2])
  }
  return map
}

/** Key names + presence only — values never printed. */
function keyInventory(raw: string): { key: string; state: 'present' | 'EMPTY' | 'absent' }[] {
  const map = parseEnv(raw)
  return REQUIRED_KEYS.map((key) => {
    const v = map.get(key) ?? ''
    return { key, state: v.trim() === '' ? 'EMPTY' : 'present' }
  })
}

function missingKeys(raw: string): string[] {
  return keyInventory(raw)
    .filter((k) => k.state !== 'present')
    .map((k) => `${k.key} (${k.state})`)
}

/* ── crypto ──────────────────────────────────────────────────────────── */

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  // maxmem explicit: 128·N·r = 32MB sits exactly on OpenSSL's default limit
  // and Bun rejects boundary params — grant 128MB, still trivial to satisfy.
  return scryptSync(passphrase, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * 1024 * 1024,
  })
}

/** payload = [version(1)] [salt(32)] [iv(12)] [tag(16)] [ciphertext] */
function encryptEnv(passphrase: string, plaintext: string): Buffer {
  const salt = randomBytes(SALT_LEN)
  const iv = randomBytes(IV_LEN)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([Buffer.from([VERSION]), salt, iv, tag, ct])
}

function decryptEnv(passphrase: string, payload: Buffer): string {
  if (payload.length < 1 + SALT_LEN + IV_LEN + TAG_LEN) {
    throw new Error('backup file too short — corrupt or not a v1 payload')
  }
  if (payload[0] !== VERSION) throw new Error(`unsupported backup version ${payload[0]}`)
  const salt = payload.subarray(1, 1 + SALT_LEN)
  const iv = payload.subarray(1 + SALT_LEN, 1 + SALT_LEN + IV_LEN)
  const tag = payload.subarray(1 + SALT_LEN + IV_LEN, 1 + SALT_LEN + IV_LEN + TAG_LEN)
  const ct = payload.subarray(1 + SALT_LEN + IV_LEN + TAG_LEN)
  const key = deriveKey(passphrase, salt)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8')
}

/* ── subcommands ─────────────────────────────────────────────────────── */

async function cmdBackup(allowIncomplete: boolean): Promise<void> {
  const passphrase = await readPassphrase()
  if (!fs.existsSync(ENV_PATH)) die('no .env found — nothing to back up.')
  const raw = fs.readFileSync(ENV_PATH, 'utf8')
  const missing = missingKeys(raw)
  if (missing.length > 0 && !allowIncomplete) {
    die(
      `refusing: required key(s) missing/empty: ${missing.join(', ')}. ` +
        'An incomplete backup is a false sense of security. ' +
        'Heal .env first, or pass --allow-incomplete to override (testing only).',
    )
  }
  if (missing.length > 0) {
    info(`WARNING: backing up an INCOMPLETE .env (missing: ${missing.join(', ')})`)
  }
  fs.mkdirSync(path.dirname(BACKUP_PATH), { recursive: true })
  const payload = encryptEnv(passphrase, raw)
  fs.writeFileSync(BACKUP_PATH, payload, { mode: 0o600 })
  info(
    `encrypted ${raw.length} bytes → ${BACKUP_PATH} ` +
      `(AES-256-GCM, scrypt N=${SCRYPT_N}; ${missing.length === 0 ? 'all required keys present' : 'INCOMPLETE — see warning above'}).`,
  )
  info('commit this file: git add backups/secrets.enc && git commit -m "secrets: rotate backup"')
}

async function cmdRestore(force: boolean): Promise<void> {
  const passphrase = await readPassphrase()
  if (!fs.existsSync(BACKUP_PATH)) die(`no backup at ${BACKUP_PATH} — nothing to restore.`)
  let plaintext: string
  try {
    plaintext = decryptEnv(passphrase, fs.readFileSync(BACKUP_PATH))
  } catch {
    die('decrypt failed — wrong passphrase or corrupted backup. .env untouched.')
  }
  // Accident guard: clobbering a HEALTHY .env needs --force.
  if (fs.existsSync(ENV_PATH)) {
    const current = fs.readFileSync(ENV_PATH, 'utf8')
    if (missingKeys(current).length === 0 && !force) {
      die(
        'current .env already has every required key — refusing to overwrite ' +
          'a healthy env without --force.',
      )
    }
  }
  const before = fs.existsSync(ENV_PATH)
    ? keyInventory(fs.readFileSync(ENV_PATH, 'utf8')).filter((k) => k.state === 'present').length
    : 0
  fs.writeFileSync(ENV_PATH, plaintext, { mode: 0o600 })
  const after = keyInventory(plaintext).filter((k) => k.state === 'present').length
  info(`restored .env from backup (required keys present: ${before} → ${after}).`)
  info('restart the dev server so the restored keys load: ( setsid bash -c \'exec bun run dev\' >>/tmp/next-dev.out 2>&1 </dev/null & )')
}

async function cmdVerify(): Promise<void> {
  const passphrase = await readPassphrase()
  if (!fs.existsSync(BACKUP_PATH)) die(`no backup at ${BACKUP_PATH}.`)
  try {
    const plaintext = decryptEnv(passphrase, fs.readFileSync(BACKUP_PATH))
    const missing = missingKeys(plaintext)
    info(
      `passphrase OK — backup decrypts cleanly. Required keys in backup: ` +
        `${REQUIRED_KEYS.length - missing.length}/${REQUIRED_KEYS.length} present` +
        (missing.length ? ` (missing: ${missing.join(', ')})` : '') +
        '.',
    )
  } catch {
    die('wrong passphrase or corrupted backup.')
  }
}

function cmdStatus(): void {
  if (!fs.existsSync(ENV_PATH)) {
    console.log(`[secrets-backup] .env: MISSING`)
  } else {
    const inv = keyInventory(fs.readFileSync(ENV_PATH, 'utf8'))
    console.log(`[secrets-backup] .env key inventory (names only, values never printed):`)
    for (const k of inv) console.log(`  ${k.key.padEnd(22)} ${k.state}`)
  }
  console.log(
    `[secrets-backup] encrypted backup: ` +
      (fs.existsSync(BACKUP_PATH)
        ? `present (${fs.statSync(BACKUP_PATH).size} bytes, ${fs.statSync(BACKUP_PATH).mtime.toISOString()})`
        : 'NONE — run a backup once .env is complete'),
  )
}

/* ── entry ───────────────────────────────────────────────────────────── */

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2)
  switch (cmd) {
    case 'backup':
      await cmdBackup(rest.includes('--allow-incomplete'))
      break
    case 'restore':
      await cmdRestore(rest.includes('--force'))
      break
    case 'verify':
      await cmdVerify()
      break
    case 'status':
      cmdStatus()
      break
    default:
      die(
        'usage: echo "$PASSPHRASE" | bun scripts/secrets-backup.ts <backup|restore|verify|status> [--allow-incomplete|--force]',
        cmd ? 1 : 0,
      )
  }
}

await main()
