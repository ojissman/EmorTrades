import { notFound } from 'next/navigation'

/**
 * Catch-all: this app is a single-route SPA (all navigation is in-app
 * zustand state at `/`). SEO-UPGRADE: unknown URLs now return a REAL 404
 * (correct status code for crawlers and broken-link detection) instead of a
 * redirect to `/`, which masked dead links as soft-200s. Real public routes
 * (/, /blog, /about, /features, …) are matched by their own segments before
 * this handler ever runs.
 */
export default function CatchAllPage() {
  notFound()
}
