#!/bin/bash
# BUILD-GUARDED — make `next build` fit this sandbox's 4GB cgroup.
#
# The Publish flow runs this via `bun run build`. A Turbopack build of this
# app (103 API routes + every page) needs ~2.5GB at the compile stage; the
# dev server grows to ~2.2GB after a day of traffic, and the two together
# push the box past 4GB — the kernel OOM-killer then takes down the build
# worker mid-compile. That is what killed the 19:11 publish attempt
# (.next frozen at "compile", no error output, three OOM kills logged).
#
# v2 (DEPLOY-2): the 19:49 publish attempt proved the build itself now
# succeeds (exit 0, zero OOM, standalone assembled) — yet the platform still
# reported "problem deploying the code". The recovered timeline shows the
# preview was dark ~95s: ~40s of build (unavoidable — the build needs the
# memory the dev server holds) plus a 45s delayed revival from v1. If the
# platform health-checks the app when `bun run build` returns, it saw a
# dead preview. v2 restores the app BEFORE the script returns and waits
# until :3000 answers 200 — `bun run build` now never comes back with the
# app down.
#
# v3 (SWEEP-1): the keepalive watchdog was removed at the owner's request.
# Restore now relaunches `bun run dev` directly (no watchdog anywhere).
#
# v5 (RESTART-RECOVERY): ENV GATE — a platform restart truncated the
#   workspace .env to DATABASE_URL-only (Oct 30 18:52) and again (Oct 31
#   06:58). .env is deliberately gitignored (secrets never enter git), so
#   GitHub restore cannot heal it. Publishing a truncated .env would REPLACE
#   production's complete .env and break auth/OAuth/sync there. The gate
#   aborts the publish BEFORE stopping dev if any required key is missing
#   or empty — the failure mode can no longer silently ship.
#
# v4 (P1 / Option 2): PUBLISH-TIME FRESHNESS PULL. After stopping dev and
# BEFORE building, scripts/sync-prod-db.ts pulls production's database and
# swaps it into db/custom.db — so the platform's database-runtime-build.sh
# (which copies db/custom.db into the deploy AFTER this build) ships
# production's data + the new code: an upgrade, not a replacement.
#   · pull says BOOTSTRAP-SKIP (404 — route not yet on production, i.e. the
#     very first publish after P1) → build continues with the current DB.
#   · pull FAILS (bad token, corrupt payload, destructive-drift tripwire)
#     → build ABORTS (exit 1) rather than shipping stale or damaged data.
#
# Sequence:
#   0. ENV GATE — all required .env keys present and non-empty (fail fast,
#      before anything is stopped or touched)
#   1. stop the dev server — the compiler gets the whole cgroup to itself
#   2. SYNC: pull production DB → swap → strict schema push (Option 2)
#   3. next build (unchanged semantics), then assemble the standalone bundle
#   4. RESTORE: relaunch dev, wait for :3000 to answer 200, exit.
#      The EXIT trap runs the same idempotent restore on failure paths.
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[build-guarded $(date '+%H:%M:%S')] $*"; }

# 0 · ENV GATE (v6) — publish ships the workspace .env to production.
#      A platform restart can truncate it; refuse to publish an incomplete
#      one. Runs before anything is stopped, so an abort costs nothing.
#      GOOGLE_SERVICE_ACCOUNT_JSON is deliberately NOT required (Workspace
#      APIs are on-demand; key not yet supplied — whole-file publish carries
#      it automatically once it lands in .env). Mirrors REQUIRED_KEYS in
#      scripts/secrets-backup.ts.
REQUIRED_ENV_KEYS=(DATABASE_URL PUBLIC_ORIGIN DEV_ORIGIN AUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET GOOGLE_INTEGRATION_CLIENT_ID GOOGLE_INTEGRATION_CLIENT_SECRET DB_EXPORT_TOKEN)
ENV_GATE_FAILED=0
for _k in "${REQUIRED_ENV_KEYS[@]}"; do
  _v="$(grep -m1 "^${_k}=" .env 2>/dev/null | cut -d= -f2- | tr -d '[:space:]')"
  if [ -z "$_v" ]; then
    log "ENV GATE: required key ${_k} is missing or empty in .env"
    ENV_GATE_FAILED=1
  fi
done
if [ "$ENV_GATE_FAILED" -ne 0 ]; then
  log "ENV GATE FAILED — publish aborted. Heal .env (all keys above, non-empty) and retry."
  log "This protects production: publish replaces its .env, and a truncated one would break auth there."
  exit 1
fi
log "env gate: all ${#REQUIRED_ENV_KEYS[@]} required keys present"

# Idempotent: safe to call twice (explicit success path + EXIT trap).
restore_services() {
  if ! curl -s --max-time 2 -o /dev/null http://localhost:3000/ 2>/dev/null; then
    pgrep -f "next dev -p 3000" >/dev/null 2>&1 || \
      ( setsid bash -c 'exec bun run dev' >>/tmp/next-dev.out 2>&1 </dev/null & )
  fi
}
trap 'restore_services' EXIT

# 1 · stop the dev server and wait for port 3000 to go dark
pkill -f "next dev -p 3000" 2>/dev/null || true
pkill -f "bun run dev" 2>/dev/null || true
for _ in $(seq 1 15); do
  curl -s --max-time 2 -o /dev/null http://localhost:3000/ 2>/dev/null || break
  sleep 1
done
pkill -f "next-server" 2>/dev/null || true   # stragglers still holding the port
for _ in $(seq 1 10); do
  curl -s --max-time 2 -o /dev/null http://localhost:3000/ 2>/dev/null && sleep 1 || { log "port 3000 free"; break; }
done
log "dev stopped — free: $(free -m | awk '/^Mem:/{print $4"MB used:"$3"MB"}')"

# 2 · Option 2 freshness pull: production DB → workspace DB, strict schema.
#     Exit 1 from the sync ABORTS the publish (EXIT trap restores dev).
if bun scripts/sync-prod-db.ts --no-dev; then
  log "sync step finished"
else
  log "SYNC FAILED — aborting publish (nothing stale ships; dev restored via EXIT trap)"
  exit 1
fi

# 3 · build with the whole cgroup available
STATUS=0
./node_modules/.bin/next build || STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  log "BUILD FAILED (exit $STATUS) — restoring app via EXIT trap"
  exit "$STATUS"
fi

# 4 · assemble the standalone bundle (same steps the original script had)
cp -r .next/static .next/standalone/.next/ || STATUS=$?
cp -r public .next/standalone/ || STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  log "ASSEMBLY FAILED (exit $STATUS) — restoring app via EXIT trap"
  exit "$STATUS"
fi
log "standalone assembled"

# 5 · bring the app back BEFORE this script returns — the platform may
#     health-check the preview the moment `bun run build` exits.
restore_services
for _ in $(seq 1 30); do
  if curl -s --max-time 2 -o /dev/null http://localhost:3000/ 2>/dev/null; then
    log "app serving again — build complete, preview healthy"
    exit 0
  fi
  sleep 2
done
log "WARNING: app not answering after 60s — restore once more, then report; the build itself succeeded"
restore_services
exit 0
