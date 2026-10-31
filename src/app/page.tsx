import { cookies } from 'next/headers'
import { AuthGate } from '@/components/auth/auth-gate'
import { FAQS } from '@/config/landing-faqs'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/server/auth'
import { faqJsonLd, organizationJsonLd, softwareAppJsonLd, webSiteJsonLd } from '@/lib/seo'

export const dynamic = 'force-dynamic'

/**
 * `/` — the single public + app surface.
 * · Signed out → marketing landing. SEO-UPGRADE: the session cookie is read
 *   SERVER-SIDE (HMAC verify) and passed as an SSR hint, so crawlers and
 *   first-time visitors receive the fully-rendered landing HTML — not a
 *   JS-only splash. Private data NEVER renders here either way: the signed-in
 *   app hydrates and loads everything through authenticated JSON APIs.
 * · Signed in → the private SPA app (classic splash, unchanged behavior).
 *
 * Structured data: Organization, WebSite, SoftwareApplication (honest: web
 * app, free beta offer) and FAQPage (the exact questions/answers rendered in
 * the landing's visible FAQ section — schema mirrors visible content per
 * Google's guidelines).
 */
export default async function Home() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  const initial = verifySessionToken(token) ? 'app' : 'public'

  const jsonLd = [
    organizationJsonLd(),
    webSiteJsonLd(),
    softwareAppJsonLd(),
    faqJsonLd(FAQS),
  ]
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <AuthGate initial={initial} />
    </>
  )
}
