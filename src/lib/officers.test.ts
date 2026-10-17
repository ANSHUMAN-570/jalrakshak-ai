import { describe, expect, it } from 'vitest'
import {
  BMC_CONTACTS, createDirectoryStore, findDuplicateGroups, isCurrentlyVerified, normalizeName, parseCsv, parseOfficerCsv,
  seedOfficers, verificationIssues, type Actor, type OfficerDraft,
} from './officers'
import { departmentFor, matchResponsible, pointInRing, resolveZone } from './routing'
import { TINY_JPEG } from './fixtures'
import { createStore } from './store'

const NOW = Date.parse('2026-10-17T10:00:00Z')
const admin: Actor = { name: 'Admin Asha', role: 'administrator' }
const operator: Actor = { name: 'Op Ravi', role: 'operator' }
const citizen: Actor = { name: 'anon', role: 'citizen' }

// TEST FIXTURE ONLY: fictional square zones around the demo coordinates. Not BMC data.
const zoneA = { zone_id: '01', name: 'Test Zone 01', boundary: [[28.60, 77.19], [28.60, 77.23], [28.64, 77.23], [28.64, 77.19]] as [number, number][] }
const zoneB = { zone_id: '09', name: 'Test Zone 09', boundary: [[28.70, 77.19], [28.70, 77.23], [28.74, 77.23], [28.74, 77.19]] as [number, number][] }
const IN_A = { lat: 28.61, lng: 77.2 }
const IN_B = { lat: 28.71, lng: 77.2 }

const draft = (over: Partial<OfficerDraft> = {}): Partial<OfficerDraft> => ({
  full_name: 'Test Engineer One', designation: 'Executive Engineer, Water Works (test)', department: 'WATER_WORKS', assigned_zones: ['01'],
  official_phone: '0755-1234567', office_name: 'Test Office', office_address: 'Test address', source_url: 'https://example.org/source', source_type: 'manual_entry',
  last_checked_at: '2026-10-01', assignment_notes: 'test fixture', ...over,
})

function fixtureDir(clock = () => NOW) {
  const d = createDirectoryStore(undefined, clock)
  d.saveZone(zoneA, admin)
  d.saveZone(zoneB, admin)
  return d
}
function addVerified(d: ReturnType<typeof createDirectoryStore>, over: Partial<OfficerDraft> = {}) {
  const r = d.add(draft(over), admin)
  if (!r.ok) throw new Error(r.error)
  const v = d.verify(r.id, { source_url: 'https://example.org/confirmation', notes: 'Confirmed by phone with the department office' }, admin)
  if (!v.ok) throw new Error(v.error)
  return r.id
}
const match = (d: ReturnType<typeof createDirectoryStore>, category: Parameters<typeof matchResponsible>[0]['category'], at = IN_A, now = NOW) =>
  matchResponsible({ category, ...at }, { officers: d.officers(), zones: d.zones() }, now)

describe('seed data', () => {
  it('has the four published water-related records, all UNVERIFIED, with sources and no verification date', () => {
    const o = seedOfficers()
    expect(o.map((x) => x.full_name)).toEqual(['Shri Tanmay Vashisht Sharma', 'Shri Udit Garg', 'Shri J.A. Khan', 'Shri H.C. Ladia'])
    for (const x of o) {
      expect(x.verification_status).toBe('UNVERIFIED')
      expect(x.verified_at).toBeNull()
      expect(x.source_type).toBe('third_party_directory')
      expect(x.source_url).toContain('indiacustomercare.com')
      expect(x.assignment_notes).toMatch(/Not confirmed by BMC/)
    }
    expect(o.find((x) => x.full_name.includes('Khan'))!.assigned_zones).toHaveLength(10)
  })
  it('official office contact comes from the official directory; helplines are flagged for review', () => {
    expect(BMC_CONTACTS.office.source_url).toContain('bhopal.nic.in')
    expect(BMC_CONTACTS.office.phone).toBe('+91-755-2701222')
    expect(BMC_CONTACTS.office.email).toBe('commoffice@bmconline.gov.in')
    expect(BMC_CONTACTS.helpline.phone).toBe('155304')
    expect(BMC_CONTACTS.support.phone).toBe('1800-233-0014')
    expect(BMC_CONTACTS.helpline.verification).toBe('NEEDS_REVIEW')
  })
})

describe('department routing', () => {
  it('sewer and drainage are not treated as Water Works', () => {
    expect(departmentFor('pipe_leak')).toBe('WATER_WORKS')
    expect(departmentFor('supply_disruption')).toBe('WATER_WORKS')
    expect(departmentFor('contamination')).toBe('WATER_WORKS')
    expect(departmentFor('sewer')).toBe('SEWERAGE')
    expect(departmentFor('drainage')).toBe('DRAINAGE')
    expect(departmentFor('other')).toBe('GENERAL')
  })
  it('point-in-polygon and zone resolution', () => {
    expect(pointInRing(IN_A.lat, IN_A.lng, zoneA.boundary)).toBe(true)
    expect(pointInRing(IN_B.lat, IN_B.lng, zoneA.boundary)).toBe(false)
    expect(resolveZone(IN_A.lat, IN_A.lng, [zoneA, zoneB])).toMatchObject({ status: 'resolved', zone: { zone_id: '01' } })
    expect(resolveZone(50, 50, [zoneA, zoneB]).status).toBe('none')
    expect(resolveZone(IN_A.lat, IN_A.lng, [{ zone_id: 'x', name: 'x' }]).status).toBe('no_boundary_data')
    expect(resolveZone(IN_A.lat, IN_A.lng, [zoneA, { ...zoneA, zone_id: '02' }]).status).toBe('ambiguous')
  })
})

describe('responsible-officer matching (test scenarios 1-5)', () => {
  it('1. names a verified officer when the zone is resolved and exactly one verified officer covers it', () => {
    const d = fixtureDir()
    addVerified(d)
    const m = match(d, 'pipe_leak')
    expect(m.kind).toBe('officer')
    expect(m.officer?.full_name).toBe('Test Engineer One')
    expect(m.zone).toEqual({ id: '01', name: 'Test Zone 01' })
    expect(m.verification).toBe('VERIFIED_OFFICIAL')
    expect(m.sourceUrl).toBe('https://example.org/confirmation')
    expect(m.lastVerifiedAt).toBe('2026-10-17')
    expect(m.message).toBe('Potential responsible contact: Test Engineer One. Designation: Executive Engineer, Water Works (test). Assigned area: Test Zone 01 (zone 01). Please confirm assignment with the municipal department.')
    expect(m.explanation).toMatch(/only active, currently verified/)
    expect(m.escalation.helpline).toBe('155304')
  })

  it('2. with only the UNVERIFIED seed records it names nobody, even where a seed lists that zone', () => {
    const d = fixtureDir()
    // seed J.A. Khan lists zone 01, and zone 01 boundaries are loaded, but he is unverified
    const m = match(d, 'pipe_leak')
    expect(m.kind).toBe('department')
    expect(m.officer).toBeNull()
    expect(m.verification).toBeNull()
    expect(m.explanation).toMatch(/not currently verified/)
    expect(m.staffCandidates.map((c) => c.full_name)).toContain('Shri J.A. Khan')
    expect(m.message).toContain('could not verify the currently responsible zone-level officer')
  })

  it('3/4. when no zone data exists (the shipped state) it names a department and gives the BMC helplines', () => {
    const d = createDirectoryStore(undefined, () => NOW) // no zones
    const m = match(d, 'pipe_leak')
    expect(m.kind).toBe('department')
    expect(m.officer).toBeNull()
    expect(m.message).toBe('Your complaint appears to concern BMC Water Works. We could not verify the currently responsible zone-level officer. Please contact BMC at 155304 or 1800-233-0014.')
    expect(m.explanation).toMatch(/No verified zone boundaries are loaded/)
    expect(m.escalation).toMatchObject({ helpline: '155304', support: '1800-233-0014', officePhone: '+91-755-2701222', officeEmail: 'commoffice@bmconline.gov.in' })
  })

  it('4. an unclassifiable complaint gets the helpline fallback and no department claim', () => {
    const m = match(fixtureDir(), 'other')
    expect(m.kind).toBe('helpline')
    expect(m.message).toContain('155304')
    expect(m.message).toContain('could not determine which BMC department')
  })

  it('5. unverified officers\' phone numbers and details never appear in the citizen-facing result', () => {
    const d = fixtureDir()
    const m = match(d, 'pipe_leak')
    const json = JSON.stringify({ ...m, staffCandidates: undefined })
    for (const o of seedOfficers()) {
      expect(json).not.toContain(o.official_phone!)
      expect(json).not.toContain(o.full_name)
    }
    // staff candidates carry names but never phone numbers
    for (const c of m.staffCandidates) expect(Object.keys(c)).not.toContain('official_phone')
  })

  it('does not hand a sewer complaint to a Water-Works-only officer', () => {
    const d = fixtureDir()
    addVerified(d)
    const m = match(d, 'sewer')
    expect(m.department).toBe('SEWERAGE')
    expect(m.officer).toBeNull()
    expect(m.explanation).toMatch(/no officer assignment is recorded/)
  })

  it('the combined "Sewage & Water Works" post can answer both water and sewer complaints', () => {
    const d = fixtureDir()
    addVerified(d, { full_name: 'Test Superintending Eng', department: 'SEWERAGE_AND_WATER_WORKS', assigned_zones: ['01'], official_phone: '0755-7654321' })
    expect(match(d, 'pipe_leak').officer?.full_name).toBe('Test Superintending Eng')
    expect(match(d, 'sewer').officer?.full_name).toBe('Test Superintending Eng')
    expect(match(d, 'drainage').officer).toBeNull()
  })

  it('a different zone gets a different officer; a zone with no assignment gets a department fallback', () => {
    const d = fixtureDir()
    addVerified(d, { full_name: 'Zone Nine Engineer', assigned_zones: ['09'], official_phone: '0755-1111111' })
    expect(match(d, 'pipe_leak', IN_B).officer?.full_name).toBe('Zone Nine Engineer')
    const none = match(d, 'pipe_leak', IN_A)
    expect(none.officer).toBeNull()
    expect(none.zone?.id).toBe('01')
  })

  it('expired verification, inactive records and ambiguity never produce a named officer', () => {
    const d = fixtureDir()
    const id = addVerified(d)
    expect(match(d, 'pipe_leak').kind).toBe('officer')
    expect(match(d, 'pipe_leak', IN_A, NOW + 181 * 86_400_000).officer).toBeNull() // expired
    expect(match(d, 'pipe_leak', IN_A, NOW + 181 * 86_400_000).staffCandidates.some((c) => c.note.includes('days old'))).toBe(true)
    addVerified(d, { full_name: 'Second Engineer', official_phone: '0755-2222222' })
    const amb = match(d, 'pipe_leak')
    expect(amb.officer).toBeNull()
    expect(amb.explanation).toMatch(/2 verified officers cover it/)
    d.deactivate(id, admin)
    expect(match(d, 'pipe_leak').officer?.full_name).toBe('Second Engineer') // only the active one remains
  })

  it('a location outside every zone, or inside two, is not guessed', () => {
    const d = fixtureDir()
    addVerified(d)
    expect(match(d, 'pipe_leak', { lat: 12, lng: 77 }).explanation).toMatch(/outside every configured zone/)
    d.saveZone({ ...zoneA, zone_id: '02', name: 'Overlap' }, admin)
    expect(match(d, 'pipe_leak').explanation).toMatch(/more than one configured zone/)
  })
})

describe('report submission stores the routing snapshot', () => {
  it('each new report records department, kind and escalation; unverified data never names an officer', () => {
    const d = fixtureDir()
    const s = createStore(undefined, () => NOW, d)
    const r = s.submitReport({ lat: IN_A.lat, lng: IN_A.lng, locationSource: 'map_pin', description: 'Pipe leak near the main road crossing', lang: 'en', category: 'pipe_leak', urgencyHints: [], severity: 60, reporterId: 'u1', photo: TINY_JPEG })
    expect(r.match?.department).toBe('WATER_WORKS')
    expect(r.match?.kind).toBe('department')
    expect(r.match?.officer).toBeNull()
    expect(s.track(r.caseId)!.report.match?.escalation.helpline).toBe('155304')
    addVerified(d)
    const r2 = s.submitReport({ lat: IN_A.lat, lng: IN_A.lng, locationSource: 'map_pin', description: 'Another pipe leak near the main road', lang: 'en', category: 'pipe_leak', urgencyHints: [], severity: 60, reporterId: 'u2', photo: TINY_JPEG })
    expect(r2.match?.kind).toBe('officer')
    expect(r2.match?.officer?.full_name).toBe('Test Engineer One')
    expect(r.match?.kind).toBe('department') // earlier report keeps its original snapshot
  })
})

describe('directory administration (test scenario 9 at the store level)', () => {
  it('only administrators may add, edit, verify, deactivate, import or change zones', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    const id = d.officers()[0].officer_id
    for (const who of [operator, citizen, { name: '', role: 'administrator' as const }]) {
      expect(d.add(draft(), who).ok).toBe(false)
      expect(d.update(id, { designation: 'x' }, who).ok).toBe(false)
      expect(d.verify(id, { source_url: 'https://x.org', notes: 'long enough note' }, who).ok).toBe(false)
      expect(d.deactivate(id, who).ok).toBe(false)
      expect(d.importCsv('a,b\n1,2', who).ok).toBe(false)
      expect(d.saveZone(zoneA, who).ok).toBe(false)
    }
    expect(d.officers()[0].verification_status).toBe('UNVERIFIED')
    expect(d.audit()).toHaveLength(0) // denied attempts change nothing
  })

  it('new records start UNVERIFIED and validation rejects bad input', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    const r = d.add(draft(), admin)
    expect(r.ok).toBe(true)
    if (r.ok) expect(d.get(r.id)).toMatchObject({ verification_status: 'UNVERIFIED', verified_at: null, active_status: true })
    for (const bad of [{ official_phone: 'call me' }, { official_email: 'nope' }, { source_url: 'javascript:alert(1)' }, { department: 'MAGIC' as never }, { full_name: '' }, { last_checked_at: 'yesterday' }, { source_type: 'rumour' as never }]) {
      expect(d.add(draft({ full_name: 'Someone Else ' + Math.random(), official_phone: '0755-5550000', ...bad }), admin).ok, JSON.stringify(bad)).toBe(false)
    }
  })

  it('verification is only reachable through verify(), needs a source and a note, and is dated', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    const id = d.officers()[2].officer_id
    expect(d.update(id, { verification_status: 'VERIFIED_OFFICIAL' } as never, admin).ok).toBe(false)
    expect(d.verify(id, { source_url: 'not a url', notes: 'confirmed with zone office' }, admin).ok).toBe(false)
    expect(d.verify(id, { source_url: 'https://bmc.example/zone-list', notes: 'short' }, admin).ok).toBe(false)
    expect(d.verify(id, { source_url: 'https://bmc.example/zone-list', notes: 'Confirmed zone list with BMC water works office' }, admin).ok).toBe(true)
    expect(d.get(id)).toMatchObject({ verification_status: 'VERIFIED_OFFICIAL', verified_at: '2026-10-17', verified_by: 'Admin Asha', source_url: 'https://bmc.example/zone-list' })
    expect(isCurrentlyVerified(d.get(id)!, NOW)).toBe(true)
  })

  it('editing a verified record resets it to NEEDS_REVIEW (never silently stays verified)', () => {
    const d = fixtureDir()
    const id = addVerified(d)
    const r = d.update(id, { assigned_zones: ['01', '09'] }, admin)
    expect(r).toMatchObject({ ok: true, demotedToReview: true })
    expect(d.get(id)!.verification_status).toBe('NEEDS_REVIEW')
    expect(match(d, 'pipe_leak').officer).toBeNull()
    // notes-only edit keeps the status
    const id2 = addVerified(d, { full_name: 'Another Verified Eng', official_phone: '0755-3333333', assigned_zones: ['09'] })
    expect(d.update(id2, { assignment_notes: 'updated note' }, admin)).toMatchObject({ ok: true, demotedToReview: false })
    expect(d.get(id2)!.verification_status).toBe('VERIFIED_OFFICIAL')
  })

  it('deactivate and reactivate: reactivated records need review, inactive cannot be verified', () => {
    const d = fixtureDir()
    const id = addVerified(d)
    d.deactivate(id, admin)
    expect(d.get(id)).toMatchObject({ active_status: false, verification_status: 'INACTIVE' })
    expect(d.verify(id, { source_url: 'https://x.org', notes: 'trying to verify inactive' }, admin).ok).toBe(false)
    d.reactivate(id, admin)
    expect(d.get(id)).toMatchObject({ active_status: true, verification_status: 'NEEDS_REVIEW' })
  })

  it('rejects duplicate officers and finds duplicate groups', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    expect(d.add(draft({ full_name: 'J A Khan', official_phone: '9826273768' }), admin).ok).toBe(false) // same phone as seed
    expect(d.add(draft({ full_name: 'Shri Udit Garg', official_phone: '0755-9999999' }), admin).ok).toBe(false) // same name
    expect(normalizeName('Shri J.A. Khan (IAS)')).toBe(normalizeName('j a khan'))
    const o = seedOfficers()
    expect(findDuplicateGroups(o)).toHaveLength(0)
    expect(findDuplicateGroups([...o, { ...o[1], officer_id: 'dup' }])).toHaveLength(1)
  })

  it('flags missing and expired verification', () => {
    const d = fixtureDir()
    const id = addVerified(d)
    expect(verificationIssues(d.officers()[0], NOW)).toContain('never_verified')
    expect(verificationIssues(d.get(id)!, NOW)).toEqual([])
    expect(verificationIssues(d.get(id)!, NOW + 200 * 86_400_000)).toContain('verification_expired')
    expect(verificationIssues(d.officers()[0], NOW)).toContain('no_zone_assignment')
  })

  it('writes an audit entry (actor, role, action, target) for every privileged change', () => {
    const d = fixtureDir()
    const id = addVerified(d)
    d.update(id, { designation: 'Executive Engineer (test, updated)' }, admin)
    d.deactivate(id, admin)
    const actions = d.audit().map((a) => a.action)
    expect(actions).toEqual(expect.arrayContaining(['zone.add', 'officer.add', 'officer.verify', 'officer.update', 'officer.deactivate']))
    for (const a of d.audit()) expect(a).toMatchObject({ actor: 'Admin Asha', role: 'administrator' })
  })

  it('zones validate their boundary', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    expect(d.saveZone({ zone_id: '1', name: 'bad', boundary: [[1, 2], [3, 4]] }, admin).ok).toBe(false)
    expect(d.saveZone({ zone_id: '1', name: 'bad', boundary: [[1, 2], [3, 4], [200, 5]] }, admin).ok).toBe(false)
    expect(d.saveZone({ zone_id: '', name: 'x' }, admin).ok).toBe(false)
    expect(d.saveZone({ zone_id: '1', name: 'ok', boundary: zoneA.boundary }, admin).ok).toBe(true)
    expect(d.deleteZone('1', admin).ok).toBe(true)
  })
})

describe('CSV import', () => {
  const header = 'full_name,designation,department,assigned_zones,official_phone,office_name,source_url,source_type,last_checked_at'
  it('parses quoted fields, embedded commas and newlines', () => {
    expect(parseCsv('a,"b, c","d ""e""\nf"\n1,2,3')).toEqual([['a', 'b, c', 'd "e"\nf'], ['1', '2', '3']])
  })
  it('imports valid rows as UNVERIFIED, ignores any verification columns, skips duplicates, reports row errors', () => {
    const d = createDirectoryStore(undefined, () => NOW)
    const csv = [
      header + ',verification_status,verified_at',
      'Test Person A,"Assistant Engineer, Water Works",WATER_WORKS,07;08,0755-4000001,Zone Office,https://example.org/list,official_directory,2026-10-10,VERIFIED_OFFICIAL,2026-10-10',
      'Bad Row,Eng,NOT_A_DEPT,01,0755-4000002,Office,https://example.org/list,manual_entry,2026-10-10,,',
      'Shri Udit Garg,Dup,SEWERAGE,01,0755-4000003,Office,https://example.org/list,manual_entry,2026-10-10,,',
      'Test Person B,Eng,SEWERAGE,,0755-4000004,Office,ftp://bad,manual_entry,2026-10-10,,',
    ].join('\n')
    const r = d.importCsv(csv, admin)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.added).toBe(1)
    expect(r.skippedDuplicates.map((x) => x.name)).toEqual(['Shri Udit Garg'])
    expect(r.errors.map((e) => e.line).sort()).toEqual([3, 5])
    expect(r.warnings[0]).toMatch(/always UNVERIFIED/)
    const added = d.officers().find((o) => o.full_name === 'Test Person A')!
    expect(added).toMatchObject({ verification_status: 'UNVERIFIED', verified_at: null, assigned_zones: ['07', '08'], source_type: 'official_directory' })
    expect(d.audit()[0].action).toBe('officer.import')
  })
  it('rejects missing columns, empty and oversized files', () => {
    expect(parseOfficerCsv('full_name,designation\nx,y').errors[0].message).toMatch(/Missing required column/)
    expect(parseOfficerCsv('').errors[0].message).toMatch(/empty/)
    expect(parseOfficerCsv('x'.repeat(200_001)).errors[0].message).toMatch(/larger than/)
  })
})
