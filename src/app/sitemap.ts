import type { MetadataRoute } from 'next'
import { db } from '@/lib/db'
import { SITE, STATIC_PAGES } from '@/lib/seo'

export const dynamic = 'force-dynamic'

/**
 * GET /sitemap.xml (SEO-UPGRADE) — every static public page plus every
 * PUBLISHED blog post. Drafts and noindex posts are excluded. URLs always
 * use the production origin (PUBLIC_ORIGIN) regardless of which environment
 * renders the file, so preview deployments never split canonical equity.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const statics: MetadataRoute.Sitemap = STATIC_PAGES.map((p) => ({
    url: `${SITE.url}${p.path === '/' ? '' : p.path}`,
    lastModified: new Date(),
    changeFrequency: p.changefreq,
    priority: p.priority,
  }))

  let posts: MetadataRoute.Sitemap = []
  try {
    const rows = await db.blogPost.findMany({
      where: { status: 'PUBLISHED', noindex: false, publishedAt: { not: null } },
      select: { slug: true, updatedAt: true },
    })
    posts = rows.map((r) => ({
      url: `${SITE.url}/blog/${r.slug}`,
      lastModified: r.updatedAt,
      changeFrequency: 'monthly',
      priority: 0.7,
    }))
  } catch {
    // DB unavailable → still serve the static pages
  }

  return [...statics, ...posts]
}
