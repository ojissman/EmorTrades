'use client'

/**
 * RitualLockGate — ENFORCE-4's front of house (owner mandate, 2026-11-01).
 *
 * Wraps the whole app surface (landing + shell). Polls /api/ritual-state:
 *   · DRIFT  → the app is REPLACED by a full-screen lock page until the
 *              missing ritual pull (`bun run sync:prod`) lands. Owner-visible
 *              in preview; agent-verifiable only after the pull — a task
 *              cannot complete while drifted.
 *   · WARN   → a slim amber banner (unpushed work; GitHub behind sandbox).
 *              Non-blocking: an open cycle may still be verified and pushed.
 *   · OK     → children render untouched.
 * FAIL-OPEN: if the state cannot be determined (API down / no git), the app
 * renders normally — a broken guard must never brick the app. The children
 * stay hidden only for the first ~2s while the verdict loads, so a drifted
 * state can never flash the app first.
 */

import { AlertTriangle, Lock, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

interface RitualState {
  level: 'ok' | 'warn' | 'drift' | 'unknown'
  lock: boolean
  reasons: string[]
  detail?: {
    ahead: number
    unpushedFiles: string[]
    lastPullEpoch: number
    lastPullIso: string
    originTipEpoch: number
    originTipIso: string
  }
  checkedAt: string
}

const POLL_MS = 20_000
const FETCH_TIMEOUT_MS = 4_000

export function RitualLockGate({ children }: { children: React.ReactNode }) {
  const [verdict, setVerdict] = useState<RitualState | null>(null)
  const [unreachable, setUnreachable] = useState(false)
  const warnedRef = useRef(false)

  const poll = useCallback(async () => {
    try {
      const ctl = new AbortController()
      const t = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
      const res = await fetch('/api/ritual-state', { signal: ctl.signal, cache: 'no-store' })
      clearTimeout(t)
      if (!res.ok) throw new Error(String(res.status))
      const body = (await res.json()) as RitualState
      setVerdict(body)
      setUnreachable(false)
    } catch {
      setUnreachable(true)
      if (!warnedRef.current) {
        warnedRef.current = true
        console.warn('[ritual-guard] state unreachable — fail-open (app served, nothing locked).')
      }
    }
  }, [])

  useEffect(() => {
    void poll()
    const id = setInterval(() => void poll(), POLL_MS)
    const onFocus = () => {
      if (document.visibilityState === 'visible') void poll()
    }
    document.addEventListener('visibilitychange', onFocus)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onFocus)
      window.removeEventListener('focus', onFocus)
    }
  }, [poll])

  // First verdict not in yet (and not failed-open): hold the app back for the
  // brief moment so a drifted state can never render the app first.
  if (!verdict && !unreachable) return null

  if (verdict?.lock) return <RitualLockPage state={verdict} onRecheck={() => void poll()} />

  return (
    <>
      {verdict?.level === 'warn' && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 top-0 z-[90] flex items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-xs font-medium text-amber-950 sm:text-sm"
        >
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
          <span>
            Unpushed work — GitHub is behind the sandbox
            {verdict.detail?.ahead ? ` by ${verdict.detail.ahead} commit(s)` : ''}. Complete the cycle: verify →
            worklog → commit → push.
          </span>
        </div>
      )}
      {children}
    </>
  )
}

function RitualLockPage({ state, onRecheck }: { state: RitualState; onRecheck: () => void }) {
  return (
    <div
      role="alertdialog"
      aria-live="assertive"
      aria-labelledby="ritual-lock-title"
      className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-background p-4"
    >
      <div className="my-auto w-full max-w-lg rounded-2xl border-2 border-amber-500/70 bg-card p-6 shadow-lg sm:p-8">
        <div className="flex items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <Lock className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h1 id="ritual-lock-title" className="text-lg font-semibold leading-tight sm:text-xl">
              Ritual drift — sandbox locked
            </h1>
            <p className="text-xs text-muted-foreground">ENFORCE-4 · the app returns when the ritual completes</p>
          </div>
        </div>

        <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
          The task ritual is out of order, so this page replaces the app until it is completed. Nothing is lost — the
          lock exists to protect the data.
        </p>

        <ul className="mt-4 space-y-2">
          {state.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-sm leading-relaxed">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
              <span>{r}</span>
            </li>
          ))}
        </ul>

        <div className="mt-5 rounded-xl border bg-muted/50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">To lift the lock</p>
          <ol className="mt-2 list-decimal space-y-2 pl-4 text-sm leading-relaxed">
            <li>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">bun run sync:prod</code> — the missing
              ritual pull (production → sandbox DB)
            </li>
            <li>Verify the task end-to-end in the app</li>
            <li>Append the task entry to worklog.md</li>
            <li>
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">git commit</code> +{' '}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">git push</code> — the enforcement hook
              validates the pull
            </li>
          </ol>
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Checked {state.checkedAt.slice(11, 19)}Z · re-checks every {POLL_MS / 1000}s
          </span>
          <button
            type="button"
            onClick={onRecheck}
            className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-medium transition-colors hover:bg-accent"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Re-check
          </button>
        </div>

        <p className="mt-4 border-t pt-3 text-xs leading-relaxed text-muted-foreground">
          If you did not expect this page, the sandbox is in a drifted state — check with your developer before using
          the app.
        </p>
      </div>
    </div>
  )
}
