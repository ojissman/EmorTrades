/**
 * ORIGIN — reconstruct the public origin of a request behind the gateway
 * proxy (Caddy). Google OAuth redirect URIs and verification links must be
 * built from what the OUTSIDE world used to reach us, not localhost:3000.
 *
 * This sandbox is double-proxied: the outer platform rewrites Host to an
 * internal container name (observed: ws-*.fcapp.run, x-forwarded-proto http),
 * so header-based reconstruction yields an origin real browsers can never
 * reach. PUBLIC_ORIGIN pins the true public origin explicitly — it must be
 * kept in sync with the OAuth redirect URI registered in Google Cloud Console.
 *
 * Priority: PUBLIC_ORIGIN env → x-forwarded-host + x-forwarded-proto → host
 * header → req.url.
 */
export function originFromReq(req: Request): string {
  const pinned = process.env.PUBLIC_ORIGIN
  if (pinned) {
    const origin = pinned.trim().replace(/\/+$/, '')
    if (origin) return origin
  }
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
