/**
 * ============================================================================
 * EMAIL DELIVERY — pluggable, honest about what is configured
 * ============================================================================
 * · RESEND_API_KEY set  → real delivery through the Resend REST API.
 · not set (dev/sandbox) → DEV DELIVERY: the link is returned to the caller
 *   and logged to the server console, so the whole verification flow is
 *   fully usable without an email provider. The register/pending screens
 *   surface the link with a clear "dev delivery" note.
 *
 * Swapping providers later = one function; nothing else changes.
 */

export interface DeliveryResult {
  delivered: boolean
  /** Present only in dev delivery mode — the raw link, for the UI to show. */
  devLink?: string
  error?: string
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY)
}

/**
 * May an API route surface a dev-delivery link in its HTTP response?
 *
 * Rule: NEVER in production. Production (emortrade, NODE_ENV=production) is
 * public — an on-screen reset link for an existing account would be an
 * account-takeover vector for anyone who knows the address (SEC-1: this was
 * briefly live; fixed before republish). Every non-production runtime
 * (development preview, test) MAY surface the labeled link — without a
 * provider it is the only way the flow stays usable in those controlled
 * environments.
 *
 * The register/resend-verification paths keep their labeled dev link under
 * this same rule: those links only ever activate an account whose password
 * the requester themselves chose, and hiding them in production would brick
 * sign-up / pending users until an email provider is configured. The
 * forgot-password route applies this check because its links grant control
 * of EXISTING accounts.
 */
export function devLinkAllowed(): boolean {
  return process.env.NODE_ENV !== 'production'
}

function verificationHtml(link: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;color:#e2e8f0;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;
                  background:#065f46;color:#34d399;font-weight:bold;font-size:20px;margin-bottom:14px;">ET</div>
      <h1 style="margin:0;font-size:22px;color:#f8fafc;">Verify your email</h1>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#94a3b8;">
      Welcome to <strong style="color:#34d399;">EmorTrades</strong>. Click the button below to
      activate your account and start journaling your edge. This link expires in 24 hours.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}"
         style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;
                font-weight:bold;font-size:15px;padding:14px 36px;border-radius:10px;">
        Verify my email
      </a>
    </div>
    <p style="font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
      If the button doesn't work, paste this link into your browser:<br>${link}
    </p>
    <p style="font-size:12px;color:#64748b;">
      You received this because someone registered an EmorTrades account with this address.
      If that wasn't you, ignore this email.
    </p>
  </div>
</body></html>`
}

export async function sendVerificationEmail(toEmail: string, link: string): Promise<DeliveryResult> {
  if (!emailDeliveryConfigured()) {
    // DEV DELIVERY — no provider configured: log it and hand the link back so
    // the UI can surface it. Add RESEND_API_KEY to .env to go live.
    console.log(`[email:dev-delivery] verification link for ${toEmail} → ${link}`)
    return { delivered: false, devLink: link }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'EmorTrades <onboarding@resend.dev>',
        to: [toEmail],
        subject: 'Verify your email — EmorTrades',
        html: verificationHtml(link),
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      console.error(`[email] Resend error ${res.status}:`, errText)
      return { delivered: false, error: `Email provider rejected the send (${res.status}).` }
    }
    return { delivered: true }
  } catch (e: any) {
    console.error('[email] send failed:', e?.message)
    return { delivered: false, error: 'Could not reach the email provider.' }
  }
}

/* ── Password reset (LAND-1) — single-use, 60-minute links ──────────────── */

function passwordResetHtml(link: string): string {
  return `<!doctype html>
<html><body style="margin:0;background:#0b1220;font-family:Arial,Helvetica,sans-serif;">
  <div style="max-width:520px;margin:0 auto;padding:40px 24px;color:#e2e8f0;">
    <div style="text-align:center;margin-bottom:28px;">
      <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;
                  background:#065f46;color:#34d399;font-weight:bold;font-size:20px;margin-bottom:14px;">ET</div>
      <h1 style="margin:0;font-size:22px;color:#f8fafc;">Reset your password</h1>
    </div>
    <p style="font-size:15px;line-height:1.6;color:#94a3b8;">
      Someone asked to reset the password for this <strong style="color:#34d399;">EmorTrades</strong>
      account. Click the button below to choose a new one. This link expires in 60 minutes
      and can be used only once.
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${link}"
         style="display:inline-block;background:#059669;color:#ffffff;text-decoration:none;
                font-weight:bold;font-size:15px;padding:14px 36px;border-radius:10px;">
        Choose a new password
      </a>
    </div>
    <p style="font-size:12px;line-height:1.6;color:#64748b;word-break:break-all;">
      If the button doesn't work, paste this link into your browser:<br>${link}
    </p>
    <p style="font-size:12px;color:#64748b;">
      Setting a new password signs out every active session on your account.
      If you didn't request this, ignore this email — your password stays unchanged.
    </p>
  </div>
</body></html>`
}

export async function sendPasswordResetEmail(toEmail: string, link: string): Promise<DeliveryResult> {
  if (!emailDeliveryConfigured()) {
    console.log(`[email:dev-delivery] password-reset link for ${toEmail} → ${link}`)
    return { delivered: false, devLink: link }
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM || 'EmorTrades <onboarding@resend.dev>',
        to: [toEmail],
        subject: 'Reset your password — EmorTrades',
        html: passwordResetHtml(link),
      }),
    })
    if (!res.ok) {
      const errText = await res.text().catch(() => res.statusText)
      console.error(`[email] Resend error ${res.status}:`, errText)
      return { delivered: false, error: `Email provider rejected the send (${res.status}).` }
    }
    return { delivered: true }
  } catch (e: any) {
    console.error('[email] send failed:', e?.message)
    return { delivered: false, error: 'Could not reach the email provider.' }
  }
}
