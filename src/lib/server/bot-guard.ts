/**
 * ============================================================================
 * BOT GUARD — automatic bot detection & prevention for public auth endpoints
 * ============================================================================
 * Two layers, both automatic:
 *
 * 1) SMART HEURISTICS (always on, zero config)
 *    · Honeypot field     — hidden "website" input; humans never fill it.
 *    · Timing check       — forms submitted faster than ~1s aren't human.
 *    · User-Agent screen  — missing UA or known bot/crawler/tool UAs blocked.
 *    · Disposable emails  — temp-mail domains rejected at registration.
 *    · Rate limiting      — callers still apply per-IP limits (existing).
 *
 * 2) CLOUDFLARE TURNSTILE (auto-activates when keys exist)
 *    · TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY in .env → the register and
 *      login forms render the invisible-friendly Turnstile widget and the
 *      server verifies the token with Cloudflare. Until then the heuristic
 *      layer carries the protection.
 *
 * Every blocked attempt is written to AuthLog (see lib/server/auth-log) so
 * the Admin Console ▸ Security tab shows exactly what was stopped.
 */

/** Common disposable/temporary email domains (registration-only check). */
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'guerrillamail.com', '10minutemail.com', 'tempmail.com',
  'temp-mail.org', 'yopmail.com', 'throwawaymail.com', 'getnada.com',
  'dispostable.com', 'sharklasers.com', 'trashmail.com', 'fakeinbox.com',
  'maildrop.cc', 'mintemail.com', 'mytemp.email', 'moakt.com', 'tmpmail.org',
  'emailondeck.com', 'spam4.me', 'mailnesia.com', 'tempinbox.com',
  'burnermail.io', 'anonaddy.com', '33mail.com', 'mailcatch.com',
])

/** User-Agent signatures of scripted clients (never a real browser). */
const BOT_UA_RE =
  /(bot|crawler|spider|scrapy|curl|wget|python-requests|python-urllib|httpclient|okhttp|java\/|go-http-client|node-fetch|axios|headlesschrome|phantomjs|puppeteer|playwright|selenium|libwww)/i

export interface BotSignals {
  /** Hidden honeypot input value — any content means a bot filled it. */
  honeypot?: string | null
  /** Milliseconds between the form rendering and submitting. */
  elapsedMs?: number | null
  /** The address being registered (disposable-domain screen). */
  email?: string | null
  /** Cloudflare Turnstile token from the widget (when configured). */
  turnstileToken?: string | null
  /** Remote client IP (for Turnstile's siteverify). */
  ip?: string | null
}

export type ScreenResult =
  | { ok: true }
  | { ok: false; status: number; message: string; reason: string }

/* ── Cloudflare Turnstile ─────────────────────────────────────────────────── */

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY)
}

/** What the admin console / landing show as the active protection mode. */
export function botProtectionMode(): 'turnstile+heuristics' | 'heuristics' {
  return turnstileConfigured() ? 'turnstile+heuristics' : 'heuristics'
}

async function verifyTurnstile(token: string, ip?: string | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const body = new URLSearchParams({
      secret: process.env.TURNSTILE_SECRET_KEY as string,
      response: token,
    })
    if (ip) body.set('remoteip', ip)
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const data = (await res.json().catch(() => ({}))) as { success?: boolean; 'error-codes'?: string[] }
    if (data.success) return { ok: true }
    return { ok: false, error: (data['error-codes'] || []).join(', ') || 'verification failed' }
  } catch (e: any) {
    // Network failure verifying with Cloudflare — fail CLOSED (bot may be
    // exploiting an outage) but say so in the reason.
    return { ok: false, error: `siteverify unreachable: ${e?.message ?? 'network error'}` }
  }
}

/* ── The screen ───────────────────────────────────────────────────────────── */

/**
 * Screens a public auth request. `opts.checkDisposable` enables the
 * temp-mail domain block (registration only — never for login).
 */
export async function screenBotSignals(
  req: Request,
  signals: BotSignals,
  opts: { checkDisposable?: boolean } = {}
): Promise<ScreenResult> {
  const ua = req.headers.get('user-agent')

  // 1 · Turnstile — the strongest signal when configured.
  if (turnstileConfigured()) {
    if (!signals.turnstileToken) {
      return {
        ok: false,
        status: 403,
        message: 'Bot check failed — please complete the verification challenge.',
        reason: 'turnstile: missing token',
      }
    }
    const t = await verifyTurnstile(signals.turnstileToken, signals.ip)
    if (!t.ok) {
      return {
        ok: false,
        status: 403,
        message: 'Bot check failed — please retry the verification challenge.',
        reason: `turnstile: ${t.error}`,
      }
    }
  }

  // 2 · User-Agent screen.
  if (!ua || ua.trim().length < 10 || BOT_UA_RE.test(ua)) {
    return {
      ok: false,
      status: 403,
      message: 'Automated requests are not allowed here.',
      reason: `user-agent: ${ua ? 'bot signature' : 'missing'}`,
    }
  }

  // 3 · Honeypot — the field humans never see.
  if (signals.honeypot && signals.honeypot.trim().length > 0) {
    return {
      ok: false,
      status: 403,
      message: 'Automated requests are not allowed here.',
      reason: 'honeypot filled',
    }
  }

  // 4 · Timing — real people need at least a second to hit submit.
  if (typeof signals.elapsedMs === 'number' && signals.elapsedMs >= 0 && signals.elapsedMs < 1000) {
    return {
      ok: false,
      status: 403,
      message: 'That was too fast — please try again.',
      reason: `submitted in ${signals.elapsedMs}ms`,
    }
  }

  // 5 · Disposable email domains (registration only).
  if (opts.checkDisposable && signals.email) {
    const domain = signals.email.split('@')[1]?.toLowerCase().trim()
    if (domain && DISPOSABLE_DOMAINS.has(domain)) {
      return {
        ok: false,
        status: 400,
        message: 'Disposable email addresses are not accepted. Please use a real inbox.',
        reason: `disposable domain: ${domain}`,
      }
    }
  }

  return { ok: true }
}
