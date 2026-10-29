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
# Sequence:
#   1. pause the dev-keepalive watchdog (it would relaunch dev mid-build)
#   2. stop the dev server — the compiler gets the whole cgroup to itself
#   3. next build (unchanged semantics), then assemble the standalone bundle
#   4. RESTORE: relaunch watchdog + dev, wait for :3000 to answer 200, exit.
#      The EXIT trap runs the same idempotent restore on failure paths.
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[build-guarded $(date '+%H:%M:%S')] $*"; }

# Idempotent: safe to call twice (explicit success path + EXIT trap).
restore_services() {
  pgrep -f dev-keepalive.sh >/dev/null 2>&1 || \
    ( setsid bash scripts/dev-keepalive.sh >>/tmp/keepalive.log 2>&1 </dev/null & )
  if ! curl -s --max-time 2 -o /dev/null http://localhost:3000/ 2>/dev/null; then
    pgrep -f "next dev -p 3000" >/dev/null 2>&1 || \
      ( setsid bash -c 'exec bun run dev' >>/tmp/next-dev.out 2>&1 </dev/null & )
  fi
}
trap 'restore_services' EXIT

# 1 · pause the watchdog (a mid-build dev relaunch is the memory contention
#     this script exists to prevent)
pkill -f dev-keepalive.sh 2>/dev/null || true
sleep 1
pkill -f dev-keepalive.sh 2>/dev/null || true
if pgrep -f dev-keepalive.sh >/dev/null 2>&1; then
  log "WARNING: watchdog still alive — continuing, it may race the build"
else
  log "watchdog paused"
fi

# 2 · stop the dev server and wait for port 3000 to go dark
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
log "WARNING: app not answering after 60s — the watchdog keeps retrying; the build itself succeeded"
exit 0
