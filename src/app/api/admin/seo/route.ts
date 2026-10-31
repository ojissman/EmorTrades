import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { clientIp } from '@/lib/server/rate-limit'
import { SITE, STATIC_PAGES, invalidateSeoMetaCache, saveSeoPageOverrides, staticPageMeta } from '@/lib/seo'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/seo (SEO-UPGRADE · PHASE 5) — the SEO management surface.
 * GET  — every static page with its effective title/description + override
 *        flags, sitemap/robots status, and analytics configuration state.
 * PATCH — save per-page title/description overrides ({ pages: { path: {…} } }).
 *        Empty strings clear overrides. content.manage required; audited.
 */

export async function GET() {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  const pages = await Promise.all(
    STATIC_PAGES.map(async (p) => {
      const meta = await staticPageMeta(p.path)
      return {
        path: p.path,
        name: p.name,
        defaultTitle: p.title,
        defaultDescription: p.description,
        title: meta.title,
        description: meta.description,
        overridden: meta.overridden,
        inSitemap: !['/privacy', '/terms'].includes(p.path) || true,
      }
    }),
  )

  const [published, drafted] = await Promise.all([
    db.blogPost.count({ where: { status: 'PUBLISHED' } }),
    db.blogPost.count({ where: { status: 'DRAFT' } }),
  ])

  return NextResponse.json({
    site: {
      name: SITE.name,
      origin: SITE.url,
      ogImage: SITE.ogImage,
      sitemapUrl: `${SITE.url}/sitemap.xml`,
      robotsUrl: `${SITE.url}/robots.txt`,
    },
    pages,
    content: { published, drafted },
    analytics: {
      gaConfigured: Boolean(process.env.GA_MEASUREMENT_ID),
      gscConfigured: Boolean(process.env.GOOGLE_SITE_VERIFICATION),
    },
  })
}

interface PatchBody {
  pages?: Record<string, { title?: string; description?: string }>
}

export async function PATCH(req: NextRequest) {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  let body: PatchBody
  try {
    body = (await req.json()) as PatchBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (!body.pages || typeof body.pages !== 'object') {
    return NextResponse.json({ error: 'pages{} required.' }, { status: 400 })
  }

  // Validate: only known static pages, string values with sane caps.
  const known = new Set(STATIC_PAGES.map((p) => p.path))
  const overrides: Record<string, { title?: string; description?: string }> = {}
  for (const [path, val] of Object.entries(body.pages)) {
    if (!known.has(path)) return NextResponse.json({ error: `Unknown page: ${path}` }, { status: 400 })
    const title = typeof val?.title === 'string' ? val.title.trim().slice(0, 70) : undefined
    const description = typeof val?.description === 'string' ? val.description.trim().slice(0, 200) : undefined
    overrides[path] = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
    }
  }

  await saveSeoPageOverrides(overrides)
  invalidateSeoMetaCache()

  await logAdminAction(auth.user, {
    action: 'content.seo.pages.update',
    targetType: 'Setting',
    targetId: 'seo.pages',
    details: { pages: Object.keys(overrides) },
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ ok: true })
}
