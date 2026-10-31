import { db } from '@/lib/db'

/**
 * ============================================================================
 * SEO FOUNDATION (SEO-UPGRADE) — single source of truth for site identity,
 * static public pages, and per-page metadata overrides.
 * ============================================================================
 * · SITE — name, origin (PUBLIC_ORIGIN: canonical/sitemap URLs ALWAYS point
 *   at production, even when rendered in the dev preview), descriptions.
 * · STATIC_PAGES — registry of every public marketing page, shared by the
 *   sitemap, the admin SEO panel, and each page's generateMetadata.
 * · Overrides — admins can retune title/description per page at runtime
 *   (SystemSetting `seo.pages`, JSON: { [path]: { title?, description? } });
 *   60-second in-process cache, safe defaults when the DB has nothing.
 * · JSON-LD builders — Organization, WebSite, SoftwareApplication, FAQPage,
 *   Article, BreadcrumbList. Only real, verifiable properties.
 */

export const SITE = {
  name: 'EmorTrades',
  tagline: 'Trading Journal',
  url: (process.env.PUBLIC_ORIGIN ?? 'https://emortrade.space-z.ai').replace(/\/+$/, ''),
  description:
    'A professional-grade trading journal with deep analytics, AI insights, multi-account management, risk tools, and comprehensive performance reporting.',
  ogImage: '/og-image.png',
  supportEmail: 'emorjefefx@gmail.com',
  twitter: undefined as string | undefined, // set when the brand account exists
} as const

export interface StaticPageDef {
  path: string
  name: string
  title: string
  description: string
  priority: number
  changefreq: 'daily' | 'weekly' | 'monthly' | 'yearly'
}

/** Every public, indexable page (home included). Order = footer order. */
export const STATIC_PAGES: StaticPageDef[] = [
  {
    path: '/',
    name: 'Home',
    title: 'EmorTrades — Trading Journal & Analytics Platform',
    description:
      'Journal every trade, understand every decision. Professional trading journal with deep analytics, AI insights, risk tools and performance reporting. Free while in beta.',
    priority: 1.0,
    changefreq: 'weekly',
  },
  {
    path: '/features',
    name: 'Features',
    title: 'Features — EmorTrades Trading Journal',
    description:
      'Trade tracking, executions, multi-leg options, advanced analytics, equity curve, R-multiples, psychology tracking, AI reviews and more — explore everything EmorTrades offers.',
    priority: 0.9,
    changefreq: 'weekly',
  },
  {
    path: '/pricing',
    name: 'Pricing',
    title: 'Pricing — EmorTrades',
    description:
      'EmorTrades is free while in beta: every feature, unlimited trades, no card required. See what is included and what comes next.',
    priority: 0.8,
    changefreq: 'monthly',
  },
  {
    path: '/blog',
    name: 'Blog',
    title: 'Trading Journal Blog — EmorTrades',
    description:
      'Practical guides on trading journals, risk management, trading psychology and performance analytics for serious traders.',
    priority: 0.8,
    changefreq: 'weekly',
  },
  {
    path: '/about',
    name: 'About',
    title: 'About EmorTrades',
    description:
      'Why EmorTrades exists: a trading journal built for deliberate practice — accurate data, honest analytics, and tools that make review sessions count.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/faq',
    name: 'FAQ',
    title: 'Frequently Asked Questions — EmorTrades',
    description:
      'Answers about the trading journal: data ownership, import formats, AI features, pricing, security and privacy.',
    priority: 0.6,
    changefreq: 'monthly',
  },
  {
    path: '/contact',
    name: 'Contact',
    title: 'Contact — EmorTrades',
    description: 'Questions, feedback or partnership inquiries — reach the EmorTrades team.',
    priority: 0.5,
    changefreq: 'yearly',
  },
  {
    path: '/privacy',
    name: 'Privacy Policy',
    title: 'Privacy Policy — EmorTrades',
    description: 'What data EmorTrades stores, how it is protected, and the choices you control.',
    priority: 0.3,
    changefreq: 'yearly',
  },
  {
    path: '/terms',
    name: 'Terms of Service',
    title: 'Terms of Service — EmorTrades',
    description: 'The terms that govern use of the EmorTrades trading journal platform.',
    priority: 0.3,
    changefreq: 'yearly',
  },
]

/* ── Runtime per-page overrides (Admin ▸ SEO & Content) ──────────────────── */

const FLAG_SEO_PAGES = 'seo.pages'
let metaCache: { at: number; value: Record<string, { title?: string; description?: string }> } | null = null
const META_TTL_MS = 60_000

export interface PageMeta {
  title: string
  description: string
  overridden: boolean
}

/** Title/description for a static page: DB override if present, else default. */
export async function staticPageMeta(path: string): Promise<PageMeta> {
  const def = STATIC_PAGES.find((p) => p.path === path)
  if (!def) return { title: SITE.name, description: SITE.description, overridden: false }

  let overrides: Record<string, { title?: string; description?: string }> = {}
  try {
    if (!metaCache || Date.now() - metaCache.at > META_TTL_MS) {
      const row = await db.systemSetting.findUnique({ where: { key: FLAG_SEO_PAGES } })
      overrides = row?.value ? (JSON.parse(row.value) as typeof overrides) : {}
      metaCache = { at: Date.now(), value: overrides }
    } else {
      overrides = metaCache.value
    }
  } catch {
    overrides = {} // DB hiccup → defaults are always safe
  }
  const o = overrides[path] ?? {}
  return {
    title: (o.title && o.title.trim()) || def.title,
    description: (o.description && o.description.trim()) || def.description,
    overridden: Boolean((o.title && o.title.trim()) || (o.description && o.description.trim())),
  }
}

/** Invalidate the override cache (called after admin saves). */
export function invalidateSeoMetaCache(): void {
  metaCache = null
}

export async function saveSeoPageOverrides(
  overrides: Record<string, { title?: string; description?: string }>,
): Promise<void> {
  await db.systemSetting.upsert({
    where: { key: FLAG_SEO_PAGES },
    update: { value: JSON.stringify(overrides) },
    create: { key: FLAG_SEO_PAGES, value: JSON.stringify(overrides) },
  })
  invalidateSeoMetaCache()
}

/* ── JSON-LD builders (schema.org, honest properties only) ──────────────── */

export function organizationJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE.name,
    url: SITE.url,
    logo: `${SITE.url}/logo.png`,
    description: SITE.description,
    email: SITE.supportEmail,
  }
}

export function webSiteJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    url: SITE.url,
  }
}

export function softwareAppJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    name: SITE.name,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Web',
    url: SITE.url,
    description: SITE.description,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  }
}

export function faqJsonLd(faqs: { q: string; a: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: faqs.map((f) => ({
      '@type': 'Question',
      name: f.q,
      acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
  }
}

export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: it.url,
    })),
  }
}

export function articleJsonLd(post: {
  title: string
  description: string
  slug: string
  publishedAt: Date | null
  updatedAt: Date
  authorName: string
  featuredImage: string | null
}) {
  const url = `${SITE.url}/blog/${post.slug}`
  return {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    ...(post.publishedAt ? { datePublished: post.publishedAt.toISOString() } : {}),
    dateModified: post.updatedAt.toISOString(),
    author: { '@type': 'Person', name: post.authorName },
    publisher: { '@type': 'Organization', name: SITE.name, logo: { '@type': 'ImageObject', url: `${SITE.url}/logo.png` } },
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    ...(post.featuredImage
      ? { image: [post.featuredImage.startsWith('http') ? post.featuredImage : `${SITE.url}${post.featuredImage}`] }
      : {}),
  }
}
