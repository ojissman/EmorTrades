# backups/ — encrypted secrets backup (Option A, RESTART-RECOVERY)

## What lives here

`secrets.enc` — an AES-256-GCM encrypted copy of the workspace `.env`,
created by `scripts/secrets-backup.ts` and **committed to this private repo
on purpose**. This is the recovery source for the restart failure mode where
the platform truncates `.env` to `DATABASE_URL`-only: `.env` itself is
gitignored (secrets never enter git in plain form), so without this file a
restart had NO recovery source for the keys.

## The passphrase is NOT in this repo

It exists in exactly two places: the owner's password manager, and the
owner's head. Nobody else. The encryption is AES-256-GCM with a
scrypt-derived key (N=32768) — the repo alone yields nothing without the
passphrase.

## Commands (passphrase always on stdin, never a CLI arg)

```bash
# after healing .env (all 7 required keys non-empty) — rotate the backup:
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts backup
git add backups/secrets.enc && git commit -m "secrets: rotate backup" && git push

# after a restart truncated .env — restore exactly:
echo "$PASSPHRASE" | bun scripts/secrets-backup.ts restore

# check a saved passphrase against the backup (no writes):
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
