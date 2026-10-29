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
