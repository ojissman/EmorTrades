import Link from 'next/link'
import { SITE } from '@/lib/seo'

/**
 * PUBLIC SITE CHROME (SEO-UPGRADE · PHASE 3E/4) — server-rendered header +
 * footer shared by every public marketing page under the (public) route
 * group. Zero client JavaScript: real <a> links (crawlable), semantic
 * <nav>/<footer>, brand-consistent with the landing's dark navy + emerald
 * design language. The authenticated app at `/` keeps its own SPA chrome —
 * public pages never link into private views beyond sign-in/register hashes.
 */

const NAV = [
  { href: '/features', label: 'Features' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/blog', label: 'Blog' },
  { href: '/faq', label: 'FAQ' },
  { href: '/about', label: 'About' },
]

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="EmorTrades — home">
      <img
        src="/logo.png"
        alt="EmorTrades — Trading Journal logo"
        width={compact ? 32 : 40}
        height={compact ? 32 : 40}
        className={compact ? 'h-8 w-8' : 'h-10 w-10'}
      />
      <span className="inline-flex flex-col leading-none">
        <span className="text-lg font-bold tracking-tight text-slate-50">EmorTrades</span>
        <span className="text-[9px] font-semibold uppercase tracking-[0.24em] text-emerald-400/90">
          Trading Journal
        </span>
      </span>
    </Link>
  )
}

export function PublicHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-800/60 bg-[#070b14]/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Brand compact />
        <nav aria-label="Public site" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-medium text-slate-400 transition-colors hover:bg-white/5 hover:text-slate-100"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/#/login"
            className="inline-flex min-h-[44px] items-center rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/#/register"
            className="inline-flex min-h-[44px] items-center rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(16,185,129,0.6)] transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
          >
            Get started
          </Link>
        </div>
      </div>
      {/* Mobile nav — horizontal scroll row under the bar */}
      <nav aria-label="Public site (mobile)" className="flex gap-1 overflow-x-auto border-t border-slate-800/40 px-4 py-1.5 md:hidden">
        {NAV.map((n) => (
          <Link
            key={n.href}
            href={n.href}
            className="inline-flex min-h-[44px] items-center whitespace-nowrap rounded-lg px-3 text-[0.8125rem] font-medium text-slate-400 transition-colors hover:text-slate-100"
          >
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  )
}

export function PublicFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="mt-auto border-t border-slate-800/60 bg-[#080e1a]">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Brand />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              The professional trading journal with an AI desk — built for disciplined traders who
              want their edge on the record.
            </p>
          </div>

          <nav aria-label="Product">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Product</h2>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><Link href="/features" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Features</Link></li>
              <li><Link href="/pricing" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Pricing</Link></li>
              <li><Link href="/blog" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Blog</Link></li>
              <li><Link href="/#/register" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Create account</Link></li>
            </ul>
          </nav>

          <nav aria-label="Company">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Company</h2>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><Link href="/about" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">About</Link></li>
              <li><Link href="/contact" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Contact</Link></li>
              <li><Link href="/faq" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">FAQ</Link></li>
            </ul>
          </nav>

          <nav aria-label="Legal">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">Legal</h2>
            <ul className="mt-4 space-y-1 text-sm text-slate-500">
              <li><Link href="/privacy" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Privacy Policy</Link></li>
              <li><Link href="/terms" className="inline-flex min-h-[44px] items-center transition-colors hover:text-emerald-400">Terms of Service</Link></li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-800/60 pt-6 sm:flex-row">
          <p className="text-xs text-slate-600">© {year} {SITE.name} · Institute of Trading. All rights reserved.</p>
          <p className="text-xs text-slate-600">Built for disciplined traders.</p>
        </div>
      </div>
    </footer>
  )
}

/** Shared page hero for content pages (one h1 per page). */
export function PageHero({
  eyebrow,
  title,
  lead,
}: {
  eyebrow: string
  title: string
  lead: string
}) {
  return (
    <div className="relative overflow-hidden border-b border-slate-800/60 bg-gradient-to-b from-[#0b1220] to-[#070b14]">
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        aria-hidden
        style={{
          backgroundImage:
            'linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)',
          backgroundSize: '38px 38px',
        }}
      />
      <div className="pointer-events-none absolute left-1/2 top-0 h-56 w-[520px] -translate-x-1/2 rounded-full bg-emerald-500/10 blur-[90px]" aria-hidden />
      <div className="relative mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <p className="text-[0.8125rem] font-semibold uppercase tracking-[0.2em] text-emerald-400">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-slate-50 sm:text-4xl">{title}</h1>
        <p className="mx-auto mt-4 max-w-2xl text-base leading-relaxed text-slate-400">{lead}</p>
      </div>
    </div>
  )
}

/** Breadcrumb nav (visible + BreadcrumbList schema is added per-page). */
export function Breadcrumbs({ items }: { items: { name: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mx-auto max-w-3xl px-4 pt-6 sm:px-6">
      <ol className="flex flex-wrap items-center gap-1.5 text-[0.8125rem] text-slate-500">
        {items.map((it, i) => (
          <li key={it.name} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden className="text-slate-700">/</span>}
            {it.href ? (
              <Link href={it.href} className="transition-colors hover:text-emerald-400">
                {it.name}
              </Link>
            ) : (
              <span aria-current="page" className="text-slate-300">
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
