#!/bin/bash
# ============================================================================
# dev-watchdog — keeps `bun run dev` alive on this 4GB sandbox.
# ============================================================================
# WHY THIS EXISTS (measured 2025-11-01, five OOM kills in one session):
#   the kernel OOM-killer repeatedly targets next-server when Turbopack
#   compile spikes (~2.5-2.7GB RSS) coincide with other memory users
#   (headless chrome, eslint, tsc, rapid file churn). Every past
#   "preview is not working" episode with a silent dev.log tail matches
#   this signature (dmesg: "Out of memory: Killed process … next-server").
#   Without a watchdog the server stays dead until restarted by hand.
#
# BEHAVIOR:
#   · probes the PORT (bind check, not HTTP — a compiling server still
#     passes, no false kills during cold compiles)
#   · on port death: kills leftovers, restarts `bun run dev`
#   · 60s grace after each start (boot window), restart attempts logged
#     to dev-watchdog.log (append-only evidence trail)
#   · duplicate-instance safe: pkill before start
#
# RUN (detached, survives the tool-shell reaper):
#   start-stop-daemon --start --background --make-pidfile \
#     --pidfile /tmp/dev-watchdog.pid --chdir /home/z/my-project \
#     --startas /bin/bash -- scripts/dev-watchdog.sh
# ============================================================================

PORT=3000
cd /home/z/my-project || exit 1
LAST_START=0

while true; do
  # Bind probe: succeeds while anything listens on the port. During a cold
  # compile the port is already bound (requests just queue), so a healthy
  # compiling server is never mistaken for a dead one.
  if (echo > /dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
    sleep 15
    continue
  fi

  NOW=$(date +%s)
  # Grace window: a freshly started server needs a few seconds to bind.
  if [ "$LAST_START" -gt 0 ] && [ $((NOW - LAST_START)) -lt 60 ]; then
    sleep 10
    continue
  fi

  echo "[watchdog] $(date '+%F %T') port $PORT not listening — restarting dev server" >> dev-watchdog.log
  # Duplicate-instance guard: clear any half-dead tree first.
  pkill -f "next dev" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  sleep 3
  LAST_START=$(date +%s)
  # bun run dev pipes into `tee -a dev.log` itself; discard the outer
  # stdout so lines are not written twice.
  bun run dev > /dev/null 2>&1 &
done
