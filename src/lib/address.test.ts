import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addressText, ADDRESS_UNAVAILABLE, clearAddressCache, cleanText, createLatest, formatComponents, incidentLocation,
  isValidPin, parseNominatimAddress, parseSearchResults, reportLocation, reverseGeocode, searchAddress,
} from './address'
import { createStore, sanitizeAddress } from './store'

// Real response shape captured from nominatim.openstreetmap.org for 28.6139, 77.209
const REAL = {
  name: 'Kartavya Path', display_name: 'Kartavya Path, Raisina Hill, New Delhi, Delhi, 110004, India',
  address: { road: 'Kartavya Path', suburb: 'Raisina Hill', city: 'New Delhi', state_district: 'New Delhi', state: 'Delhi', postcode: '110004', country: 'India' },
}
const okFetch = (body: unknown, status = 200) => vi.fn(async () => ({ ok: status < 400, status, json: async () => body }))

beforeEach(() => clearAddressCache())

describe('parseNominatimAddress', () => {
  it('parses a full real response', () => {
    const a = parseNominatimAddress(REAL)!
    expect(a.source).toBe('auto')
    expect(a.components).toEqual({ line: 'Kartavya Path', locality: 'Raisina Hill', city: 'New Delhi', state: 'Delhi', pin: '110004' })
    expect(a.formatted).toContain('Kartavya Path')
  })
  it('handles partial data (no street / house number)', () => {
    const a = parseNominatimAddress({ display_name: 'Raisina Hill, New Delhi, India', address: { suburb: 'Raisina Hill', city: 'New Delhi' } })!
    expect(a.components.line).toBeUndefined()
    expect(addressText(a)).toBe('Raisina Hill, New Delhi, India')
  })
  it('returns null for "Unable to geocode", junk and empty objects', () => {
    expect(parseNominatimAddress({ error: 'Unable to geocode' })).toBeNull()
    expect(parseNominatimAddress(null)).toBeNull()
    expect(parseNominatimAddress('x')).toBeNull()
    expect(parseNominatimAddress({})).toBeNull()
    expect(parseNominatimAddress({ address: {} })).toBeNull()
  })
  it('drops an invalid postcode instead of saving it', () => {
    expect(parseNominatimAddress({ display_name: 'X', address: { city: 'Y', postcode: '12' } })!.components.pin).toBeUndefined()
  })
})

describe('formatting and fallbacks never print undefined/null/empty', () => {
  it('formats partial manual input', () => {
    expect(formatComponents({ locality: 'Sector 5', city: 'Noida' })).toBe('Sector 5, Noida')
    expect(formatComponents({ line: ' 12  Main St ', city: 'Pune', state: 'Maharashtra', pin: '411001' })).toBe('12 Main St, Pune, Maharashtra 411001')
    expect(formatComponents({})).toBe('')
  })
  it('addressText copes with malformed stored data', () => {
    expect(addressText(undefined)).toBeNull()
    expect(addressText(null)).toBeNull()
    expect(addressText({ source: 'manual', components: {} })).toBeNull()
    expect(addressText({ source: 'manual', formatted: '   ', components: { city: 'Pune' } })).toBe('Pune')
    expect(addressText({ source: 'auto' } as never)).toBeNull()
  })
  it('old reports without an address show the fallback plus coordinates', () => {
    const loc = reportLocation({ lat: 28.6, lng: 77.2 })
    expect(loc.primary).toBe(ADDRESS_UNAVAILABLE)
    expect(loc.coords).toBe('28.60000, 77.20000')
    // `address`/`source` are data fields (null when absent); only `primary` and `coords` are ever displayed.
    for (const v of [loc.primary, loc.coords]) expect(v).not.toMatch(/undefined|null|^$/)
  })
  it('cleanText strips control characters and caps length', () => {
    expect(cleanText('a\u0000b\n\tc', 10)).toBe('a b c')
    expect(cleanText('x'.repeat(500), 20)).toHaveLength(20)
  })
  it('PIN validation', () => {
    expect(isValidPin('')).toBe(true)
    expect(isValidPin('110004')).toBe(true)
    expect(isValidPin('010004')).toBe(false)
    expect(isValidPin('1100')).toBe(false)
    expect(isValidPin('11000a')).toBe(false)
  })
})

describe('reverseGeocode', () => {
  it('returns ok and caches repeat lookups for the same point', async () => {
    const f = okFetch(REAL)
    const r1 = await reverseGeocode(28.6139, 77.209, { fetchImpl: f })
    const r2 = await reverseGeocode(28.61391, 77.20901, { fetchImpl: f }) // within ~1 m -> same cache key
    expect(r1.status).toBe('ok')
    expect(r2).toBe(r1)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('returns none when the provider has no address', async () => {
    expect((await reverseGeocode(10, 70, { fetchImpl: okFetch({ error: 'Unable to geocode' }) })).status).toBe('none')
  })
  it('rejects on HTTP errors and unreadable bodies and does not cache them', async () => {
    await expect(reverseGeocode(1, 1, { fetchImpl: okFetch({}, 503) })).rejects.toThrow(/503/)
    const bad = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json') } }))
    await expect(reverseGeocode(2, 2, { fetchImpl: bad })).rejects.toThrow(/unreadable/)
    const good = okFetch(REAL)
    expect((await reverseGeocode(1, 1, { fetchImpl: good })).status).toBe('ok')
  })
  it('rejects invalid coordinates without calling the network', async () => {
    const f = okFetch(REAL)
    await expect(reverseGeocode(NaN, 1, { fetchImpl: f })).rejects.toThrow()
    await expect(reverseGeocode(95, 1, { fetchImpl: f })).rejects.toThrow()
    expect(f).not.toHaveBeenCalled()
  })
})

describe('search', () => {
  it('parses results and skips invalid ones', () => {
    const hits = parseSearchResults([
      { lat: '28.63', lon: '77.21', display_name: 'Connaught Place, New Delhi, India', address: { suburb: 'Connaught Place', city: 'New Delhi' } },
      { lat: 'abc', lon: '77', display_name: 'broken' },
      { lat: '95', lon: '0', display_name: 'out of range' },
      null,
    ])
    expect(hits).toHaveLength(1)
    expect(hits[0].lat).toBeCloseTo(28.63)
    expect(parseSearchResults({ error: 'x' })).toEqual([])
  })
  it('does not call the network for very short queries', async () => {
    const f = okFetch([])
    expect(await searchAddress('ab', { fetchImpl: f })).toEqual([])
    expect(f).not.toHaveBeenCalled()
  })
  it('surfaces HTTP failures', async () => {
    await expect(searchAddress('connaught place', { fetchImpl: okFetch([], 429) })).rejects.toThrow(/429/)
  })
})

describe('createLatest (stale response guard)', () => {
  it('only the newest token is current', () => {
    const l = createLatest()
    const a = l.next()
    const b = l.next()
    expect(l.isCurrent(a)).toBe(false)
    expect(l.isCurrent(b)).toBe(true)
    l.invalidate()
    expect(l.isCurrent(b)).toBe(false)
  })
})

describe('persistence', () => {
  const base = { lat: 28.7, lng: 77.3, locationSource: 'map_pin' as const, description: 'Leak near the gate, water everywhere', lang: 'en' as const, category: 'pipe_leak' as const, urgencyHints: [], severity: 60, reporterId: 'u1' }

  it('saves lat/lng, source, formatted address and components and returns them via track()', () => {
    const s = createStore(undefined, () => 1_800_000_000_000)
    const r = s.submitReport({ ...base, address: { source: 'manual', components: { line: 'Gate 2', city: 'Noida', pin: '201301' } } })
    const t = s.track(r.caseId)!
    expect(t.report.lat).toBe(28.7)
    expect(t.report.address).toEqual({ source: 'manual', formatted: 'Gate 2, Noida 201301', components: { line: 'Gate 2', city: 'Noida', pin: '201301' } })
    expect(reportLocation(t.report).primary).toBe('Gate 2, Noida 201301')
  })
  it('survives a JSON round trip (localStorage) and legacy reports still load', () => {
    const mem = new Map<string, string>()
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) }
    const s1 = createStore(storage, () => 1_800_000_000_000)
    s1.submitReport({ ...base, address: { source: 'auto', formatted: 'Somewhere, India', components: { city: 'Somewhere' } } })
    const s2 = createStore(storage, () => 1_800_000_000_000)
    expect(s2.allReports().some((r) => r.address?.formatted === 'Somewhere, India')).toBe(true)
    // seed contains legacy-style reports with no address at all
    const legacy = s2.allReports().find((r) => r.id === 'demo-d1')!
    expect(legacy.address).toBeUndefined()
    expect(reportLocation(legacy).primary).toBe(ADDRESS_UNAVAILABLE)
  })
  it('re-validates addresses on save (bad PIN dropped, junk rejected, manual formatted server-side)', () => {
    expect(sanitizeAddress({ source: 'manual', components: { city: 'Pune', pin: '12' } })).toEqual({ source: 'manual', formatted: 'Pune', components: { city: 'Pune' } })
    expect(sanitizeAddress({ source: 'manual', components: { city: '   ' } })).toBeUndefined()
    expect(sanitizeAddress({ source: 'bogus', components: { city: 'x' } } as never)).toBeUndefined()
    expect(sanitizeAddress(undefined)).toBeUndefined()
  })
  it('incident location prefers a grouped report that has an address', () => {
    const s = createStore(undefined, () => 1_800_000_000_000)
    const inc = s.find('demo-a1')!
    expect(inc.reports).toHaveLength(2)
    expect(incidentLocation(inc).address).toContain('Kartavya Path') // a1 has one, a2 does not
    expect(reportLocation(inc.reports[1]).primary).toBe(ADDRESS_UNAVAILABLE)
  })
})
