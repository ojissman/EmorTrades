'use client'

/**
 * ADMIN ▸ SEO & CONTENT (SEO-UPGRADE · PHASE 5/6) — the content management
 * surface for the PUBLIC site:
 *
 * · Posts tab — blog CRUD with a full SEO panel per post (title/description
 *   with live character counters, Google-style SERP preview, canonical,
 *   OG image, noindex), publish/unpublish lifecycle, live-link out, and
 *   SEO warnings (missing/too-long/duplicate titles & descriptions).
 * · Pages tab — runtime title/description overrides for every static public
 *   page (stored in SystemSetting `seo.pages`), plus site-wide status:
 *   sitemap/robots URLs, OG image, GA4/Search Console configuration state.
 *
 * Enforcement is server-side (/api/admin/posts, /api/admin/seo —
 * content.manage); this page is the UI only.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  ExternalLink,
  Eye,
  FileText,
  Globe,
  Pencil,
  Plus,
  Rocket,
  Save,
  Search,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { AdminPageHeader, StatusBadge, formatAdminDate } from '../ui/primitives'
import { ConfirmDialog, FormModal } from '../ui/dialogs'

/* ── Types ───────────────────────────────────────────────────────────────── */

interface PostRow {
  id: string
  slug: string
  title: string
  excerpt: string | null
  content: string
  status: string
  tags: string | null
  authorName: string
  authorTitle?: string | null
  featuredImage: string | null
  seoTitle: string | null
  seoDescription: string | null
  canonicalUrl: string | null
  ogImage: string | null
  noindex: boolean
  publishedAt: string | null
  updatedAt: string
  categoryId: string | null
  category: { name: string; slug: string } | null
}

interface PostsResponse {
  posts: PostRow[]
  categories: { id: string; name: string; slug: string }[]
}

interface SeoPageRow {
  path: string
  name: string
  defaultTitle: string
  defaultDescription: string
  title: string
  description: string
  overridden: boolean
}

interface SeoResponse {
  site: { name: string; origin: string; ogImage: string; sitemapUrl: string; robotsUrl: string }
  pages: SeoPageRow[]
  content: { published: number; drafted: number }
  analytics: { gaConfigured: boolean; gscConfigured: boolean }
}

interface PostForm {
  title: string
  slug: string
  excerpt: string
  content: string
  status: 'DRAFT' | 'PUBLISHED'
  categoryId: string
  tags: string
  authorName: string
  authorTitle: string
  featuredImage: string
  seoTitle: string
  seoDescription: string
  canonicalUrl: string
  ogImage: string
  noindex: boolean
}

const EMPTY_FORM: PostForm = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  status: 'DRAFT',
  categoryId: '',
  tags: '',
  authorName: '',
  authorTitle: '',
  featuredImage: '',
  seoTitle: '',
  seoDescription: '',
  canonicalUrl: '',
  ogImage: '',
  noindex: false,
}

/* ── SEO helpers ─────────────────────────────────────────────────────────── */

function seoTitleOf(p: { title: string; seoTitle: string | null }): string {
  return p.seoTitle?.trim() || p.title
}
function seoDescOf(p: { excerpt: string | null; seoDescription: string | null }): string {
  return p.seoDescription?.trim() || p.excerpt?.trim() || ''
}

/** Warnings for one post (client-side mirror of what crawlers penalize). */
function postWarnings(p: PostRow, allTitles: Map<string, number>): string[] {
  const w: string[] = []
  const t = seoTitleOf(p)
  const d = seoDescOf(p)
  if (!t.trim()) w.push('Missing title')
  else if (t.length > 60) w.push(`Title ${t.length}/60 — too long`)
  if (!d.trim()) w.push('Missing description')
  else if (d.length > 160) w.push(`Description ${d.length}/160 — too long`)
  else if (d.length < 70) w.push(`Description ${d.length} — very short`)
  if ((allTitles.get(t.trim()) ?? 0) > 1) w.push('Duplicate title')
  if (p.status === 'PUBLISHED' && p.noindex) w.push('Published but noindex')
  return w
}

/** Character counter chip. */
function Counter({ value, max, ideal }: { value: number; max: number; ideal?: number }) {
  const over = value > max
  const near = ideal !== undefined && value > ideal && !over
  return (
    <span
      className={`a-tabular ml-auto shrink-0 text-[0.6875rem] font-medium ${
        over ? 'text-red-400' : near ? 'text-amber-400' : 'a-faint'
      }`}
    >
      {value}/{max}
    </span>
  )
}

/** Google-style SERP preview. */
function SerpPreview({ title, description, url }: { title: string; description: string; url: string }) {
  return (
    <div className="rounded-xl border border-slate-700/60 bg-white p-4">
      <p className="truncate text-xs text-[#4d5156]">{url}</p>
      <p className="mt-0.5 truncate text-[1.0625rem] leading-snug text-[#1a0dab]">{title || 'Untitled page'}</p>
      <p className="mt-1 line-clamp-2 text-[0.8125rem] leading-snug text-[#4d5156]">
        {description || 'No description set — search engines will improvise from page content.'}
      </p>
    </div>
  )
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export function SeoContentPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<'posts' | 'pages'>('posts')
  const [search, setSearch] = useState('')

  /* posts editor state */
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<PostRow | null>(null)
  const [form, setForm] = useState<PostForm>(EMPTY_FORM)
  const [deleteTarget, setDeleteTarget] = useState<PostRow | null>(null)

  /* pages overrides state (local edits keyed by path) */
  const [pageEdits, setPageEdits] = useState<Record<string, { title: string; description: string }>>({})

  const postsQ = useQuery<PostsResponse>({
    queryKey: ['admin-posts'],
    queryFn: async () => {
      const res = await fetch('/api/admin/posts')
      if (!res.ok) throw new Error('Failed to load posts.')
      return res.json()
    },
    enabled: tab === 'posts',
  })

  const seoQ = useQuery<SeoResponse>({
    queryKey: ['admin-seo'],
    queryFn: async () => {
      const res = await fetch('/api/admin/seo')
      if (!res.ok) throw new Error('Failed to load SEO status.')
      return res.json()
    },
    enabled: tab === 'pages',
  })

  const titleCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of postsQ.data?.posts ?? []) {
      const t = seoTitleOf(p).trim()
      m.set(t, (m.get(t) ?? 0) + 1)
    }
    return m
  }, [postsQ.data])

  const savePost = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        slug: form.slug,
        excerpt: form.excerpt || null,
        content: form.content,
        status: form.status,
        categoryId: form.categoryId || null,
        tags: form.tags || null,
        authorName: form.authorName || undefined,
        authorTitle: form.authorTitle || null,
        featuredImage: form.featuredImage || null,
        seoTitle: form.seoTitle || null,
        seoDescription: form.seoDescription || null,
        canonicalUrl: form.canonicalUrl || null,
        ogImage: form.ogImage || null,
        noindex: form.noindex,
      }
      const res = await fetch(editing ? `/api/admin/posts/${editing.id}` : '/api/admin/posts', {
        method: editing ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Save failed.')
      return json
    },
    onSuccess: () => {
      toast.success(editing ? 'Post updated' : 'Post created', {
        description: form.status === 'PUBLISHED' ? 'Live on the public site now.' : 'Saved as draft.',
      })
      setEditorOpen(false)
      void qc.invalidateQueries({ queryKey: ['admin-posts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const togglePublish = useMutation({
    mutationFn: async (p: PostRow) => {
      const res = await fetch(`/api/admin/posts/${p.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: p.status === 'PUBLISHED' ? 'DRAFT' : 'PUBLISHED' }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Failed.')
      return json
    },
    onSuccess: (_d, p) => {
      toast.success(p.status === 'PUBLISHED' ? 'Post unpublished' : 'Post published')
      void qc.invalidateQueries({ queryKey: ['admin-posts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deletePost = useMutation({
    mutationFn: async (p: PostRow) => {
      const res = await fetch(`/api/admin/posts/${p.id}`, { method: 'DELETE' })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Delete failed.')
      return json
    },
    onSuccess: () => {
      toast.success('Post deleted')
      setDeleteTarget(null)
      void qc.invalidateQueries({ queryKey: ['admin-posts'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const savePages = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/admin/seo', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pages: pageEdits }),
      })
      const json = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) throw new Error(json.error ?? 'Save failed.')
      return json
    },
    onSuccess: () => {
      toast.success('Page metadata saved', { description: 'Live on the public site within a minute.' })
      setPageEdits({})
      void qc.invalidateQueries({ queryKey: ['admin-seo'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const openCreate = () => {
    setEditing(null)
    setForm(EMPTY_FORM)
    setEditorOpen(true)
  }

  const openEdit = (p: PostRow) => {
    setEditing(p)
    setForm({
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt ?? '',
      content: p.content ?? '',
      status: p.status as 'DRAFT' | 'PUBLISHED',
      categoryId: p.categoryId ?? '',
      tags: p.tags ?? '',
      authorName: p.authorName,
      authorTitle: p.authorTitle ?? '',
      featuredImage: p.featuredImage ?? '',
      seoTitle: p.seoTitle ?? '',
      seoDescription: p.seoDescription ?? '',
      canonicalUrl: p.canonicalUrl ?? '',
      ogImage: p.ogImage ?? '',
      noindex: p.noindex,
    })
    setEditorOpen(true)
  }

  const filtered = (postsQ.data?.posts ?? []).filter((p) =>
    search.trim() === ''
      ? true
      : `${p.title} ${p.slug} ${p.category?.name ?? ''}`.toLowerCase().includes(search.trim().toLowerCase())
  )

  const dirtyPages = Object.keys(pageEdits).length > 0

  /* ── render ───────────────────────────────────────────────────────────── */

  return (
    <div>
      <AdminPageHeader
        title="SEO & Content"
        description="The public site's blog, pages and search metadata."
        breadcrumb={['Growth', 'SEO & Content']}
        actions={
          <>
            {tab === 'posts' && (
              <button className="a-btn a-btn-primary" onClick={openCreate}>
                <Plus className="h-4 w-4" aria-hidden /> New post
              </button>
            )}
            {tab === 'pages' && dirtyPages && (
              <button className="a-btn a-btn-primary" disabled={savePages.isPending} onClick={() => savePages.mutate()}>
                <Save className="h-4 w-4" aria-hidden /> {savePages.isPending ? 'Saving…' : 'Save changes'}
              </button>
            )}
          </>
        }
      />

      {/* Tabs */}
      <div className="a-card mb-4 flex gap-1 p-1" role="tablist" aria-label="SEO sections">
        <button
          role="tab"
          aria-selected={tab === 'posts'}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
            tab === 'posts' ? 'bg-primary text-primary-foreground' : 'a-muted hover:a-text'
          }`}
          onClick={() => setTab('posts')}
        >
          <FileText className="h-4 w-4" aria-hidden /> Blog posts
        </button>
        <button
          role="tab"
          aria-selected={tab === 'pages'}
          className={`flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[0.8125rem] font-medium transition-colors ${
            tab === 'pages' ? 'bg-primary text-primary-foreground' : 'a-muted hover:a-text'
          }`}
          onClick={() => setTab('pages')}
        >
          <Globe className="h-4 w-4" aria-hidden /> Pages & site
        </button>
      </div>

      {/* ── Posts tab ─────────────────────────────────────────────────────── */}
      {tab === 'posts' && (
        <div className="a-card p-4 sm:p-5">
          <div className="mb-4 flex items-center gap-2">
            <div className="relative flex-1 max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 a-faint" aria-hidden />
              <input
                className="a-input w-full pl-9"
                placeholder="Search posts…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search posts"
              />
            </div>
            <p className="ml-auto text-xs a-faint">
              {postsQ.data?.posts.filter((p) => p.status === 'PUBLISHED').length ?? 0} published ·{' '}
              {postsQ.data?.posts.filter((p) => p.status === 'DRAFT').length ?? 0} drafts
            </p>
          </div>

          {postsQ.isLoading ? (
            <p className="py-10 text-center text-sm a-muted">Loading posts…</p>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm font-medium">No posts {search ? 'match your search' : 'yet'}</p>
              <p className="mt-1 text-xs a-muted">Create the first article — it appears on the public blog instantly when published.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {filtered.map((p) => {
                const warnings = postWarnings(p, titleCounts)
                return (
                  <li key={p.id} className="flex flex-wrap items-start gap-3 py-3.5 first:pt-0 last:pb-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge
                          status={p.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                          tone={p.status === 'PUBLISHED' ? 'a-badge-success' : 'a-badge-neutral'}
                        />
                        {p.category && <span className="a-badge a-badge-primary">{p.category.name}</span>}
                        {p.noindex && <span className="a-badge a-badge-warning">noindex</span>}
                      </div>
                      <p className="mt-1.5 truncate text-[0.9375rem] font-medium">{p.title}</p>
                      <p className="mt-0.5 text-xs a-faint">
                        /blog/{p.slug} · {p.authorName} ·{' '}
                        {p.status === 'PUBLISHED' && p.publishedAt
                          ? `published ${formatAdminDate(p.publishedAt)}`
                          : `updated ${formatAdminDate(p.updatedAt)}`}
                      </p>
                      {warnings.length > 0 && (
                        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
                          {warnings.map((w) => (
                            <li key={w} className="inline-flex items-center gap-1 text-[0.6875rem] text-amber-400">
                              <TriangleAlert className="h-3 w-3" aria-hidden /> {w}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {p.status === 'PUBLISHED' && (
                        <a
                          href={`/blog/${p.slug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="a-btn px-2.5"
                          title="View live"
                        >
                          <Eye className="h-4 w-4" aria-hidden />
                        </a>
                      )}
                      <button
                        className="a-btn px-2.5"
                        title={p.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                        disabled={togglePublish.isPending}
                        onClick={() => togglePublish.mutate(p)}
                      >
                        <Rocket className="h-4 w-4" aria-hidden />
                      </button>
                      <button className="a-btn px-2.5" title="Edit" onClick={() => openEdit(p)}>
                        <Pencil className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        className="a-btn px-2.5 text-red-400"
                        title="Delete"
                        onClick={() => setDeleteTarget(p)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {/* ── Pages & site tab ─────────────────────────────────────────────── */}
      {tab === 'pages' && (
        <div className="space-y-4">
          {seoQ.isLoading ? (
            <div className="a-card p-5 text-center text-sm a-muted">Loading site SEO status…</div>
          ) : seoQ.data ? (
            <>
              {/* Site status */}
              <div className="a-card p-4 sm:p-5">
                <h2 className="text-[0.9375rem] font-semibold">Site status</h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-[0.6875rem] uppercase tracking-wider a-faint">Canonical origin</dt>
                    <dd className="mt-1 break-all text-[0.8125rem] font-medium">{seoQ.data.site.origin}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] uppercase tracking-wider a-faint">Sitemap</dt>
                    <dd className="mt-1 break-all text-[0.8125rem] font-medium">
                      <a href="/sitemap.xml" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                        /sitemap.xml <ExternalLink className="inline h-3 w-3" aria-hidden />
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] uppercase tracking-wider a-faint">robots.txt</dt>
                    <dd className="mt-1 break-all text-[0.8125rem] font-medium">
                      <a href="/robots.txt" target="_blank" rel="noreferrer" className="text-emerald-400 hover:underline">
                        /robots.txt <ExternalLink className="inline h-3 w-3" aria-hidden />
                      </a>
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.6875rem] uppercase tracking-wider a-faint">Analytics</dt>
                    <dd className="mt-1 space-y-0.5 text-[0.8125rem]">
                      <p className={seoQ.data.analytics.gaConfigured ? 'text-emerald-400' : 'a-muted'}>
                        GA4: {seoQ.data.analytics.gaConfigured ? 'configured' : 'not configured'}
                      </p>
                      <p className={seoQ.data.analytics.gscConfigured ? 'text-emerald-400' : 'a-muted'}>
                        Search Console: {seoQ.data.analytics.gscConfigured ? 'verified' : 'not verified'}
                      </p>
                    </dd>
                  </div>
                </dl>
                {(!seoQ.data.analytics.gaConfigured || !seoQ.data.analytics.gscConfigured) && (
                  <p className="mt-3 text-[0.6875rem] a-faint">
                    Configure via environment variables: GA_MEASUREMENT_ID (Google Analytics 4 — loaded on public
                    pages only, never inside the journal app) and GOOGLE_SITE_VERIFICATION (Search Console meta
                    tag). Set them in .env and restart.
                  </p>
                )}
              </div>

              {/* Static page metadata editor */}
              <div className="a-card p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[0.9375rem] font-semibold">Public page metadata</h2>
                  <p className="text-xs a-faint">
                    Overrides apply within a minute. Empty = platform default.
                  </p>
                </div>
                <div className="mt-4 space-y-4">
                  {seoQ.data.pages
                    .filter((p) => p.path !== '/')
                    .map((p) => {
                      const edit = pageEdits[p.path]
                      const title = edit?.title ?? p.title
                      const description = edit?.description ?? p.description
                      return (
                        <div key={p.path} className="rounded-xl border border-border/60 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">
                              {p.name} <span className="ml-1 font-mono text-xs a-faint">{p.path}</span>
                            </p>
                            {p.overridden && <span className="a-badge a-badge-primary">override active</span>}
                          </div>

                          <div className="mt-3 grid gap-3 lg:grid-cols-2">
                            <div>
                              <div className="flex items-center">
                                <label className="a-label" htmlFor={`t-${p.path}`}>
                                  Title
                                </label>
                                <Counter value={title.length} max={70} ideal={60} />
                              </div>
                              <input
                                id={`t-${p.path}`}
                                className="a-input mt-1 w-full"
                                value={title}
                                placeholder={p.defaultTitle}
                                onChange={(e) =>
                                  setPageEdits((prev) => ({
                                    ...prev,
                                    [p.path]: { ...(prev[p.path] ?? {}), title: e.target.value, description },
                                  }))
                                }
                              />
                            </div>
                            <div>
                              <div className="flex items-center">
                                <label className="a-label" htmlFor={`d-${p.path}`}>
                                  Description
                                </label>
                                <Counter value={description.length} max={200} ideal={160} />
                              </div>
                              <textarea
                                id={`d-${p.path}`}
                                className="a-input mt-1 min-h-[42px] w-full resize-y"
                                value={description}
                                placeholder={p.defaultDescription}
                                onChange={(e) =>
                                  setPageEdits((prev) => ({
                                    ...prev,
                                    [p.path]: { ...(prev[p.path] ?? {}), title, description: e.target.value },
                                  }))
                                }
                              />
                            </div>
                          </div>
                          <div className="mt-3">
                            <SerpPreview
                              title={title || p.defaultTitle}
                              description={description || p.defaultDescription}
                              url={`${seoQ.data.site.origin}${p.path === '/' ? '' : p.path}`}
                            />
                          </div>
                        </div>
                      )
                    })}
                </div>
                {dirtyPages && (
                  <div className="mt-4 flex justify-end">
                    <button className="a-btn a-btn-primary" disabled={savePages.isPending} onClick={() => savePages.mutate()}>
                      <Save className="h-4 w-4" aria-hidden /> {savePages.isPending ? 'Saving…' : `Save ${Object.keys(pageEdits).length} page${Object.keys(pageEdits).length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="a-card p-5 text-center text-sm text-red-400">Failed to load SEO status.</div>
          )}
        </div>
      )}

      {/* ── Post editor modal ────────────────────────────────────────────── */}
      <FormModal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        onSubmit={() => savePost.mutate()}
        title={editing ? 'Edit post' : 'New post'}
        description={
          editing
            ? 'Changes go live immediately when the post is published.'
            : 'Markdown content. Publish when ready — drafts stay private.'
        }
        submitLabel={form.status === 'PUBLISHED' ? 'Save & publish' : 'Save draft'}
        loading={savePost.isPending}
        width="max-w-3xl"
      >
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="a-label" htmlFor="p-title">Title</label>
              <input
                id="p-title"
                className="a-input mt-1 w-full"
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="e.g. Five risk rules every journal should measure"
              />
            </div>
            <div>
              <label className="a-label" htmlFor="p-slug">Slug (URL)</label>
              <input
                id="p-slug"
                className="a-input mt-1 w-full font-mono text-xs"
                value={form.slug}
                onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                placeholder="auto-generated from title"
              />
            </div>
          </div>

          <div>
            <label className="a-label" htmlFor="p-excerpt">Excerpt</label>
            <textarea
              id="p-excerpt"
              className="a-input mt-1 min-h-[60px] w-full resize-y"
              value={form.excerpt}
              onChange={(e) => setForm((f) => ({ ...f, excerpt: e.target.value }))}
              placeholder="Listing summary (also the description fallback for search)"
            />
          </div>

          <div>
            <label className="a-label" htmlFor="p-content">Content (Markdown)</label>
            <textarea
              id="p-content"
              className="a-input mt-1 min-h-[220px] w-full resize-y font-mono text-[0.8125rem] leading-relaxed"
              value={form.content}
              onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))}
              placeholder={'## A section heading\n\nWrite the article in Markdown. **Bold**, lists, quotes, tables and code blocks are supported.'}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="a-label" htmlFor="p-category">Category</label>
              <select
                id="p-category"
                className="a-input mt-1 w-full"
                value={form.categoryId}
                onChange={(e) => setForm((f) => ({ ...f, categoryId: e.target.value }))}
              >
                <option value="">— none —</option>
                {(postsQ.data?.categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="a-label" htmlFor="p-tags">Tags</label>
              <input
                id="p-tags"
                className="a-input mt-1 w-full"
                value={form.tags}
                onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))}
                placeholder="risk, psychology (comma-separated)"
              />
            </div>
            <div>
              <label className="a-label" htmlFor="p-status">Status</label>
              <select
                id="p-status"
                className="a-input mt-1 w-full"
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'DRAFT' | 'PUBLISHED' }))}
              >
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="a-label" htmlFor="p-author">Author name</label>
              <input
                id="p-author"
                className="a-input mt-1 w-full"
                value={form.authorName}
                onChange={(e) => setForm((f) => ({ ...f, authorName: e.target.value }))}
                placeholder="defaults to your account name"
              />
            </div>
            <div>
              <label className="a-label" htmlFor="p-atitle">Author title</label>
              <input
                id="p-atitle"
                className="a-input mt-1 w-full"
                value={form.authorTitle}
                onChange={(e) => setForm((f) => ({ ...f, authorTitle: e.target.value }))}
                placeholder="e.g. EmorTrades"
              />
            </div>
            <div>
              <label className="a-label" htmlFor="p-image">Featured image path</label>
              <input
                id="p-image"
                className="a-input mt-1 w-full font-mono text-xs"
                value={form.featuredImage}
                onChange={(e) => setForm((f) => ({ ...f, featuredImage: e.target.value }))}
                placeholder="/blog/my-image.png"
              />
            </div>
          </div>

          {/* SEO panel */}
          <div className="rounded-xl border border-border/60 bg-background/40 p-4">
            <h3 className="text-sm font-semibold">Search metadata</h3>
            <div className="mt-3 grid gap-4 lg:grid-cols-2">
              <div>
                <div className="flex items-center">
                  <label className="a-label" htmlFor="p-seotitle">SEO title</label>
                  <Counter value={form.seoTitle.length} max={70} ideal={60} />
                </div>
                <input
                  id="p-seotitle"
                  className="a-input mt-1 w-full"
                  value={form.seoTitle}
                  onChange={(e) => setForm((f) => ({ ...f, seoTitle: e.target.value }))}
                  placeholder={form.title || 'falls back to the post title'}
                />
              </div>
              <div>
                <div className="flex items-center">
                  <label className="a-label" htmlFor="p-seodesc">Meta description</label>
                  <Counter value={form.seoDescription.length} max={200} ideal={160} />
                </div>
                <textarea
                  id="p-seodesc"
                  className="a-input mt-1 min-h-[42px] w-full resize-y"
                  value={form.seoDescription}
                  onChange={(e) => setForm((f) => ({ ...f, seoDescription: e.target.value }))}
                  placeholder={form.excerpt || 'falls back to the excerpt'}
                />
              </div>
              <div>
                <label className="a-label" htmlFor="p-canonical">Canonical URL (optional)</label>
                <input
                  id="p-canonical"
                  className="a-input mt-1 w-full font-mono text-xs"
                  value={form.canonicalUrl}
                  onChange={(e) => setForm((f) => ({ ...f, canonicalUrl: e.target.value }))}
                  placeholder="defaults to /blog/<slug>"
                />
              </div>
              <div>
                <label className="a-label" htmlFor="p-og">Social share image (optional)</label>
                <input
                  id="p-og"
                  className="a-input mt-1 w-full font-mono text-xs"
                  value={form.ogImage}
                  onChange={(e) => setForm((f) => ({ ...f, ogImage: e.target.value }))}
                  placeholder="defaults to featured image / site OG image"
                />
              </div>
            </div>
            <label className="mt-4 flex items-center gap-2 text-[0.8125rem]">
              <input
                type="checkbox"
                checked={form.noindex}
                onChange={(e) => setForm((f) => ({ ...f, noindex: e.target.checked }))}
                className="h-4 w-4 rounded border-border"
              />
              Exclude from search engines (noindex — removes from sitemap too)
            </label>
            <div className="mt-4">
              <SerpPreview
                title={form.seoTitle || form.title || 'Untitled post'}
                description={form.seoDescription || form.excerpt || ''}
                url={`${seoQ.data?.site.origin ?? ''}/blog/${form.slug || 'slug'}`}
              />
            </div>
          </div>
        </div>
      </FormModal>

      {/* Delete confirm */}
      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && deletePost.mutate(deleteTarget)}
        title="Delete post"
        description={`"${deleteTarget?.title ?? ''}" will be removed permanently from the public blog.`}
        confirmLabel="Delete permanently"
        loading={deletePost.isPending}
        tone="danger"
      />
    </div>
  )
}
