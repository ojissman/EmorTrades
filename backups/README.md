# backups/ — encrypted secrets backup (Option A, RESTART-RECOVERY)

## What lives here

`secrets.enc` — an AES-256-GCM encrypted copy of the workspace `.env`,
created by `scripts/secrets-backup.ts` and **committed to this private repo
on purpose**. This is the recovery source for the restart failure mode where
the platform truncates `.env` to `DATABASE_URL`-only: `.env` itself is
gitignored (secrets never enter git in plain form), so without this file a
restart had NO recovery source for the keys.

`secrets.manifest` — (ENFORCE-3, 2026-11-01) a **plaintext** inventory of
what `secrets.enc` protects: every key NAME (never values), their count,
the sha256 of the exact `.env` that was encrypted, and the rotation
timestamp. The owner can open it on GitHub any day and audit key coverage
without trusting anyone's memory. The pre-push hook and `day:start` use it
to prove the live `.env` is fully protected — see “The coverage lock” below.

## The passphrase is NOT in this repo

It exists in exactly two places: the owner's password manager, and the
owner's head. Nobody else. The encryption is AES-256-GCM with a
scrypt-derived key (N=32768) — the repo alone yields nothing without the
passphrase.

### One passphrase for life (owner mandate, ENFORCE-3)

The system **never** expires, rotates, or asks the owner to change the
passphrase. Every restore and every rotation uses the same passphrase.
Changing it is exclusively the owner's personal decision; the procedure:

```bash
echo "<OLD_PASSPHRASE>" | bun scripts/secrets-backup.ts restore   # .env = protected state
echo "<NEW_PASSPHRASE>" | bun scripts/secrets-backup.ts backup     # re-encrypt with the new one
git add backups/ && git commit -m "secrets: passphrase changed by owner" && git push
```

## The coverage lock (ENFORCE-3 — why a key can never be silently unprotected)

Every push of `main` passes through a pre-push hook that REFUSES unless:
1. the live `.env` exists (a truncated env cannot complete a task), and
2. `sha256(live .env)` equals `secrets.manifest`'s `envSha256` (any key
   added/changed since the last rotation blocks the push until the backup
   is rotated — with the owner's passphrase), and
3. the rotation (`secrets.enc` + `secrets.manifest`) is committed (so a
   wipe-recovery always clones the CURRENT protection, never a stale one).

`bun run day:start` checks the same things at day start and auto-rotates
when the owner pipes the passphrase. Adding a key therefore ALWAYS involves
the owner (the passphrase) and ALWAYS reaches GitHub before any task can be
considered done.

## Commands (passphrase always on stdin, never a CLI arg)

```bash
# after healing .env (all required keys non-empty) — rotate the backup:
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts backup
git add backups/secrets.enc backups/secrets.manifest && git commit -m "secrets: rotate backup" && git push

# after a restart truncated .env — restore exactly:
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts restore

# check a saved passphrase against the backup (no writes) + coverage state:
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts verify

# triage after any restart — key names + presence only, values never printed:
bun scripts/secrets-backup.ts status
```

## Rules

- `backup` **refuses** while any required key is empty (an incomplete backup
  is a false sense of security); `--allow-incomplete` exists for testing only.
- `restore` refuses to clobber a *complete* `.env` without `--force`
  (accident guard); a truncated/missing `.env` restores freely — that is the
  disaster it exists for.
- The publish pipeline (`scripts/build-guarded.sh`, env gate v5) separately
  refuses to publish while `.env` is incomplete — a truncated env can never
  ship to production.
- After any `restore`, restart the dev server so the keys load.

## Restart runbook (A–Z) — what happens after a platform restart

**0. AUTOMATIC** (nobody acts): the platform rebuilds the workspace from
GitHub — code, `db/custom.db` (as of the last auto-backup commit), and this
`backups/secrets.enc` all come back with it. The platform then truncates
`.env` to `DATABASE_URL`-only (observed Oct 30 18:52 + Oct 31 06:58). The
app boots degraded: existing session cookies silently fail (fallback dev
secret signs new ones), the Google button reads not-configured, `sync:prod`
would 401. Production (emortrade) is a separate runtime — **zero impact**.

**1. DETECT** (agent, seconds): `bun scripts/secrets-backup.ts status`
→ shows which keys are EMPTY + backup present. (Or the owner just says
"it restarted".)

**2. THE ONE HUMAN STEP** (owner): supply the passphrase from the password
manager. One message. It is stored nowhere on this machine — that is the
design; without it the ciphertext is worthless.

**3. RECOVER** (agent, ~1 min):
```bash
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts restore
( setsid bash -c 'exec bun run dev' >>/tmp/next-dev.out 2>&1 </dev/null & )
```
Then verify: `status` 10/10 · `/` → 200 · `/api/auth/google/start` → 303 with
the right client_id + door callback · a login roundtrip. The restored `.env`
is byte-identical (sha256-proven flow), and the same `AUTH_SECRET` returns,
so existing 30-day session cookies stay valid — **nobody is logged out**.

**4. DATA FRESHNESS** (agent, optional): the restored DB is the last
auto-backup commit. `bun run sync:prod` pulls production's live DB — note:
until the next publish ships the regenerated `DB_EXPORT_TOKEN` to
production, this pull 401-refuses by design (bad token ⇒ abort, never a
stale swap). After that publish the full pull ritual re-arms.

**Guards active throughout**: wrong passphrase → clean refusal, `.env`
untouched · restore over a healthy `.env` refuses without `--force` ·
publishing with a truncated `.env` is blocked by the build-guarded v5 env
gate. Uncommitted work still dies at restart (boot purity sweep) — that is
why every task commits + pushes immediately.


---

## GOOGLE-CLOUD-INTEGRATION keys (2026-10-31)

The env now carries three more required keys (10 total — see REQUIRED_KEYS in
`scripts/secrets-backup.ts`, mirrored in `scripts/build-guarded.sh`):

- `GOOGLE_INTEGRATION_CLIENT_ID` / `GOOGLE_INTEGRATION_CLIENT_SECRET` — the
  second OAuth client (integration client) used for the ONE-TIME Gmail
  connect consent (`gmail.send` only) and future admin-facing Google
  integrations. User sign-in stays on `GOOGLE_CLIENT_ID/_SECRET`.
- `GOOGLE_SERVICE_ACCOUNT_JSON` — the single-line service-account key for
  the Drive/Sheets/Calendar foundation (least-privilege scopes, minted
  per-call, never written to disk; the uploaded plaintext key files were
  shredded after extraction into `.env`).

**The owner should re-run the encrypted backup once** to capture the three
new keys:

```bash
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts backup
```

Until then, the committed `backups/secrets.enc` still holds the previous
7-key .env — a restore would need the three Google keys re-pasted by the
owner. Gmail's OAuth refresh token is NOT in .env by design: it is stored
AES-256-GCM-encrypted in the database (key derived from AUTH_SECRET), so it
survives restarts with the DB git lane and never enters git or .env.
