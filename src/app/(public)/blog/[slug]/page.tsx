import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { Breadcrumbs } from '@/components/public/chrome'
import { Markdown } from '@/components/public/markdown'
import { SITE, articleJsonLd, breadcrumbJsonLd } from '@/lib/seo'

export const dynamic = 'force-dynamic'

interface Params {
  params: Promise<{ slug: string }>
}

async function loadPost(slug: string) {
  return db.blogPost.findUnique({
    where: { slug },
    include: { category: { select: { name: true, slug: true } } },
  })
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params
  const post = await loadPost(slug)

  if (!post || post.status !== 'PUBLISHED') {
    return { title: 'Article not found', robots: { index: false, follow: false } }
  }

  const description =
    post.seoDescription?.trim() ||
    post.excerpt?.trim() ||
    post.content.replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 158) + '…'
  const title = post.seoTitle?.trim() || post.title

  return {
    title,
    description,
    alternates: { canonical: post.canonicalUrl?.trim() || `/blog/${post.slug}` },
    openGraph: {
      type: 'article',
      title,
      description,
      url: `/blog/${post.slug}`,
      ...(post.publishedAt ? { publishedTime: post.publishedAt.toISOString() } : {}),
      modifiedTime: post.updatedAt.toISOString(),
      authors: [post.authorName],
      ...(post.ogImage?.trim() || post.featuredImage
        ? { images: [{ url: (post.ogImage?.trim() || post.featuredImage) as string }] }
        : { images: [{ url: SITE.ogImage }] }),
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [post.ogImage?.trim() || post.featuredImage || SITE.ogImage],
    },
    robots: post.noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
  }
}

function readingTime(content: string): number {
  return Math.max(1, Math.round(content.split(/\s+/).length / 220))
}

function formatDate(d: Date | null): string {
  if (!d) return ''
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
}

export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params
  const post = await loadPost(slug)
  if (!post || post.status !== 'PUBLISHED') notFound()

  const description =
    post.seoDescription?.trim() ||
    post.excerpt?.trim() ||
    post.content.replace(/[#>*_`\[\]()!-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 158) + '…'

  const related = post.category
    ? await db.blogPost.findMany({
        where: {
          status: 'PUBLISHED',
          publishedAt: { not: null },
          slug: { not: post.slug },
          categoryId: post.categoryId,
        },
        orderBy: { publishedAt: 'desc' },
        take: 3,
        select: { slug: true, title: true, excerpt: true, featuredImage: true },
      })
    : []

  const url = `${SITE.url}/blog/${post.slug}`
  const jsonLd = [
    articleJsonLd({
      title: post.title,
      description,
      slug: post.slug,
      publishedAt: post.publishedAt,
      updatedAt: post.updatedAt,
      authorName: post.authorName,
      featuredImage: post.featuredImage,
    }),
    breadcrumbJsonLd([
      { name: 'Home', url: SITE.url },
      { name: 'Blog', url: `${SITE.url}/blog` },
      { name: post.title, url },
    ]),
  ]

  const tags = (post.tags ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <Breadcrumbs
        items={[{ name: 'Home', href: '/' }, { name: 'Blog', href: '/blog' }, { name: post.title }]}
      />

      <article className="mx-auto max-w-3xl px-4 pb-16 pt-8 sm:px-6">
        {/* Header */}
        <header className="mt-4">
          <p className="flex flex-wrap items-center gap-2 text-[0.6875rem] font-medium uppercase tracking-wider">
            {post.category && (
              <Link href="/blog" className="text-emerald-400 hover:text-emerald-300">{post.category.name}</Link>
            )}
            {post.publishedAt && <span className="text-slate-600">· {formatDate(post.publishedAt)}</span>}
          </p>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-slate-50 sm:text-4xl">
            {post.title}
          </h1>
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-slate-500">
            <span className="font-medium text-slate-400">{post.authorName}</span>
            {post.authorTitle && <span className="text-slate-600">· {post.authorTitle}</span>}
            <span className="text-slate-600">· {readingTime(post.content)} min read</span>
          </p>
        </header>

        {post.featuredImage && (
           
          <img
            src={post.featuredImage}
            alt={`Illustration for: ${post.title}`}
            width={1200}
            height={630}
            className="mt-8 w-full rounded-3xl border border-slate-800/70"
          />
        )}

        {/* Body */}
        <div className="mt-8">
          <Markdown source={post.content} />
        </div>

        {/* Tags */}
        {tags.length > 0 && (
          <ul className="mt-10 flex flex-wrap gap-2" aria-label="Article tags">
            {tags.map((t) => (
              <li key={t} className="rounded-full border border-slate-800 bg-slate-900/40 px-3 py-1 text-xs text-slate-400">
                #{t}
              </li>
            ))}
          </ul>
        )}

        {/* Share */}
        <section aria-labelledby="share-heading" className="mt-10 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800/70 bg-slate-900/30 px-5 py-4">
          <h2 id="share-heading" className="text-sm font-semibold text-slate-300">Share this article</h2>
          <div className="flex gap-2">
            <a
              href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(post.title)}&url=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Share on X
            </a>
            <a
              href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
            >
              LinkedIn
            </a>
            <a
              href={`mailto:?subject=${encodeURIComponent(post.title)}&body=${encodeURIComponent(url)}`}
              className="rounded-lg border border-slate-800 px-3 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:border-emerald-500/40 hover:text-emerald-300"
            >
              Email
            </a>
          </div>
        </section>

        {/* Related */}
        {related.length > 0 && (
          <section aria-labelledby="related-heading" className="mt-14">
            <h2 id="related-heading" className="text-xl font-bold text-slate-50">Related reading</h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-3">
              {related.map((r) => (
                <li key={r.slug}>
                  <Link
                    href={`/blog/${r.slug}`}
                    className="group flex h-full flex-col rounded-2xl border border-slate-800/70 bg-slate-900/30 p-4 transition-colors hover:border-emerald-500/30"
                  >
                    {r.featuredImage && (
                       
                      <img src={r.featuredImage} alt="" loading="lazy" className="mb-3 aspect-[120/63] w-full rounded-xl object-cover" />
                    )}
                    <h3 className="text-sm font-semibold leading-snug text-slate-200 transition-colors group-hover:text-emerald-300">
                      {r.title}
                    </h3>
                    {r.excerpt && <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">{r.excerpt}</p>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* CTA */}
        <div className="mt-14 rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-[#0e1f2e] to-[#0b1220] px-6 py-10 text-center">
          <h2 className="text-xl font-bold text-slate-50">Put it into practice</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-slate-400">
            Every concept in this article is a built-in feature. Start your journal free and let the
            analytics find your patterns.
          </p>
          <Link
            href="/#/register"
            className="mt-5 inline-flex items-center justify-center rounded-xl bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 hover:bg-emerald-500"
          >
            Create your free account
          </Link>
        </div>
      </article>
    </>
  )
}
