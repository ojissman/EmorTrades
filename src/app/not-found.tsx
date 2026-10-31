import Link from 'next/link'
import { SITE } from '@/lib/seo'

/**
 * 404 (SEO-UPGRADE) — served with a real 404 status via notFound() calls
 * (catch-all + any notFound() in pages). Public, self-indexing-safe,
 * links to the real public surfaces so crawlers and lost visitors recover.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center bg-[#070b14] p-4 text-slate-100">
      <div className="w-full max-w-md text-center">
        <p className="text-[0.8125rem] font-semibold tracking-widest text-emerald-400">404</p>
        <h1 className="mt-2 text-2xl font-bold text-white">Page not found</h1>
        <p className="mt-3 text-sm leading-relaxed text-slate-400">
          The page you&apos;re looking for doesn&apos;t exist or has been moved. It may have been a
          private app route — <Link href="/" className="text-emerald-400 underline-offset-4 hover:underline">sign in</Link> to
          reach your journal.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
          <Link
            href="/"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-[#052014] transition hover:bg-emerald-400"
          >
            Go to {SITE.name}
          </Link>
          <Link
            href="/features"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-white"
          >
            Explore features
          </Link>
          <Link
            href="/blog"
            className="rounded-lg border border-white/15 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-emerald-400/50 hover:text-white"
          >
            Read the blog
          </Link>
        </div>
      </div>
    </div>
  )
}
