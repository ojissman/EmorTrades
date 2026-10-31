import type { MetadataRoute } from 'next'
import { SITE } from '@/lib/seo'

/**
 * GET /robots.txt (SEO-UPGRADE) — dynamic. Public marketing pages are
 * crawlable; the authenticated app surface (/, which SSRs no private data
 * but is app chrome), API endpoints, and OAuth callbacks are excluded.
 * The sitemap is referenced for discovery.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/auth/'],
      },
    ],
    sitemap: `${SITE.url}/sitemap.xml`,
  }
}
