import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requirePermission } from '@/lib/server/admin-rbac'
import { logAdminAction, userAgentOf } from '@/lib/server/admin-audit'
import { clientIp } from '@/lib/server/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * /api/admin/posts/[id] (SEO-UPGRADE · PHASE 5/6) — update or delete a post.
 * PATCH accepts partial field updates; publishing sets publishedAt once;
 * unpublishing clears it. Slug changes keep uniqueness (suffix on clash).
 * DELETE removes the post permanently (audited). content.manage required.
 */

interface PatchInput {
  title?: string
  slug?: string
  excerpt?: string | null
  content?: string
  status?: 'DRAFT' | 'PUBLISHED'
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

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await db.blogPost.findUnique({ where: { id }, select: { id: true, slug: true, status: true, publishedAt: true } })
  if (!existing) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  let body: PatchInput
  try {
    body = (await req.json()) as PatchInput
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const data: Record<string, unknown> = {}
  if (typeof body.title === 'string' && body.title.trim().length >= 3) data.title = body.title.trim().slice(0, 160)
  if (body.content !== undefined && typeof body.content === 'string' && body.content.trim()) data.content = body.content
  if (body.excerpt !== undefined) data.excerpt = TEXT(body.excerpt, 400)
  if (body.tags !== undefined) data.tags = TEXT(body.tags, 200)
  if (body.categoryId !== undefined) data.categoryId = typeof body.categoryId === 'string' && body.categoryId ? body.categoryId : null
  if (body.authorName !== undefined && typeof body.authorName === 'string' && body.authorName.trim()) data.authorName = body.authorName.trim().slice(0, 80)
  if (body.authorTitle !== undefined) data.authorTitle = TEXT(body.authorTitle, 80)
  if (body.featuredImage !== undefined) data.featuredImage = TEXT(body.featuredImage, 500)
  if (body.seoTitle !== undefined) data.seoTitle = TEXT(body.seoTitle, 70)
  if (body.seoDescription !== undefined) data.seoDescription = TEXT(body.seoDescription, 200)
  if (body.canonicalUrl !== undefined) data.canonicalUrl = TEXT(body.canonicalUrl, 500)
  if (body.ogImage !== undefined) data.ogImage = TEXT(body.ogImage, 500)
  if (body.noindex !== undefined) data.noindex = Boolean(body.noindex)

  // Slug: explicit or from title; keep unique against OTHER posts.
  const wantedSlug = body.slug !== undefined ? slugify(body.slug) : undefined
  if (wantedSlug) {
    if (wantedSlug !== existing.slug) {
      const clash = await db.blogPost.findFirst({ where: { slug: wantedSlug, id: { not: id } }, select: { id: true } })
      data.slug = clash ? `${wantedSlug}-${Date.now().toString(36)}` : wantedSlug
    }
  } else if (body.slug === '' && data.title) {
    const fromTitle = slugify(data.title as string)
    if (fromTitle && fromTitle !== existing.slug) {
      const clash = await db.blogPost.findFirst({ where: { slug: fromTitle, id: { not: id } }, select: { id: true } })
      data.slug = clash ? `${fromTitle}-${Date.now().toString(36)}` : fromTitle
    }
  }

  // Publish/unpublish lifecycle — publishedAt set once, cleared on unpublish.
  if (body.status === 'PUBLISHED') {
    data.status = 'PUBLISHED'
    if (!existing.publishedAt) data.publishedAt = new Date()
  } else if (body.status === 'DRAFT') {
    data.status = 'DRAFT'
  }

  const post = await db.blogPost.update({
    where: { id },
    data,
    select: { id: true, slug: true, title: true, status: true, publishedAt: true },
  })

  await logAdminAction(auth.user, {
    action: body.status ? `content.post.${body.status === 'PUBLISHED' ? 'publish' : 'unpublish'}` : 'content.post.update',
    targetType: 'BlogPost',
    targetId: post.id,
    targetLabel: post.title,
    details: { slug: post.slug, status: post.status },
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ post })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requirePermission('content.manage')
  if (!auth.ok) return auth.response

  const { id } = await params
  const existing = await db.blogPost.findUnique({ where: { id }, select: { id: true, title: true, slug: true } })
  if (!existing) return NextResponse.json({ error: 'Post not found.' }, { status: 404 })

  await db.blogPost.delete({ where: { id } })
  await logAdminAction(auth.user, {
    action: 'content.post.delete',
    targetType: 'BlogPost',
    targetId: existing.id,
    targetLabel: existing.title,
    details: { slug: existing.slug },
    ip: clientIp(req),
    userAgent: userAgentOf(req),
  })
  return NextResponse.json({ ok: true })
}
