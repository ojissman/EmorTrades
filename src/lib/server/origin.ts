/**
 * ORIGIN — reconstruct the public origin of a request behind the gateway
 * proxy (Caddy). Google OAuth redirect URIs and verification links must be
 * built from what the OUTSIDE world used to reach us, not localhost:3000.
 *
 * This sandbox is double-proxied: the outer platform rewrites Host to an
 * internal container name (observed: ws-*.fcapp.run, x-forwarded-proto http),
 * so header-based reconstruction yields an origin real browsers can never
 * reach. The pin below is therefore authoritative when set.
 *
 * TWO DOORS, TWO PINS (AUTH-9). The app is reachable on two public origins:
 *   · production  — https://emortrade.space-z.ai   (the published runtime)
 *   · preview     — the preview-chat-*.space-z.ai URL (this dev sandbox)
 * They are DIFFERENT DOMAINS with different cookies, so an OAuth flow must
 * return to the door it started from (the state cookie cannot cross domains).
 * One single pin cannot serve both — that bounced preview-panel Google
 * sign-ins to the production callback and failed the state check.
 * resolvePinnedOrigin() picks per runtime:
 *   · dev server  (NODE_ENV=development): DEV_ORIGIN (the preview URL),
 *                  falling back to PUBLIC_ORIGIN when unset.
 *   · published   (NODE_ENV=production):  PUBLIC_ORIGIN, full stop.
 * Both must stay in sync with the redirect URIs registered in Google Cloud
 * Console (Google allows up to 20 per client; both are registered).
 *
 * Priority: resolved pin → x-forwarded-host + x-forwarded-proto → host
 * header → req.url.
 */

export type OriginEnv = Pick<
  NodeJS.ProcessEnv,
  'NODE_ENV' | 'PUBLIC_ORIGIN' | 'DEV_ORIGIN'
>

/**
 * The authoritative pinned origin for the CURRENT runtime, or '' when unset.
 * Trailing slashes are normalized away.
 */
export function resolvePinnedOrigin(env: OriginEnv = process.env): string {
  const prod = (env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '')
  const dev = (env.DEV_ORIGIN ?? '').trim().replace(/\/+$/, '')
  if (env.NODE_ENV === 'development') return dev || prod
  return prod
}

export function originFromReq(req: Request): string {
  const pinned = resolvePinnedOrigin()
  if (pinned) return pinned
  const fwdHost = req.headers.get('x-forwarded-host')
  const fwdProto = req.headers.get('x-forwarded-proto')
  if (fwdHost) {
    const proto = fwdProto?.split(',')[0]?.trim() || 'https'
    return `${proto}://${fwdHost.split(',')[0].trim()}`
  }
  const host = req.headers.get('host')
  if (host) {
    try {
      return new URL(req.url).protocol.replace(':', '') === 'http' && host.startsWith('localhost')
        ? `http://${host}`
        : `https://${host}`
    } catch {
      /* fall through */
    }
  }
  try {
    return new URL(req.url).origin
  } catch {
    return 'http://localhost:3000'
  }
}
