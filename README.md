# EmorTrades

EmorTrades is a multi-user, AI-powered trading journal. It turns raw executions
into a complete journaling workspace: a trades table with a deep drill-down
editor, a premium trading calendar, an analytics library with dozens of KPI
engines, an AI suite (daily briefing, trade reviews, coaching, period reports),
trading plans with versioning and goals/challenges, and a full admin console.
Built as a single Next.js app with a SQLite-backed Prisma data layer.

## Tech Stack

| Layer      | Technology                                             |
| ---------- | ------------------------------------------------------ |
| Framework  | Next.js 16 (App Router) + React 19                     |
| Language   | TypeScript (strict)                                    |
| Styling    | Tailwind CSS 4 + shadcn/ui + Radix primitives          |
| Data       | Prisma ORM + SQLite                                    |
| State      | Zustand stores + TanStack Query                        |
| Charts     | AG Charts, AG Grid, Recharts, FullCalendar             |
| AI         | Z.ai SDK + pluggable providers (OpenAI, Anthropic, …)  |
| Testing    | Vitest                                                 |
| Runtime    | Bun (package manager, scripts, prod server)            |

## Requirements

- **Bun ≥ 1.1**
- **Node.js 20+**

## Setup

```bash
git clone <your-repo-url> emortrades
cd emortrades
bun install
cp .env.example .env
# → set DATABASE_URL (SQLite path) and AUTH_SECRET (openssl rand -hex 32)
bun run db:push      # create/sync the database schema
bun run dev          # start the dev server
```

Open http://localhost:3000 — the first registered account is a normal user;
admin roles are managed through the admin console.

## Scripts

| Command               | What it does                                                            |
| --------------------- | ----------------------------------------------------------------------- |
| `bun run dev`         | Start the Next.js dev server on port 3000 (logs to `dev.log`)            |
| `bun run build`       | Guarded production build (`scripts/build-guarded.sh`): fits the memory   |
|                       | budget, refuses to publish with required env keys missing, and revives   |
|                       | the running app before returning                                         |
| `bun run start`       | Run the standalone production build (`bun .next/standalone/server.js`)   |
| `bun run lint`        | ESLint over the whole repo                                               |
| `bun run test`        | Run the Vitest suite once                                                |
| `bun run db:push`     | Push the Prisma schema to the database                                   |
| `bun run db:generate` | Regenerate the Prisma client                                             |
| `bun run sync:prod`   | Pull a DB export from production into the local sandbox                  |
| `bun run day:start`   | New-day gate: clean tree, fast-forward pull, install, smoke check        |
| `bun run hooks:install` | Install the git pre-push enforcement hook                              |

## Testing

```bash
bun run test        # Vitest, one-shot
```

The suite covers the KPI engines, import pipeline, plan/warning logic,
timezone math, and auth flows (see `tests/`).

## Project Structure

```
├── prisma/            # schema.prisma — 60+ models, single source of truth
├── scripts/           # ops: guarded build, DB sync, day-start gate, seeding
├── src/
│   ├── app/           # App Router: API routes (src/app/api/**) + public pages
│   ├── components/    # SPA UI: pages, shell, calendar, dashboards, admin
│   ├── config/        # page-registry (route → page), navigation, AI roster
│   ├── hooks/         # client hooks (settings, hotkeys, toasts, …)
│   ├── lib/           # KPI engines, import pipeline, AI providers, server
│   │   │              #   auth, guards, rate limiting, email, integrations
│   └── store/         # Zustand stores (auth, filters, alerts, theme)
└── uploads/           # runtime user uploads (must persist across deploys)
```

The journal is a single-page application: `src/config/page-registry.tsx` maps
every nav route to its page component, and the shell renders them client-side.
`src/app/api/**` exposes the REST surface (auth, trades, analytics, plans,
AI, admin) consumed by that SPA.

## Deployment

1. Set `PUBLIC_ORIGIN`, `AUTH_SECRET`, and `DATABASE_URL` in `.env`
   (see `.env.example` for the full list — the guarded build validates its
   own required set before publishing).
2. Build with `bun run build` (runs `scripts/build-guarded.sh`).
3. Start with `bun run start` — the standalone server (`server.js`).
4. Terminate TLS at a reverse proxy (Caddy/Nginx) in front of port 3000.
5. The `uploads/` directory holds user content — mount/persist it across
   deployments.
6. Run `bun run sync:prod` only from trusted environments: it authenticates
   with the admin `DB_EXPORT_TOKEN` and pulls production data.

## Security Notes

- Passwords are hashed with **scrypt** (per-user salt); sessions are
  HMAC-signed cookies — see `src/lib/server/auth.ts`.
- Every API route applies per-route guards (`requireUser`, admin RBAC,
  ownership scoping on every record).
- Optional **Cloudflare Turnstile** bot protection on register/login
  (enable by setting both `TURNSTILE_*` keys).
- Rate limiting is **in-memory** — effective for a single instance; put a
  real WAF/limiter in front of multi-instance deployments.
- AI provider keys and integration secrets are read server-side only and
  are never exposed to the client bundle.
