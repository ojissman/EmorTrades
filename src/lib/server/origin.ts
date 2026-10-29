/**
 * ORIGIN — reconstruct the public origin of a request behind the gateway
 * proxy (Caddy). Google OAuth redirect URIs and verification links must be
 * built from what the OUTSIDE world used to reach us, not localhost:3000.
 *
 * Priority: x-forwarded-host + x-forwarded-proto → host header → req.url.
 */
export function originFromReq(req: Request): string {
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
