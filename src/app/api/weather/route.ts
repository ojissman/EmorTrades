import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { requireUser } from '@/lib/server/auth'
import { rateLimit, clientIp } from '@/lib/server/rate-limit'
import { geocodeCity, getWeather, type WeatherLocation } from '@/lib/server/weather'

export const dynamic = 'force-dynamic'

/**
 * GET /api/weather (GOOGLE-CLOUD-INTEGRATION · Weather)
 *
 * Current conditions for the signed-in user, for the overview weather chip.
 * Two accepted query shapes:
 *   ?q=<city search>       → geocoded server-side (city name → coordinates)
 *   ?lat=&lon=&name=&country= → direct coordinates (a previously saved pick)
 *
 * Open-Meteo (keyless) with a 10-minute server-side cache; rate limited to
 * keep the free provider happy. Never proxy arbitrary geocoding queries for
 * anonymous callers — requireUser gate first.
 */
const QuerySchema = z
  .object({
    q: z.string().trim().min(2).max(64).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    name: z.string().trim().min(1).max(64).optional(),
    country: z.string().trim().min(1).max(64).optional(),
  })
  .refine((v) => Boolean(v.q) || (typeof v.lat === 'number' && typeof v.lon === 'number'), {
    message: 'Provide ?q=<city> or ?lat=&lon=.',
  })

export async function GET(req: NextRequest) {
  const auth = await requireUser()
  if (!auth.ok) return auth.response

  const ip = clientIp(req)
  const rl = rateLimit(`weather:${ip}`, 30, 5 * 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Too many requests. Try again shortly.' }, { status: 429 })
  }

  const parsed = QuerySchema.safeParse({
    q: req.nextUrl.searchParams.get('q') ?? undefined,
    lat: req.nextUrl.searchParams.get('lat') ?? undefined,
    lon: req.nextUrl.searchParams.get('lon') ?? undefined,
    name: req.nextUrl.searchParams.get('name') ?? undefined,
    country: req.nextUrl.searchParams.get('country') ?? undefined,
  })
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', message: parsed.error.issues[0]?.message ?? 'Invalid input.' },
      { status: 400 }
    )
  }

  let location: WeatherLocation | null = null
  if (parsed.data.q) {
    location = await geocodeCity(parsed.data.q)
    if (!location) {
      return NextResponse.json({ error: 'City not found', message: 'No match for that city name.' }, { status: 404 })
    }
  } else if (typeof parsed.data.lat === 'number' && typeof parsed.data.lon === 'number') {
    location = {
      name: parsed.data.name ?? `${parsed.data.lat.toFixed(2)}, ${parsed.data.lon.toFixed(2)}`,
      country: parsed.data.country ?? '',
      latitude: parsed.data.lat,
      longitude: parsed.data.lon,
    }
  }
  if (!location) {
    return NextResponse.json({ error: 'Validation failed', message: 'Missing location.' }, { status: 400 })
  }

  const snapshot = await getWeather(location)
  if (!snapshot) {
    return NextResponse.json({ error: 'Weather unavailable. Try again shortly.' }, { status: 502 })
  }
  return NextResponse.json(snapshot)
}
