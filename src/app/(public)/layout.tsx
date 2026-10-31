import Script from 'next/script'
import { PublicFooter, PublicHeader } from '@/components/public/chrome'

/**
 * (public) route-group layout (SEO-UPGRADE) — wraps every public marketing
 * page (features, pricing, blog, about, faq, contact, privacy, terms) in the
 * shared server-rendered chrome. The root layout still provides html/body,
 * fonts and the theme bootstrap; the authenticated SPA at `/` is NOT inside
 * this group and keeps its own app chrome.
 *
 * PHASE 9 — analytics: GA4 loads HERE ONLY (public marketing pages), gated
 * on GA_MEASUREMENT_ID. The private journal app never loads analytics —
 * trade data, notes and every authenticated surface stay unmeasured by
 * design. No PII is sent; standard gtag with IP-anonymizing defaults.
 */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  const gaId = process.env.GA_MEASUREMENT_ID
  return (
    <div className="flex min-h-screen flex-col bg-[#070b14] text-slate-100">
      {gaId && (
        <>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${gaId}`}
            strategy="afterInteractive"
          />
          <Script id="ga4-init" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}',{anonymize_ip:true});`}
          </Script>
        </>
      )}
      <PublicHeader />
      <main className="flex-1">{children}</main>
      <PublicFooter />
    </div>
  )
}
