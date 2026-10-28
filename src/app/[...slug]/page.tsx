import { redirect } from 'next/navigation'

/**
 * Catch-all: this app is a single-route SPA (all navigation is in-app
 * zustand state at `/`). Any unknown URL (e.g. /settings, /trades/123)
 * lands here and is bounced into the app instead of a dead 404 page.
 */
export default function CatchAllPage() {
  redirect('/')
}
