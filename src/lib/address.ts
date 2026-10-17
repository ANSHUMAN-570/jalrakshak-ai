import type { AddressComponents, Incident, Report, ReportAddress } from './types'

const NOMINATIM = 'https://nominatim.openstreetmap.org'

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

/** Collapse whitespace, drop control characters and cap length. User text is rendered by React (escaped), this just keeps data tidy. */
export function cleanText(s: string | undefined, max = 120): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)
}

export const isValidPin = (pin: string) => pin === '' || /^[1-9][0-9]{5}$/.test(pin)

export function cleanComponents(c: AddressComponents): AddressComponents {
  const out: AddressComponents = {}
  const line = cleanText(c.line, 160)
  const locality = cleanText(c.locality, 80)
  const city = cleanText(c.city, 80)
  const state = cleanText(c.state, 60)
  const pin = cleanText(c.pin, 6)
  if (line) out.line = line
  if (locality) out.locality = locality
  if (city) out.city = city
  if (state) out.state = state
  if (pin) out.pin = pin
  return out
}

export function hasAddress(c: AddressComponents): boolean {
  return Object.values(cleanComponents(c)).some(Boolean)
}

export function formatComponents(c: AddressComponents): string {
  const x = cleanComponents(c)
  const tail = [x.city, x.state].filter(Boolean).join(', ')
  return [x.line, x.locality, x.pin ? `${tail}${tail ? ' ' : ''}${x.pin}` : tail].filter(Boolean).join(', ')
}

/** Human-readable text for a stored address, or null. Never returns "undefined"/"null"/empty. */
export function addressText(a: ReportAddress | undefined | null): string | null {
  if (!a || typeof a !== 'object') return null
  const f = typeof a.formatted === 'string' ? cleanText(a.formatted, 300) : ''
  if (f) return f
  const c = a.components && typeof a.components === 'object' ? formatComponents(a.components) : ''
  return c || null
}

export function coordsText(lat: number, lng: number): string {
  return Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'coordinates unavailable'
}

export const ADDRESS_UNAVAILABLE = 'Address unavailable'

export function reportLocation(r: Pick<Report, 'address' | 'lat' | 'lng'>) {
  const text = addressText(r.address)
  return { address: text, primary: text ?? ADDRESS_UNAVAILABLE, coords: coordsText(r.lat, r.lng), source: text ? r.address!.source : null }
}

/** Incident-level address: the earliest grouped report that has one. */
export function incidentLocation(inc: Pick<Incident, 'reports'>) {
  const withAddr = inc.reports.find((r) => addressText(r.address))
  return reportLocation(withAddr ?? inc.reports[0])
}

// ---------------------------------------------------------------------------
// Nominatim parsing (defensive: any field may be missing)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v)

export function parseNominatimAddress(json: unknown): ReportAddress | null {
  if (!isObj(json) || json.error) return null
  const a = isObj(json.address) ? json.address : {}
  const house = str(a.house_number)
  const road = str(a.road) ?? str(a.pedestrian) ?? str(a.footway) ?? str(a.path)
  const poi = str(json.name) && json.name !== road ? str(json.name) : undefined
  const line = [house, road ?? poi].filter(Boolean).join(' ') || undefined
  const locality = str(a.neighbourhood) ?? str(a.suburb) ?? str(a.quarter) ?? str(a.residential) ?? str(a.hamlet) ?? str(a.village)
  const city = str(a.city) ?? str(a.town) ?? str(a.municipality) ?? str(a.state_district) ?? str(a.county)
  const state = str(a.state) ?? str(a.union_territory)
  const pinRaw = str(a.postcode)?.replace(/\s/g, '')
  const components = cleanComponents({ line, locality, city, state, pin: pinRaw && isValidPin(pinRaw) ? pinRaw : undefined })
  const formatted = cleanText(str(json.display_name), 300)
  if (!formatted && !hasAddress(components)) return null
  return { source: 'auto', formatted: formatted || formatComponents(components), components }
}

export type ReverseResult = { status: 'ok'; address: ReportAddress } | { status: 'none' }

const cache = new Map<string, ReverseResult>()
const CACHE_MAX = 50
const cacheKey = (lat: number, lng: number) => `${lat.toFixed(4)},${lng.toFixed(4)}` // ~11 m; memory only, never persisted

export function clearAddressCache() {
  cache.clear()
}

/**
 * Reverse geocode. Resolves {status:'none'} when the provider has no address for the point;
 * rejects on network errors / bad HTTP status / abort. Results are cached in memory only.
 */
export async function reverseGeocode(lat: number, lng: number, opts: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<ReverseResult> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('Invalid coordinates')
  const key = cacheKey(lat, lng)
  const hit = cache.get(key)
  if (hit) return hit
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1&accept-language=en`
  const res = await f(url, { signal: opts.signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Geocoder returned HTTP ${res.status}`)
  let json: unknown
  try {
    json = await res.json()
  } catch {
    throw new Error('Geocoder returned an unreadable response')
  }
  const address = parseNominatimAddress(json)
  const result: ReverseResult = address ? { status: 'ok', address } : { status: 'none' }
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string)
  cache.set(key, result)
  return result
}

export interface SearchHit {
  lat: number
  lng: number
  label: string
  address: ReportAddress | null
}

export function parseSearchResults(json: unknown): SearchHit[] {
  if (!Array.isArray(json)) return []
  const hits: SearchHit[] = []
  for (const item of json) {
    if (!isObj(item)) continue
    const lat = Number(item.lat)
    const lng = Number(item.lon)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) continue
    const address = parseNominatimAddress(item)
    const label = cleanText(str(item.display_name), 200) || (address ? addressText(address) : null)
    if (label) hits.push({ lat, lng, label, address })
  }
  return hits
}

export async function searchAddress(query: string, opts: { signal?: AbortSignal; fetchImpl?: FetchLike } = {}): Promise<SearchHit[]> {
  const q = cleanText(query, 150)
  if (q.length < 3) return []
  const f = opts.fetchImpl ?? (globalThis.fetch as unknown as FetchLike)
  const url = `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(q)}&countrycodes=in&limit=5&addressdetails=1&accept-language=en`
  const res = await f(url, { signal: opts.signal, headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Search returned HTTP ${res.status}`)
  return parseSearchResults(await res.json())
}

/** Stale-response guard: only the most recently issued token is "current". */
export function createLatest() {
  let n = 0
  return {
    next: () => ++n,
    isCurrent: (t: number) => t === n,
    invalidate: () => void ++n,
  }
}
