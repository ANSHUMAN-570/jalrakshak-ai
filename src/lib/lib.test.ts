import { describe, expect, it } from 'vitest'
import { computeMetrics } from './analytics'
import { analyzeText } from './classify'
import { clusterReports, evaluateDuplicates } from './duplicates'
import { haversine } from './geo'
import { computePriority, confirmationScore } from './priority'
import { checklist, verification } from './rules'
import { placeholderPhoto, seedCases, seedReports } from './seed'
import type { Actor } from './officers'
import { TINY_JPEG } from './fixtures'
import { createStore } from './store'

const ADMIN: Actor = { name: 'Admin', role: 'administrator' }

const NOW = 1_800_000_000_000
const H = 3_600_000

const input = (over: Partial<Parameters<ReturnType<typeof createStore>['submitReport']>[0]> = {}) => ({
  lat: 28.62, lng: 77.22, locationSource: 'map_pin' as const, description: 'Pipe leak near the park gate, water everywhere',
  lang: 'en' as const, category: 'pipe_leak' as const, urgencyHints: [], severity: 60, reporterId: 'u-new', photo: TINY_JPEG, ...over,
})

describe('geo', () => {
  it('haversine ~111 km per degree of latitude', () => {
    expect(haversine(0, 0, 1, 0)).toBeGreaterThan(110_000)
    expect(haversine(0, 0, 1, 0)).toBeLessThan(112_000)
  })
})

describe('classify (EN + HI)', () => {
  it('detects a Hindi burst pipe with urgency hints', () => {
    const a = analyzeText('सड़क पर पाइप फट गया है, बहुत पानी बह रहा है')
    expect(a.category).toBe('burst_main')
    expect(a.urgencyHints).toContain('road affected')
    expect(a.severity).toBeGreaterThan(85)
  })
  it('detects an English leak and a landmark', () => {
    const a = analyzeText('Small leak near City Hospital, dripping for days')
    expect(a.category).toBe('pipe_leak')
    expect(a.landmark).toBe('City Hospital')
  })
  it('falls back to other', () => {
    expect(analyzeText('hello there').category).toBe('other')
  })
})

describe('duplicate detection on the labelled demo set', () => {
  const reports = seedReports(NOW)
  it('groups the two nearby burst-pipe reports and keeps the hard negative apart', () => {
    const groups = clusterReports(reports).map((g) => g.map((r) => r.id).sort())
    expect(groups).toContainEqual(['demo-a1', 'demo-a2'])
    expect(groups.find((g) => g.includes('demo-n1'))).toEqual(['demo-n1'])
  })
  it('has precision and recall of 1 on the seeded sample', () => {
    const e = evaluateDuplicates(reports)
    expect(e.precision).toBe(1)
    expect(e.recall).toBe(1)
    expect(e.truePairs).toBe(1)
  })
})

describe('priority engine', () => {
  const incidents = (store = createStore(undefined, () => NOW)) => store.incidents()
  it('score is the documented weighted sum and explains every factor', () => {
    const inc = incidents().find((i) => i.id === 'demo-a1')!
    const p = computePriority(inc, NOW)
    const sum = p.factors.reduce((s, f) => s + f.weight * f.value, 0)
    expect(Math.abs(p.score - Math.round(sum))).toBeLessThanOrEqual(1)
    expect(p.factors.map((f) => f.key)).toEqual(['S', 'E', 'R', 'C'])
    p.factors.forEach((f) => expect(f.reason.length).toBeGreaterThan(0))
  })
  it('ranks the multi-reporter burst pipe above the lone drip', () => {
    const list = incidents()
    const a = computePriority(list.find((i) => i.id === 'demo-a1')!, NOW).score
    const b = computePriority(list.find((i) => i.id === 'demo-b1')!, NOW).score
    expect(a).toBeGreaterThan(b)
  })
  it('does not let duplicates from the same reporter inflate confirmation', () => {
    const store = createStore(undefined, () => NOW)
    store.submitReport(input({ reporterId: 'same' }))
    const first = store.incidents().find((i) => i.reports.some((r) => r.reporterId === 'same'))!
    const before = computePriority(first, NOW).factors.find((f) => f.key === 'C')!.value
    store.submitReport(input({ reporterId: 'same' }))
    const after = store.incidents().find((i) => i.reports.some((r) => r.reporterId === 'same'))!
    expect(after.reports.length).toBe(2)
    expect(computePriority(after, NOW).factors.find((f) => f.key === 'C')!.value).toBe(before)
  })
  it('severity is max over reports, not a sum', () => {
    const inc = incidents().find((i) => i.id === 'demo-a1')!
    expect(computePriority(inc, NOW).factors[0].value).toBe(100)
  })
  it('confirmation score is bounded', () => {
    expect(confirmationScore(0)).toBe(0)
    expect(confirmationScore(50)).toBe(100)
  })
})

describe('store + closure rules', () => {
  const fresh = () => createStore(undefined, () => NOW)

  it('links a new nearby report into the existing incident', () => {
    const s = fresh()
    const before = s.incidents().length
    const base = s.allReports().find((r) => r.id === 'demo-b1')!
    s.submitReport(input({ lat: base.lat + 0.0001, lng: base.lng, reporterId: 'x2' }))
    expect(s.incidents().length).toBe(before)
    expect(s.find('demo-b1')!.reports.length).toBe(2)
    expect(s.find('demo-b1')!.state.events.some((e) => e.type === 'linked')).toBe(true)
  })

  it('cannot close or mark repaired without evidence', () => {
    const s = fresh()
    expect(s.setStatus('demo-b1', 'inspected', ADMIN).ok).toBe(false) // skip step
    expect(s.setStatus('demo-b1', 'investigating', ADMIN).ok).toBe(true)
    expect(s.setStatus('demo-b1', 'inspected', ADMIN).ok).toBe(false) // needs note
    s.addEvidence('demo-b1', { kind: 'inspection_note', note: 'Found seepage' }, ADMIN)
    expect(s.setStatus('demo-b1', 'inspected', ADMIN).ok).toBe(true)
    expect(s.setStatus('demo-b1', 'repaired', ADMIN).ok).toBe(false) // needs after photo
    s.addEvidence('demo-b1', { kind: 'after', photo: placeholderPhoto('after') }, ADMIN)
    expect(s.setStatus('demo-b1', 'repaired', ADMIN).ok).toBe(true)
    // B has no citizen photo yet and no verifier: closing must fail
    const res = s.setStatus('demo-b1', 'closed', ADMIN, 'Supervisor')
    expect(res.ok).toBe(false)
    expect(verification(s.find('demo-b1')!)).toBe('evidence_incomplete')
    s.addEvidence('demo-b1', { kind: 'before', photo: placeholderPhoto('before') }, ADMIN)
    expect(s.setStatus('demo-b1', 'closed', ADMIN, '').ok).toBe(false) // verifier required
    expect(s.setStatus('demo-b1', 'closed', ADMIN, 'Supervisor').ok).toBe(true)
    expect(verification(s.find('demo-b1')!)).toBe('verified')
  })

  it('demo case E is repaired but NOT verified; D is verified', () => {
    const s = fresh()
    expect(verification(s.find('demo-e1')!)).toBe('evidence_incomplete')
    expect(checklist(s.find('demo-e1')!).find((c) => c.key === 'verifier')!.done).toBe(false)
    expect(verification(s.find('demo-d1')!)).toBe('verified')
  })

  it('tracks a case by ID and is case-insensitive', () => {
    const s = fresh()
    expect(s.track('jr-demo-0002')!.linkedReports).toBe(2)
    expect(s.track('nope')).toBeNull()
  })
})

describe('analytics', () => {
  it('computes consolidated duplicates, evidence completeness and response times from the seed', () => {
    const s = createStore(undefined, () => NOW)
    const m = computeMetrics(s.incidents(), NOW)
    expect(m.totalReports).toBe(6)
    expect(m.incidents).toBe(5)
    expect(m.duplicatesConsolidated).toBe(1)
    expect(m.closed).toBe(1)
    expect(m.evidenceCompletenessPct).toBe(100)
    expect(m.avgFirstResponseH).toBeCloseTo((6 + 6) / 2, 5)
    expect(m.avgResolutionH).toBeCloseTo((120 - 70 + (96 - 30)) / 2, 5)
    expect(m.highPriorityUnresolved).toBeGreaterThanOrEqual(1)
  })
  it('seed cases cover the seeded roots', () => {
    const c = seedCases(NOW)
    expect(Object.keys(c).length).toBe(5)
    expect(H).toBe(3_600_000)
  })
})
