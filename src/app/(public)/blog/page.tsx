import type { Metadata } from 'next'
import Link from 'next/link'
import { db } from '@/lib/db'
import { Breadcrumbs, PageHero } from '@/components/public/chrome'
import { SITE, staticPageMeta } from '@/lib/seo'

export const dynamic = 'force-dynamic'

const PAGE_SIZE = 9

export async function generateMetadata(): Promise<Metadata> {
  const meta = await staticPageMeta('/blog')
  return {
    title: { absolute: meta.title },
    description: meta.description,
    alternates: { canonical: '/blog' },
    openGraph: { title: meta.title, description: meta.description, url: '/blog' },
  }
}

/**
 * /blog (SEO-UPGRADE · PHASE 6) — published posts, newest first, paginated.
 * Paginated URLs use ?page=N (canonical per page, crawlable links); drafts
 * and noindex posts never appear.
 */

interface PostCard {
  slug: string
  title: string
  excerpt: string | null
  content: string
  featuredImage: string | null
  publishedAt: Date | null
  authorName: string
  tags: string | null
  category: { name: string; slug: string } | null
}

function readingTime(content: string): number {
  return Math.max(1, Math.round(content.split(/\s+/).length / 220))
}

function snippet(post: Pick<PostCard, 'excerpt' | 'content'>): string {
  if (post.excerpt?.trim()) return post.excerpt.trim()
  return post.content.replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) + '…'
}

function formatDate(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function BlogIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? '1', 10) || 1)

  const [posts, total] = await Promise.all([
    db.blogPost.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: { publishedAt: 'desc' },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        slug: true, title: true, excerpt: true, content: true, featuredImage: true,
        publishedAt: true, authorName: true, tags: true,
        category: { select: { name: true, slug: true } },
      },
    }),
    db.blogPost.count({ where: { status: 'PUBLISHED', publishedAt: { not: null } } }),
  ])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const isFirst = page === 1
  const isLast = page === totalPages

  return (
    <>
      <Breadcrumbs items={[{ name: 'Home', href: '/' }, { name: 'Blog' }]} />
      <PageHero
        eyebrow="Blog"
        title="Notes from the desk"
        lead="Practical writing on journaling, risk, psychology and performance analytics — for traders who treat this as a craft."
      />

      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-16">
        {posts.length === 0 ? (
          <div className="rounded-3xl border border-slate-800/70 bg-slate-900/30 p-12 text-center">
            <h2 className="text-lg font-semibold text-slate-100">The first articles are being written</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
              Real guides on journaling practice, risk management and analytics are on the way.
              Meanwhile, <Link href="/features" className="text-emerald-400 underline-offset-4 hover:underline">explore the platform</Link> or{' '}
              <Link href="/#/register" className="text-emerald-400 underline-offset-4 hover:underline">start your journal</Link>.
            </p>
          </div>
        ) : (
          <>
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {posts.map((post) => (
                <li key={post.slug}>
                  <article className="group flex h-full flex-col overflow-hidden rounded-3xl border border-slate-800/70 bg-slate-900/30 transition-colors hover:border-emerald-500/30">
                    {post.featuredImage && (
                      <Link href={`/blog/${post.slug}`} className="block aspect-[120/63] overflow-hidden" tabIndex={-1} aria-hidden>
                        { }
                        <img
                          src={post.featuredImage}
                          alt=""
                          loading="lazy"
                          className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        />
                      </Link>
                    )}
                    <div className="flex flex-1 flex-col p-5">
                      <p className="flex items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider">
                        {post.category && (
                          <span className="text-emerald-400">{post.category.name}</span>
                        )}
                        <span className="text-slate-600">· {formatDate(post.publishedAt)}</span>
                      </p>
                      <h2 className="mt-2 text-[1.0625rem] font-semibold leading-snug text-slate-100">
                        <Link href={`/blog/${post.slug}`} className="transition-colors group-hover:text-emerald-300">
                          {post.title}
                        </Link>
                      </h2>
                      <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-slate-400">
                        {snippet(post)}
                      </p>
                      <p className="mt-auto pt-4 text-xs text-slate-600">
                        {post.authorName} · {readingTime(post.content)} min read
                      </p>
                    </div>
                  </article>
                </li>
              ))}
            </ul>

            {totalPages > 1 && (
              <nav aria-label="Blog pages" className="mt-12 flex items-center justify-center gap-3">
                {!isFirst && (
                  <Link
                    href={`/blog${page - 1 === 1 ? '' : `?page=${page - 1}`}`}
                    rel="prev"
                    className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-white"
                  >
                    ← Newer
                  </Link>
                )}
                <span className="text-sm text-slate-500">Page {page} of {totalPages}</span>
                {!isLast && (
                  <Link
                    href={`/blog?page=${page + 1}`}
                    rel="next"
                    className="rounded-xl border border-slate-800 px-4 py-2 text-sm font-medium text-slate-300 transition-colors hover:border-emerald-500/40 hover:text-white"
                  >
                    Older →
                  </Link>
                )}
              </nav>
            )}
          </>
        )}
      </div>
    </>
  )
}
