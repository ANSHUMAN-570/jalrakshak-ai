import { mkdirSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { Category } from './types'
import type { Officer, Zone } from './officers'
import { matchResponsible } from './routing'

/**
 * Generates supabase/tests/parity.json: scenarios plus the answers of the TypeScript routing engine.
 * supabase/tests/run_local.py loads the same data into PostgreSQL and requires match_responsible() to return identical results,
 * so the browser demo and the database cannot silently drift apart. (Fictional test data; none of it is BMC data.)
 */

const TODAY = '2026-10-17'
const NOW = Date.parse(`${TODAY}T10:00:00Z`)
const CATEGORIES: Category[] = ['burst_main', 'pipe_leak', 'meter_valve', 'supply_disruption', 'contamination', 'overflow', 'sewer', 'drainage', 'other']

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const box = (lat: number, lng: number, h = 0.05): [number, number][] => [[lat - h, lng - h], [lat - h, lng + h], [lat + h, lng + h], [lat + h, lng - h]]
const zone = (id: string, lat: number, lng = 77.0, boundary = true): Zone => ({ zone_id: id, name: `Test Zone ${id}`, boundary: boundary ? box(lat, lng) : undefined })
const ZONE_CENTER: Record<string, number> = { '01': 23.0, '03': 23.2, '04': 23.4, '05': 23.6, '06': 23.8, '09': 24.0, '10': 24.2 }

const officer = (n: number, over: Partial<Officer>): Officer => ({
  officer_id: uuid(n), full_name: `Test Officer ${n}`, designation: `Test Designation ${n}`, department: 'WATER_WORKS', assigned_zones: [], assigned_wards: [],
  official_phone: `0755-100${String(n).padStart(4, '0')}`, official_email: undefined, office_name: 'Test Office', office_address: 'Test address',
  source_url: 'https://example.org/test', source_type: 'manual_entry', verification_status: 'VERIFIED_OFFICIAL', verified_at: '2026-09-01', verified_by: 'Tester',
  last_checked_at: '2026-09-01', active_status: true, assignment_notes: '', ...over,
})

const OFFICERS: Officer[] = [
  officer(1, { assigned_zones: ['01'] }),                                                                                  // verified, water works
  officer(2, { department: 'SEWERAGE_AND_WATER_WORKS', assigned_zones: ['09'], verified_at: '2026-10-01' }),                // verified, combined post
  officer(3, { assigned_zones: ['03'], verification_status: 'UNVERIFIED', verified_at: null, verified_by: undefined }),     // unverified only
  officer(4, { assigned_zones: ['04'], verification_status: 'INACTIVE', active_status: false }),                            // inactive
  officer(5, { assigned_zones: ['05'], verified_at: '2026-01-01' }),                                                        // verification expired
  officer(6, { assigned_zones: ['06'] }),                                                                                   // two verified in zone 06 -> ambiguous
  officer(7, { assigned_zones: ['06'], full_name: 'Test Officer Seven' }),
  officer(8, { department: 'SEWERAGE', assigned_zones: ['10'] }),                                                           // verified sewerage officer
  officer(9, { assigned_zones: ['10'], verification_status: 'NEEDS_REVIEW', verified_at: null, verified_by: undefined }),   // needs review
]

function world(name: string, zones: Zone[], officers: Officer[], points: { label: string; lat: number; lng: number }[]) {
  const cases = points.flatMap((p) =>
    CATEGORIES.map((category) => {
      const m = matchResponsible({ category, lat: p.lat, lng: p.lng }, { officers, zones }, NOW)
      const { computedAt: _c, staffCandidates: _s, ...expected } = m
      void _c; void _s
      return { label: p.label, category, lat: p.lat, lng: p.lng, expected: JSON.parse(JSON.stringify(expected)) }
    }),
  )
  return { name, today: TODAY, zones, officers, cases }
}

const ZONES = Object.entries(ZONE_CENTER).map(([id, lat]) => zone(id, lat))
const centers = Object.entries(ZONE_CENTER).map(([id, lat]) => ({ label: `centre of zone ${id}`, lat, lng: 77.0 }))
const outside = { label: 'outside every zone', lat: 10, lng: 70 }

const worlds = [
  world('zones with boundaries', ZONES, OFFICERS, [...centers, outside]),
  world('overlapping zones', [...ZONES, zone('99', 23.0)], OFFICERS, [centers[0], centers[2]]),
  world('zones without boundaries', [zone('01', 23.0, 77.0, false), zone('09', 24.0, 77.0, false)], OFFICERS, [centers[0], outside]),
  world('no zones at all', [], OFFICERS, [centers[0]]),
  world('no officers at all', ZONES, [], [centers[0], centers[5]]),
]

describe('routing parity fixtures', () => {
  it('writes supabase/tests/parity.json with sane expectations', () => {
    mkdirSync('supabase/tests', { recursive: true })
    writeFileSync('supabase/tests/parity.json', JSON.stringify({ generatedBy: 'src/lib/parity.test.ts', worlds }, null, 2) + '\n')
    const all = worlds.flatMap((w) => w.cases)
    expect(all.length).toBeGreaterThan(80)
    const kinds = new Set(all.map((c) => c.expected.kind))
    expect([...kinds].sort()).toEqual(['department', 'helpline', 'officer'])
    // sanity on the interesting cases so a broken engine cannot silently produce "matching" fixtures
    const w1 = worlds[0].cases
    const pick = (label: string, category: Category) => w1.find((c) => c.label === label && c.category === category)!.expected
    expect(pick('centre of zone 01', 'pipe_leak').officer.full_name).toBe('Test Officer 1')
    expect(pick('centre of zone 09', 'sewer').officer.full_name).toBe('Test Officer 2')       // combined post answers sewer
    expect(pick('centre of zone 03', 'pipe_leak').officer).toBeNull()                          // unverified
    expect(pick('centre of zone 04', 'pipe_leak').officer).toBeNull()                          // inactive
    expect(pick('centre of zone 05', 'pipe_leak').officer).toBeNull()                          // expired
    expect(pick('centre of zone 06', 'pipe_leak').officer).toBeNull()                          // ambiguous
    expect(pick('centre of zone 10', 'sewer').officer.full_name).toBe('Test Officer 8')
    expect(pick('centre of zone 10', 'pipe_leak').officer).toBeNull()                          // sewerage officer is not water works
    expect(pick('centre of zone 01', 'other').kind).toBe('helpline')
  })
})
