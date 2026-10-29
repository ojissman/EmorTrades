#!/bin/bash
# BUILD-GUARDED — make `next build` fit this sandbox's 4GB cgroup.
#
# The Publish flow runs this via `bun run build`. A Turbopack build of this
# app (103 API routes + every page) needs ~2-2.5GB at the compile stage; the
# dev server grows to ~2GB after a day of traffic, and the two together push
# the box past 4GB — the kernel OOM-killer then takes down the build worker
# mid-compile. That is exactly what killed the 19:11 publish attempt
# (.next/build frozen at "compile", no error output, three OOM kills logged).
#
# Sequence:
#   1. pause the dev-keepalive watchdog (it would relaunch dev mid-build)
#   2. stop the dev server — the compiler gets the whole cgroup to itself
#   3. next build (unchanged semantics), then assemble the standalone bundle
#   4. on exit, revive the watchdog on a 45s delay. The delay lets the
#      platform finish any post-build step; the watchdog probes :3000 first
#      and only relaunches dev if the port is still dark, so it can never
#      collide with a production server that took the port over.
set -uo pipefail
cd "$(dirname "$0")/.."

log() { echo "[build-guarded $(date '+%H:%M:%S')] $*"; }

schedule_watchdog_revival() {
  if pgrep -f dev-keepalive.sh >/dev/null 2>&1; then return 0; fi
  # 45s grace: never race the platform's own post-build steps for port 3000.
  ( sleep 45
    pgrep -f dev-keepalive.sh >/dev/null 2>&1 || \
      ( setsid bash scripts/dev-keepalive.sh >>/tmp/keepalive.log 2>&1 </dev/null & )
  ) &
}
trap schedule_watchdog_revival EXIT

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
  curl -s --max-time 2 -o /dev/null http://localhost:3000/ || break
  sleep 1
done
pkill -f "next-server" 2>/dev/null || true   # stragglers still holding the port
for _ in $(seq 1 10); do
  curl -s --max-time 2 -o /dev/null http://localhost:3000/ && sleep 1 || { log "port 3000 free"; break; }
done
log "dev stopped — free: $(free -m | awk '/^Mem:/{print $4"MB used:"$3"MB"}')"

# 3 · build with the whole cgroup available
STATUS=0
./node_modules/.bin/next build || STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  log "BUILD FAILED (exit $STATUS) — see above; dev/watchdog restore via EXIT trap"
  exit "$STATUS"
fi

# 4 · assemble the standalone bundle (same steps the old script had)
cp -r .next/static .next/standalone/.next/ || STATUS=$?
cp -r public .next/standalone/ || STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  log "ASSEMBLY FAILED (exit $STATUS)"
  exit "$STATUS"
fi
log "standalone assembled — watchdog revives in ~45s (relaunches dev only if :3000 is still dark)"
exit 0
