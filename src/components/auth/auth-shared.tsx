'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ExternalLink, Loader2, ShieldQuestion } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useBotConfig } from './use-bot-config'

/**
 * AUTH SHARED — the pieces every public auth surface uses:
 *   · GoogleIcon / GoogleButton — Gmail one-click sign-in (gracefully
 *     explains setup when the server has no Google keys yet)
 *   · Honeypot — the hidden input bots fill and humans never see
 *   · useElapsed — honest "form was rendered at" timing for the bot screen
 *   · AuthShell — premium split-screen frame for the sign-in / register forms
 */

/* ── Google mark (official four-color G) ──────────────────────────────────── */

export function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47a5.57 5.57 0 0 1-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09A11.99 11.99 0 0 0 12 24z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.29A7.2 7.2 0 0 1 4.89 12c0-.8.14-1.57.38-2.29V6.62H1.29a12 12 0 0 0 0 10.76l3.98-3.09z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42A11.97 11.97 0 0 0 12 0 11.99 11.99 0 0 0 1.29 6.62l3.98 3.09C6.22 6.86 8.87 4.75 12 4.75z"
      />
    </svg>
  )
}

/* ── Google button (with graceful not-configured dialog) ─────────────────── */

export function GoogleButton({
  label = 'Continue with Google',
  onNavigate,
  className,
}: {
  label?: string
  /** Called right before navigating away (forms use it to show a pending state). */
  onNavigate?: () => void
  className?: string
}) {
  const { data: config, isLoading } = useBotConfig()
  const [setupOpen, setSetupOpen] = useState(false)
  const [redirecting, setRedirecting] = useState(false)

  function start() {
    if (config && !config.google.enabled) {
      setSetupOpen(true)
      return
    }
    setRedirecting(true)
    onNavigate?.()
    window.location.href = '/api/auth/google/start'
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={start}
        disabled={isLoading || redirecting}
        className={cn(
          'w-full h-11 bg-slate-900/60 border-slate-700 text-slate-100 hover:bg-slate-800 hover:border-slate-600 hover:text-white',
          className
        )}
        aria-label={label}
      >
        {redirecting ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <GoogleIcon className="h-4.5 w-4.5" />
        )}
        <span className="ml-1.5">{redirecting ? 'Redirecting to Google…' : label}</span>
      </Button>

      <Dialog open={setupOpen} onOpenChange={setSetupOpen}>
        <DialogContent className="bg-[#0e1626] border-slate-800 text-slate-100 max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-slate-100">
              <ShieldQuestion className="h-5 w-5 text-emerald-400" aria-hidden />
              Google sign-in needs 2-minute setup
            </DialogTitle>
            <DialogDescription className="text-slate-400 text-left space-y-3 pt-2">
              <p>
                Google requires every app to register for sign-in — this keeps your Gmail safe.
                Once the keys below are added, the <strong className="text-slate-200">Continue with
                Google</strong> button works instantly for registration <em>and</em> login (Gmail
                accounts skip email verification — Google has already verified them).
              </p>
              <ol className="list-decimal list-inside space-y-1.5 text-sm text-slate-300">
                <li>
                  Open{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    className="text-emerald-400 hover:text-emerald-300 underline underline-offset-2 inline-flex items-center gap-1"
                  >
                    Google Cloud Credentials <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>{' '}
                  (free account)
                </li>
                <li>Create an <strong className="text-slate-200">OAuth client ID</strong> — type: <em>Web application</em></li>
                <li>
                  Add this <strong className="text-slate-200">Authorized redirect URI</strong>:
                  <code className="block mt-1 px-2 py-1 rounded bg-slate-900 border border-slate-800 text-[11px] text-emerald-300 break-all">
                    {typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback
                  </code>
                </li>
                <li>
                  Put <code className="text-emerald-300">GOOGLE_CLIENT_ID</code> and{' '}
                  <code className="text-emerald-300">GOOGLE_CLIENT_SECRET</code> into the app&apos;s{' '}
                  <code className="text-emerald-300">.env</code> file and restart the server
                </li>
              </ol>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              onClick={() => {
                setSetupOpen(false)
                toast.info('Email + password sign-up works right now — Google can be added anytime.')
              }}
              className="bg-emerald-600 hover:bg-emerald-500 text-white"
            >
              Got it
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/* ── Honeypot — the input only bots can see ──────────────────────────────── */

export function Honeypot({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      name="website"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      tabIndex={-1}
      autoComplete="off"
      aria-hidden="true"
      className="absolute -left-[9999px] top-auto h-0 w-0 overflow-hidden opacity-0"
    />
  )
}

/** Timestamp of form mount — the honest timing signal for the bot screen. */
export function useElapsed(): React.RefObject<number> {
  const mountedAt = useRef(Date.now())
  return mountedAt
}

/* ── AuthShell — premium split-screen frame for auth forms ───────────────── */

const SHELL_POINTS = [
  { value: '40+', label: 'journal & analytics pages' },
  { value: '7', label: 'AI assistants on your desk' },
  { value: '5 formats', label: 'one-click trade import' },
]

export function AuthShell({
  children,
  side,
}: {
  children: ReactNode
  /** Extra content for the brand panel bottom (optional). */
  side?: ReactNode
}) {
  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#0b1220] text-slate-100">
      {/* Brand panel — desktop only */}
      <aside className="hidden lg:flex lg:w-[46%] xl:w-[42%] relative overflow-hidden flex-col justify-between p-10 xl:p-14 border-r border-slate-800/60">
        {/* ambient background */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -top-32 -left-24 h-96 w-96 rounded-full bg-emerald-500/10 blur-3xl" />
          <div className="absolute bottom-0 -right-24 h-80 w-80 rounded-full bg-teal-500/10 blur-3xl" />
          <div
            className="absolute inset-0 opacity-[0.35]"
            style={{
              backgroundImage:
                'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
              backgroundSize: '44px 44px',
            }}
          />
        </div>

        <div className="relative">
          <a href="#/" className="inline-flex items-center gap-3 group" aria-label="EmorTrades home">
            <img
              src="/logo.png"
              alt="EmorTrades logo — institute of trading"
              className="h-11 w-11 drop-shadow-[0_0_14px_rgba(16,185,129,0.35)]"
            />
            <span className="text-lg font-semibold tracking-tight">
              Emor<span className="text-emerald-400">Trades</span>
            </span>
          </a>
        </div>

        <div className="relative space-y-6 max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-3xl xl:text-4xl font-bold tracking-tight leading-tight"
          >
            Your trades, journaled.
            <br />
            <span className="bg-gradient-to-r from-emerald-300 via-emerald-400 to-teal-300 bg-clip-text text-transparent">
              Your edge, engineered.
            </span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-slate-400 leading-relaxed"
          >
            An AI desk that reviews every trade, briefs you before the bell, and finds the patterns
            hiding in your own data — with bot-proof, verified accounts.
          </motion.p>
          <motion.ul
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="flex flex-wrap gap-x-6 gap-y-2"
            aria-label="EmorTrades highlights"
          >
            {SHELL_POINTS.map((p) => (
              <li key={p.label} className="flex items-baseline gap-2">
                <span className="text-xl font-bold text-emerald-400 tabular-nums">{p.value}</span>
                <span className="text-xs text-slate-500">{p.label}</span>
              </li>
            ))}
          </motion.ul>
          {side}
        </div>

        <p className="relative text-xs text-slate-600">
          © {new Date().getFullYear()} EmorTrades · Institute of Trading
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex-1 flex flex-col">
        <header className="p-4 lg:p-6">
          <a
            href="#/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-200 transition-colors min-h-[44px]"
            aria-label="Back to landing page"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Back
          </a>
        </header>
        <div className="flex-1 flex items-center justify-center px-4 pb-16">{children}</div>
      </main>
    </div>
  )
}

/**
 * URL-param toaster — surfaces the outcome of email-link verification and
 * Google sign-in redirects as toasts, then cleans the URL.
 */
export function UrlParamToaster() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const verified = params.get('verified')
    const welcome = params.get('welcome')
    const googleError = params.get('googleError')

    if (verified === '1') toast.success('Email verified — welcome to EmorTrades!')
    else if (verified === '0')
      toast.error('That verification link is invalid or has expired.', {
        description: 'Sign in with your email and password to get a fresh link.',
      })
    else if (welcome === 'google') toast.success('Signed in with Google — welcome aboard!')

    if (googleError) {
      const messages: Record<string, string> = {
        cancelled: 'Google sign-in was cancelled.',
        state: 'Google sign-in failed a security check — please try again.',
        suspended: 'That account has been suspended. Contact an administrator.',
        'not-configured': 'Google sign-in is not configured on this server yet.',
        unverified: 'Google could not verify that email address.',
        failed: 'Google sign-in failed. Please try again.',
      }
      toast.error(messages[googleError] ?? 'Google sign-in failed. Please try again.')
    }

    if (verified || welcome || googleError) {
      // Clean the URL without reloading
      window.history.replaceState({}, '', window.location.pathname + window.location.hash)
    }
  }, [])
  return null
}
