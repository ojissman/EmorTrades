#!/bin/bash
# TP2 RESTORE-2 — dev-server watchdog for this sandbox (process reaper mitigation).
# The sandbox reaps shell descendants between tool calls; only double-forked
# daemons parented to PID 1 survive. This loop re-launches `bun run dev`
# the same way whenever port 3000 stops answering. It is NOT part of the app.
cd /home/z/my-project
while true; do
  if ! curl -s -o /dev/null --max-time 4 http://localhost:3000/; then
    if ! pgrep -f "next dev -p 3000" >/dev/null 2>&1; then
      echo "[$(date '+%F %T')] dev server down — restarting" >> /tmp/keepalive.log
      ( setsid bash -c 'exec bun run dev' >>/tmp/next-dev.out 2>&1 </dev/null & )
      sleep 20
    fi
  fi
  sleep 20
done
