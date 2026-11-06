# mt5-link — self-hosted read-only MetaTrader 5 connector for EmorTrades
# ============================================================================
# MIT licensed (LICENSE). Shipped with the EmorTrades repo (Task MT5LINK,
# 2026-11-06).
#
# WHY THIS EXISTS
#   EmorTrades is hosted on Z.ai Space, which cannot run MT5 terminals
#   (verified 2026-11-06: no Docker, no Wine, no sudo, 4GB shared RAM).
#   MT5 terminals are Windows programs; reading a broker account requires a
#   terminal session somewhere. This service runs on ANY Linux host with
#   Docker (your VPS or home server), keeps ONE headless MT5 terminal per
#   connected journal account, and talks to the journal over an
#   authenticated HTTPS API. End users never install anything — they just
#   enter their MT5 login/password/server in the journal's
#   Tools → MetaTrader 5 page.
#
# HOW IT WORKS
#
#   Browser ──session──▶ EmorTrades (Z.ai)  ◀──HTTPS + shared token──  mt5-link (this service, your host)
#                             │                                        │ docker (one per account)
#                             │ AES-256-GCM-encrypted creds at rest    ▼
#                             │                              elitekaycy/mt5-gateway container
#                             │                              (MIT; MT5 terminal under Wine)
#                             └─ trades imported idempotently ◀─────── reads /account + /history_deals_*
#
#   · mt5-link polls the journal every 60s (POLL_SECONDS) for pending work.
#   · For each connection it spawns a gateway container with that account's
#     credentials (never logged, bind to 127.0.0.1 only).
#   · On login it reports the account snapshot; then it syncs every
#     SYNC_SECONDS (300s default) or on the user's "Sync now".
#   · Each sync sends the COMPLETE deal set of every position touched since
#     the last sync — the journal recomputes truth (partial closes, dedup,
#     P&L) idempotently, so overlap/reports are always safe.
#
# READ-ONLY BY CONSTRUCTION
#   1. mt5-link only CALLS the gateway's read endpoints: /health/ready,
#      /account, /history_deals_range, /history_deals_get. There is no
#      order/close/modify call anywhere in its source.
#   2. It mounts a kill-switch file into every gateway container
#      (/config/kill-switch) — the gateway's own trading kill-switch.
#   3. The journal side has NO order endpoints at all, and MT5 passwords are
#      AES-256-GCM-encrypted at rest; only the token-gated pending route
#      ever decrypts them, and only for a correctly-authenticated poll.
#
# ── Quick start (native, recommended) ────────────────────────────────────────
#
#   # 1. Any Linux host with Docker (see SIZING below). Node >= 20.
#   node --version
#
#   # 2. Copy this mt5-link/ folder to the host, then:
#   cd mt5-link
#   mkdir -p data
#
#   # 3. Run it:
#   JOURNAL_URL="https://your-emortrades-url" \
#   JOURNAL_TOKEN="the-MT5_CONNECTOR_TOKEN-from-your-journal-server-env" \
#   node src/main.mjs
#
#   # 4. Watch it come online in the journal (Tools → MetaTrader 5 — the
#   #    banner turns green within a minute), then connect an account in the
#   #    UI. Use a DEMO MT5 account first.
#
#   For always-on: systemd unit or docker compose (below).
#
# ── Quick start (containerized) ──────────────────────────────────────────────
#
#   mkdir -p /opt/mt5-link && cp -r mt5-link/* /opt/mt5-link/
#   cd /opt/mt5-link && mkdir -p data
#   cat > .env <<EOF
#   JOURNAL_URL=https://your-emortrades-url
#   JOURNAL_TOKEN=the-MT5_CONNECTOR_TOKEN
#   EOF
#   # compose expects the host dir /opt/mt5-link/data (matches
#   # KILL_SWITCH_HOST_FILE inside docker-compose.yml)
#   docker compose up -d --build && docker compose logs -f
#
# ── Configuration (env) ──────────────────────────────────────────────────────
#
#   JOURNAL_URL        (required) EmorTrades origin, e.g. https://emortrade…
#   JOURNAL_TOKEN      (required) equals the journal's MT5_CONNECTOR_TOKEN.
#                      Grant a poll+report on /api/mt5/connector/* and
#                      nothing else. Generate: openssl rand -hex 24.
#   POLL_SECONDS       default 60  — journal poll cadence.
#   SYNC_SECONDS       default 300 — per-account sync cadence.
#   MT5_GATEWAY_IMAGE  default elitekaycy/mt5-gateway-api:latest — pin a
#                      digest for reproducibility if you prefer.
#   PORT_BASE/PORT_MAX default 15100-15999 — localhost ports for gateways.
#   READY_TIMEOUT_S    default 900 — how long to wait for a terminal login
#                      (first pull downloads the MT5 terminal: minutes).
#   FULL_HISTORY_FROM  default 2015-01-01 — first-import window. Actual depth
#                      depends on what the broker/terminal serves.
#   KILL_SWITCH_FILE / KILL_SWITCH_HOST_FILE — see docker-compose.yml.
#
# ── SIZING & REAL COSTS (no marketing — measured expectations) ──────────────
#
#   Each gateway container runs a full MT5 terminal under Wine:
#     · RAM: ~0.8-1.2 GB steady per terminal, spikes ~2 GB on start.
#     · Disk: ~4-6 GB per terminal (Wine prefix + MT5) — a 25-40 GB disk
#       comfortably fits 3-5 accounts.
#     · CPU: light when idle (history syncs are cheap); Wine is not fast.
#
#   Honest 2026 price ballparks for a small Linux VPS (unavoidable cost —
#   this is the only thing you pay for; the software stack is all free/MIT):
#     · Hetzner CX22 (2 vCPU / 4 GB / 40 GB):   ~€4/mo  — 2-3 accounts
#     · Contabo Cloud VPS 30 (4 GB / 80 GB):   ~$6/mo   — 3-4 accounts
#     · DigitalOcean 4 GB / 80 GB:             ~$24/mo  — 3-4 accounts
#   A Windows VPS also works (mt5-gateway runs under Wine on Linux, which is
#   cheaper). MT5 terminals + demo accounts are free. Nothing here is a paid
#   API: no MetaApi, no subscription, no per-user fee.
#
# ── Security notes ───────────────────────────────────────────────────────────
#
#   · Keep the host patched; the journal token lives only in this service's
#     environment. If it leaks: rotate MT5_CONNECTOR_TOKEN on the journal
#     AND rotate MT5_CREDENTIAL_KEY (stored passwords re-enter).
#   · Gateway containers bind to 127.0.0.1 — never reachable from outside.
#   · On disconnect, the per-account Docker volume (terminal profile, which
#     stores the broker session) is deleted.
#   · The journal enforces user-level isolation: each user only ever sees
#     their own connections and trades.
#
# ── Troubleshooting ──────────────────────────────────────────────────────────
#
#   · "terminal not ready after 900s" → wrong password/server name (must be
#     EXACT, e.g. Exness-MT5Trial9), or the broker blocks Wine logins.
#   · Connection stuck "Waiting for connector" → JOURNAL_TOKEN mismatch or
#     this service not polling: check `docker compose logs -f mt5-link`.
#   · Zero history imported → the terminal's History tab range limits what
#     the broker serves; open the terminal once with "All History", or set
#     FULL_HISTORY_FROM and reconnect.
#   · This service cannot verify broker connectivity from inside a host
#     without internet egress to your broker's MT5 server (port 443/1888…).
