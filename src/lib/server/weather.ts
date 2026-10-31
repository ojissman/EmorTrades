/**
 * ============================================================================
 * WEATHER — Open-Meteo (no API key, no account, CC-BY 4.0).
 * ============================================================================
 * GOOGLE-CLOUD-INTEGRATION · "Weather API integration using an appropriate
 * external provider." Open-Meteo was chosen: keyless (zero secrets to manage
 * or leak), GDPR-storing-minimal, and reliable. Two endpoints:
 *   · geocoding-api.open-meteo.com — city search → coordinates
 *   · api.open-meteo.com/v1/forecast — current conditions
 * Responses are cached in memory (10 min for weather, 24 h for geocode) so a
 * busy desk doesn't hammer the provider.
 */

export interface WeatherLocation {
  name: string
  country: string
  latitude: number
  longitude: number
  timezone?: string
}

export interface CurrentWeather {
  temperature: number
  apparentTemperature: number
  humidity: number
  windKmh: number
  weatherCode: number
  isDay: boolean
}

export interface WeatherSnapshot {
  location: WeatherLocation
  current: CurrentWeather
  label: string
  fetchedAt: string
}

/** WMO weather interpretation codes → short human labels. */
const WMO_LABELS: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Freezing fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  56: 'Freezing drizzle',
  57: 'Freezing drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Rain showers',
  81: 'Rain showers',
  82: 'Violent showers',
  85: 'Snow showers',
  86: 'Snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with hail',
  99: 'Thunderstorm with hail',
}

export function wmoLabel(code: number): string {
  return WMO_LABELS[code] ?? 'Unknown'
}

/* ── Caches ──────────────────────────────────────────────────────────────── */

const weatherCache = new Map<string, { at: number; value: WeatherSnapshot }>()
const geocodeCache = new Map<string, { at: number; value: WeatherLocation | null }>()
const WEATHER_TTL_MS = 10 * 60_000
const GEOCODE_TTL_MS = 24 * 60 * 60_000

/* ── Geocoding (city search) ─────────────────────────────────────────────── */

export async function geocodeCity(query: string): Promise<WeatherLocation | null> {
  const key = query.trim().toLowerCase()
  if (!key) return null
  const hit = geocodeCache.get(key)
  if (hit && Date.now() - hit.at < GEOCODE_TTL_MS) return hit.value
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(key)}&count=1&language=en&format=json`
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`geocoding HTTP ${res.status}`)
    const json = (await res.json()) as {
      results?: { name: string; country: string; country_code: string; latitude: number; longitude: number; timezone: string }[]
    }
    const top = json.results?.[0] ?? null
    const value: WeatherLocation | null = top
      ? { name: top.name, country: top.country || top.country_code, latitude: top.latitude, longitude: top.longitude, timezone: top.timezone }
      : null
    geocodeCache.set(key, { at: Date.now(), value })
    return value
  } catch (e) {
    console.error(`[weather] geocoding failed for "${key}":`, e instanceof Error ? e.message : e)
    return hit?.value ?? null // stale is better than nothing
  }
}

/* ── Current weather ─────────────────────────────────────────────────────── */

export async function getWeather(loc: WeatherLocation): Promise<WeatherSnapshot | null> {
  const key = `${loc.latitude.toFixed(2)},${loc.longitude.toFixed(2)}`
  const hit = weatherCache.get(key)
  if (hit && Date.now() - hit.at < WEATHER_TTL_MS) return hit.value
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}` +
      '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day&timezone=auto'
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`forecast HTTP ${res.status}`)
    const json = (await res.json()) as {
      current: {
        temperature_2m: number
        apparent_temperature: number
        relative_humidity_2m: number
        weather_code: number
        wind_speed_10m: number
        is_day: boolean
      }
    }
    if (!json.current) throw new Error('no current block')
    const value: WeatherSnapshot = {
      location: loc,
      current: {
        temperature: Math.round(json.current.temperature_2m),
        apparentTemperature: Math.round(json.current.apparent_temperature),
        humidity: Math.round(json.current.relative_humidity_2m),
        windKmh: Math.round(json.current.wind_speed_10m),
        weatherCode: json.current.weather_code,
        isDay: Boolean(json.current.is_day),
      },
      label: wmoLabel(json.current.weather_code),
      fetchedAt: new Date().toISOString(),
    }
    weatherCache.set(key, { at: Date.now(), value })
    return value
  } catch (e) {
    console.error(`[weather] forecast failed for ${key}:`, e instanceof Error ? e.message : e)
    return hit?.value ?? null
  }
}
