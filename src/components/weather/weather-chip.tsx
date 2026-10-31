'use client'

/**
 * WeatherChip — the overview banner's current-conditions chip.
 * GOOGLE-CLOUD-INTEGRATION · Weather (Open-Meteo, keyless, auth-gated via
 * /api/weather).
 *
 * Design notes:
 *  · The location is a per-BROWSER preference (localStorage) — weather is a
 *    desk ambience feature, not account data, and this way it never touches
 *    the database or asks for geolocation permissions.
 *  · City search goes through /api/weather?q= (server-side geocoding), so no
 *    third-party call ever happens from the browser.
 *  · Cached server-side (10 min) — the chip re-fetches on the same cadence.
 */

import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CloudSun, Loader2, MapPin, Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

interface StoredLocation {
  name: string
  country: string
  latitude: number
  longitude: number
}

interface WeatherSnapshot {
  location: StoredLocation
  current: {
    temperature: number
    apparentTemperature: number
    humidity: number
    windKmh: number
    weatherCode: number
    isDay: boolean
  }
  label: string
  fetchedAt: string
}

const STORAGE_KEY = 'emorta.weather.location'

/** WMO code → emoji (kept client-side; the label comes from the server). */
function wmoEmoji(code: number, isDay: boolean): string {
  if (code === 0) return isDay ? '☀️' : '🌙'
  if (code === 1) return isDay ? '🌤️' : '☁️'
  if (code === 2) return '⛅'
  if (code === 3) return '☁️'
  if (code === 45 || code === 48) return '🌫️'
  if (code >= 51 && code <= 57) return '🌦️'
  if (code >= 61 && code <= 67) return '🌧️'
  if (code >= 71 && code <= 77) return '🌨️'
  if (code >= 80 && code <= 82) return '🌧️'
  if (code === 85 || code === 86) return '🌨️'
  if (code >= 95) return '⛈️'
  return '🌡️'
}

function loadStored(): StoredLocation | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredLocation
    if (typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number' || !parsed.name) return null
    return parsed
  } catch {
    return null
  }
}

export function WeatherChip() {
  const [location, setLocation] = useState<StoredLocation | null>(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  // localStorage is browser-only — read after mount to avoid hydration drift.
  useEffect(() => {
    setLocation(loadStored())
  }, [])

  const { data, isLoading } = useQuery<WeatherSnapshot | null>({
    queryKey: ['weather', location?.latitude, location?.longitude],
    queryFn: async () => {
      if (!location) return null
      const params = new URLSearchParams({
        lat: String(location.latitude),
        lon: String(location.longitude),
        name: location.name,
        country: location.country,
      })
      const res = await fetch(`/api/weather?${params.toString()}`)
      if (!res.ok) return null
      return (await res.json()) as WeatherSnapshot
    },
    enabled: Boolean(location),
    refetchInterval: 10 * 60_000, // matches the server cache cadence
    staleTime: 10 * 60_000,
  })

  const search = async () => {
    const q = query.trim()
    if (q.length < 2) return
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(`/api/weather?q=${encodeURIComponent(q)}`)
      if (res.status === 404) {
        setSearchError('No match — try a bigger nearby city.')
        return
      }
      if (!res.ok) {
        setSearchError('Search failed — try again.')
        return
      }
      const snap = (await res.json()) as WeatherSnapshot
      const next: StoredLocation = {
        name: snap.location.name,
        country: snap.location.country,
        latitude: snap.location.latitude,
        longitude: snap.location.longitude,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      setLocation(next)
      setOpen(false)
      setQuery('')
    } catch {
      setSearchError('Search failed — try again.')
    } finally {
      setSearching(false)
    }
  }

  const clearLocation = () => {
    localStorage.removeItem(STORAGE_KEY)
    setLocation(null)
    setOpen(false)
  }

  return (
    <div className="flex items-center gap-1.5" data-testid="weather-chip">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground/80 transition-colors hover:bg-muted/60 hover:text-foreground"
            title="Weather — click to change city"
            aria-label={location ? `Weather in ${location.name}` : 'Add a weather location'}
          >
            {location ? (
              <>
                <span aria-hidden className="text-[13px] leading-none">
                  {data ? wmoEmoji(data.current.weatherCode, data.current.isDay) : '🌥️'}
                </span>
                {isLoading && !data ? (
                  <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                ) : (
                  <span className="tabular-nums">{data ? `${data.current.temperature}°C` : '—'}</span>
                )}
                <span className="max-w-[140px] truncate">{data?.label ?? location.name}</span>
                <span className="text-muted-foreground/50">·</span>
                <span className="max-w-[120px] truncate">{location.name}</span>
              </>
            ) : (
              <>
                <CloudSun className="h-3.5 w-3.5" aria-hidden />
                <span>Add weather</span>
              </>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-3">
          <div className="space-y-2">
            <p className="text-xs font-medium">Weather location</p>
            <div className="flex items-center gap-2">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void search()
                  }
                }}
                placeholder="Search a city (e.g. Lagos)"
                className="h-8 text-xs"
                autoFocus
                aria-label="City search"
              />
              <Button size="sm" variant="secondary" className="h-8 px-2.5" onClick={() => void search()} disabled={searching || query.trim().length < 2}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Search className="h-3.5 w-3.5" aria-hidden />}
                <span className="sr-only">Search city</span>
              </Button>
            </div>
            {searchError && <p className="text-[11px] text-destructive">{searchError}</p>}
            {location && (
              <div className="flex items-center justify-between rounded-md bg-muted/50 px-2 py-1.5">
                <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <MapPin className="h-3 w-3" aria-hidden />
                  <span className="max-w-[160px] truncate">
                    {location.name}
                    {location.country ? `, ${location.country}` : ''}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={clearLocation}
                  className="cursor-pointer rounded p-0.5 text-muted-foreground/60 hover:text-foreground"
                  aria-label="Remove weather location"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              </div>
            )}
            <p className="text-[10px] leading-relaxed text-muted-foreground/60">
              Saved in this browser only. Data: Open-Meteo (keyless), refreshed every 10 minutes.
            </p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  )
}
