import { describe, expect, it } from 'vitest'
import { createDirectoryStore, type Actor } from './officers'
import { MAX_PHOTO_BYTES, createStore, validateEvidencePhoto } from './store'
import { TINY_JPEG } from './fixtures'

const NOW = 1_800_000_000_000
const admin: Actor = { name: 'Admin Asha', role: 'administrator' }
const opA: Actor = { name: 'Operator A', role: 'operator' }
const opB: Actor = { name: 'Operator B', role: 'operator' }
const citizen: Actor = { name: 'Citizen', role: 'citizen' }

const fresh = () => createStore(undefined, () => NOW, createDirectoryStore(undefined, () => NOW))
const report = (s: ReturnType<typeof fresh>, over = {}) =>
  s.submitReport({ lat: 28.9, lng: 77.9, locationSource: 'map_pin', description: 'A leak far away from the demo data points', lang: 'en', category: 'pipe_leak', urgencyHints: [], severity: 60, reporterId: 'u9', photo: TINY_JPEG, ...over })

describe('who can see which complaints (7/8/9 at the data layer)', () => {
  it('citizens see no staff queue; operators see unassigned + their own; administrators see everything', () => {
    const s = fresh()
    expect(s.incidentsFor(citizen)).toHaveLength(0)
    const all = s.incidents().length
    expect(s.incidentsFor(admin)).toHaveLength(all)
    const forOp = s.incidentsFor({ name: 'Demo operator', role: 'operator' })
    expect(forOp.every((i) => !i.state.assignee || i.state.assignee === 'Demo operator')).toBe(true)
    // seed has 'Field team 2' on the closed case: another assignee, so a different operator must not see it
    expect(s.incidentsFor(opA).some((i) => i.state.assignee === 'Field team 2')).toBe(false)
    expect(s.incidentsFor(opA).some((i) => i.state.assignee === 'Demo operator')).toBe(false)
  })
})

describe('case mutations are permission-checked', () => {
  it('a citizen cannot assign, add evidence or change status', () => {
    const s = fresh()
    expect(s.assign('demo-a1', 'Citizen', citizen).ok).toBe(false)
    expect(s.addEvidence('demo-a1', { kind: 'inspection_note', note: 'sneaky' }, citizen).ok).toBe(false)
    expect(s.setStatus('demo-a1', 'investigating', citizen).ok).toBe(false)
    expect(s.find('demo-a1')!.state.status).toBe('reported')
    expect(s.find('demo-a1')!.state.assignee).toBeUndefined()
  })

  it('an operator cannot touch an unassigned case until they claim it, and cannot assign it to someone else', () => {
    const s = fresh()
    expect(s.setStatus('demo-a1', 'investigating', opA).ok).toBe(false)
    expect(s.assign('demo-a1', 'Operator B', opA).ok).toBe(false)
    expect(s.assign('demo-a1', 'Operator A', opA).ok).toBe(true)
    expect(s.find('demo-a1')!.state.assignedBy).toEqual({ name: 'Operator A', role: 'operator' })
    expect(s.find('demo-a1')!.state.events[s.find('demo-a1')!.state.events.length - 1].text).toMatch(/self-assigned, not administrator-confirmed/)
    expect(s.setStatus('demo-a1', 'investigating', opA).ok).toBe(true)
  })

  it('an operator cannot act on a case claimed by another operator, and cannot steal it', () => {
    const s = fresh()
    s.assign('demo-a1', 'Operator A', opA)
    expect(s.setStatus('demo-a1', 'investigating', opB).ok).toBe(false)
    expect(s.addEvidence('demo-a1', { kind: 'inspection_note', note: 'not mine' }, opB).ok).toBe(false)
    expect(s.assign('demo-a1', 'Operator B', opB).ok).toBe(false)
    expect(s.find('demo-a1')!.state.assignee).toBe('Operator A')
  })

  it('an administrator can assign to anyone, which is recorded as administrator-confirmed, and can act on any case', () => {
    const s = fresh()
    expect(s.assign('demo-a1', 'Operator B', admin).ok).toBe(true)
    expect(s.find('demo-a1')!.state.assignedBy).toEqual({ name: 'Admin Asha', role: 'administrator' })
    expect(s.find('demo-a1')!.state.events[s.find('demo-a1')!.state.events.length - 1].text).toMatch(/administrator-confirmed/)
    expect(s.setStatus('demo-a1', 'investigating', opB).ok).toBe(true)
    expect(s.setStatus('demo-a1', 'inspected', admin).ok).toBe(false) // still needs the inspection note (rules still apply to admins)
  })

  it('the audit history records the real actor name and role', () => {
    const s = fresh()
    s.assign('demo-a1', 'Operator A', opA)
    s.setStatus('demo-a1', 'investigating', opA)
    const ev = s.find('demo-a1')!.state.events
    expect(ev[ev.length - 1]).toMatchObject({ actor: 'Operator A', type: 'status' })
    expect(ev.some((e) => e.type === 'assigned' && e.actor === 'Operator A')).toBe(true)
  })
})

describe('public tracking exposes only citizen-safe data', () => {
  it('no operator names, evidence photos, other reports, or staff candidates', () => {
    const s = fresh()
    s.assign('demo-a1', 'Operator A', opA)
    s.addEvidence('demo-a1', { kind: 'inspection_note', note: 'Internal note: gate key with security' }, opA)
    const t = s.track('JR-DEMO-0001')!
    const json = JSON.stringify(t)
    expect(json).not.toContain('Operator A')
    expect(json).not.toContain('Internal note')
    expect(json).not.toContain('JR-DEMO-0002') // a different citizen's grouped report
    expect(t.report.match).toBeUndefined() // seeded demo reports predate routing
    // a freshly routed report: the staff-only candidate list is stripped from the public view
    const fresh1 = report(s)
    expect(fresh1.match!.staffCandidates.length).toBeGreaterThan(0) // staff snapshot keeps unverified listings
    const pub = s.track(fresh1.caseId)!
    expect(pub.report.match!.staffCandidates).toEqual([])
    expect(JSON.stringify(pub)).not.toContain('Khan')
    expect(pub.report.reporterId).toBe('')
    expect(Object.keys(t).sort()).toEqual(['events', 'linkedReports', 'report', 'status', 'verification'])
    expect(t.events.every((e) => Object.keys(e).sort().join() === 'at,text')).toBe(true)
  })
})

describe('evidence photo validation on the submission path (11/14/15)', () => {
  it('rejects a missing photo', () => {
    expect(validateEvidencePhoto(undefined)).toMatch(/live photo is required/)
    expect(() => report(fresh(), { photo: undefined })).toThrow(/live photo is required/)
    expect(() => report(fresh(), { photo: '' })).toThrow()
  })
  it('rejects anything that is not a JPEG data URL (a gallery PNG/GIF/SVG/URL cannot be smuggled in)', () => {
    for (const bad of ['data:image/png;base64,iVBORw0KGgo=', 'data:image/gif;base64,R0lGODlh', 'data:image/svg+xml;utf8,<svg/>', 'https://example.com/a.jpg', 'blob:http://x/1', 'not a photo', 'data:text/html;base64,PGgxPg==']) {
      expect(validateEvidencePhoto(bad), bad).not.toBeNull()
      expect(() => report(fresh(), { photo: bad })).toThrow()
    }
  })
  it('rejects a JPEG-labelled payload that is not really a JPEG', () => {
    expect(validateEvidencePhoto('data:image/jpeg;base64,' + btoa('hello world, not an image'))).toMatch(/not a valid JPEG/)
  })
  it('rejects oversized photos', () => {
    const big = 'data:image/jpeg;base64,/9j/' + 'A'.repeat(Math.ceil((MAX_PHOTO_BYTES * 4) / 3) + 100)
    expect(validateEvidencePhoto(big)).toMatch(/too large/)
  })
  it('accepts a valid JPEG and stores it with client-provided metadata clearly marked', () => {
    const s = fresh()
    const r = report(s, { photoMeta: { source: 'forged', capturedAtClient: '2026-10-17T10:00:00.000Z', width: 640, height: 480, bytes: 160 } })
    expect(r.photo).toBe(TINY_JPEG)
    expect(r.photoMeta).toEqual({ source: 'browser_camera_client_claim', capturedAtClient: '2026-10-17T10:00:00.000Z', width: 640, height: 480, bytes: 160 })
  })
  it('a rejected submission creates nothing', () => {
    const s = fresh()
    const n = s.allReports().length
    expect(() => report(s, { photo: undefined })).toThrow()
    expect(s.allReports().length).toBe(n)
  })
  it('legacy reports without a photo are kept and still readable', () => {
    const s = fresh()
    const legacy = s.allReports().find((r) => r.id === 'demo-b1')!
    expect(legacy.photo).toBeUndefined()
    expect(legacy.photoMeta).toBeUndefined()
    expect(s.find('demo-b1')).toBeTruthy()
  })
})
