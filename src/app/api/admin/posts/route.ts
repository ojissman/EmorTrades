import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/posts (SEO-UPGRADE · PHASE 5/6) — the blog/CMS collection.
 * GET  — list posts (all statuses) + categories. content.manage required.
 * POST — create a post (DRAFT by default). Every mutation audited.
 */

/** URL-safe slug from a title (lowercase, hyphens, ascii). */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function GET() {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  const [posts, categories] = await Promise.all([
    db.blogPost.findMany({
      orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true, slug: true, title: true, excerpt: true, content: true, status: true, tags: true,
        authorName: true, authorTitle: true, featuredImage: true, seoTitle: true, seoDescription: true,
        canonicalUrl: true, ogImage: true, noindex: true,
        publishedAt: true, createdAt: true, updatedAt: true,
        categoryId: true, category: { select: { name: true, slug: true } },
      },
    }),
    db.blogCategory.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true, slug: true } }),
  ])
  return NextResponse.json({ posts, categories })
}

interface PostInput {
  title?: string
  slug?: string
  excerpt?: string | null
  content?: string
  status?: string
  categoryId?: string | null
  tags?: string | null
  authorName?: string
  authorTitle?: string | null
  featuredImage?: string | null
  seoTitle?: string | null
  seoDescription?: string | null
  canonicalUrl?: string | null
  ogImage?: string | null
  noindex?: boolean
}

const TEXT = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t === '' ? null : t.slice(0, max)
}

export async function POST(req: NextRequest) {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  let body: PostInput
  try {
    body = (await req.json()) as PostInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const title = body.title?.trim() ?? ''
  const content = body.content ?? ''
  if (title.length < 3) return NextResponse.json({ error: 'Title must be at least 3 characters.' }, { status: 400 })
  if (!content.trim()) return NextResponse.json({ error: 'Content is required.' }, { status: 400 })

  let slug = slugify(body.slug?.trim() || title)
  if (!slug) return NextResponse.json({ error: 'Could not derive a URL slug — set one manually.' }, { status: 400 })
  const clash = await db.blogPost.findUnique({ where: { slug }, select: { id: true } })
  if (clash) slug = `${slug}-${Date.now().toString(36)}`

  const status = body.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT'
  const categoryId = typeof body.categoryId === 'string' && body.categoryId ? body.categoryId : null

  const post = await db.blogPost.create({
    data: {
      slug,
      title: title.slice(0, 160),
      excerpt: TEXT(body.excerpt, 400),
      content,
      status,
      categoryId,
      tags: TEXT(body.tags, 200),
      authorId: auth.user.id,
      authorName: (body.authorName?.trim() || auth.user.name?.trim() || auth.user.email).slice(0, 80),
      authorTitle: TEXT(body.authorTitle, 80),
      featuredImage: TEXT(body.featuredImage, 500),
      seoTitle: TEXT(body.seoTitle, 70),
      seoDescription: TEXT(body.seoDescription, 200),
      canonicalUrl: TEXT(body.canonicalUrl, 500),
      ogImage: TEXT(body.ogImage, 500),
      noindex: Boolean(body.noindex),
      publishedAt: status === 'PUBLISHED' ? new Date() : null,
    },
    select: { id: true, slug: true, title: true, status: true },
  })

  await logAdminAction(auth.user, {
    action: 'content.post.create',
    targetType: 'BlogPost',
    targetId: post.id,
    targetLabel: post.title,
    details: { slug: post.slug, status },
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ post }, { status: 201 })
}
