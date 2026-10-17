import type { CaseState, Report } from './types'

const H = 3_600_000

/** Inline placeholder "photo" so demo evidence renders without any asset hosting. */
export function placeholderPhoto(label: string, color = '#0b7bc4'): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='320' height='200'><rect width='100%' height='100%' fill='${color}'/><text x='50%' y='46%' fill='white' font-family='sans-serif' font-size='22' text-anchor='middle'>${label}</text><text x='50%' y='62%' fill='white' font-family='sans-serif' font-size='13' text-anchor='middle'>DEMO IMAGE - not a real report</text></svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

// Fictional demo area: coordinates only place sample pins on the map.
const BASE = { lat: 28.6139, lng: 77.209 }
const off = (northM: number, eastM: number) => ({
  lat: BASE.lat + northM / 111_320,
  lng: BASE.lng + eastM / (111_320 * Math.cos((BASE.lat * Math.PI) / 180)),
})

type SeedReport = Omit<Report, 'demo' | 'locationSource' | 'lat' | 'lng'> & {
  locationSource?: Report['locationSource']
  at: { lat: number; lng: number }
}

export function seedReports(now: number): Report[] {
  const mk = ({ at, ...r }: SeedReport): Report => ({ locationSource: 'map_pin', demo: true, ...at, ...r })
  return [
    // Incident A: two nearby reports about the SAME burst pipe
    mk({ id: 'demo-a1', caseId: 'JR-DEMO-0001', createdAt: now - 6 * H, at: off(0, 0), locationSource: 'gps', accuracyM: 12,
      description: 'सड़क पर पाइप फट गया है, बहुत पानी बह रहा है, बाज़ार के पास', lang: 'hi', category: 'burst_main',
      urgencyHints: ['road affected', 'high flow'], landmark: 'बाज़ार', severity: 95,
      address: { source: 'auto', formatted: 'Kartavya Path, Raisina Hill, New Delhi, Delhi, 110004, India', components: { line: 'Kartavya Path', locality: 'Raisina Hill', city: 'New Delhi', state: 'Delhi', pin: '110004' } }, photo: placeholderPhoto('Burst pipe (Hindi report)'),
      reporterId: 'demo-user-1', truthGroup: 'A' }),
    mk({ id: 'demo-a2', caseId: 'JR-DEMO-0002', createdAt: now - 3 * H, at: off(25, 20),
      description: 'Water gushing from a broken pipe near the market, road is flooded', lang: 'en', category: 'burst_main',
      urgencyHints: ['flooding', 'road affected', 'high flow'], landmark: 'the market', severity: 100, photo: placeholderPhoto('Burst pipe (English report)'),
      reporterId: 'demo-user-2', truthGroup: 'A' }),
    // Incident B: small drip elsewhere, no photo
    mk({ id: 'demo-b1', caseId: 'JR-DEMO-0003', createdAt: now - 30 * H, at: off(-1800, 900),
      description: 'Small leak at the road corner, dripping for days', lang: 'en', category: 'pipe_leak',
      urgencyHints: ['ongoing for days'], severity: 65,
      address: { source: 'manual', formatted: 'Road corner, Sample Colony (demo), Demo City', components: { line: 'Road corner', locality: 'Sample Colony (demo)', city: 'Demo City' } }, reporterId: 'demo-user-3', truthGroup: 'B' }),
    // Hard negative: about 50 m from A but ten days earlier and a different issue; must NOT merge with A
    mk({ id: 'demo-n1', caseId: 'JR-DEMO-0004', createdAt: now - 240 * H, at: off(-40, 30),
      description: 'Water meter valve dripping at the shop entrance', lang: 'en', category: 'meter_valve',
      urgencyHints: [], severity: 45, photo: placeholderPhoto('Meter drip', '#4b6584'), reporterId: 'demo-user-4', truthGroup: 'N' }),
    // Incident D: repaired with complete evidence, closed
    mk({ id: 'demo-d1', caseId: 'JR-DEMO-0005', createdAt: now - 120 * H, at: off(1500, -1200), locationSource: 'gps', accuracyM: 20,
      description: 'Dirty muddy water and bad smell from the tap, pipe leaking nearby', lang: 'en', category: 'contamination',
      urgencyHints: [], severity: 70, photo: placeholderPhoto('Muddy water', '#7a5c3a'), reporterId: 'demo-user-5', truthGroup: 'D' }),
    // Incident E: marked repaired but evidence incomplete (no verifier)
    mk({ id: 'demo-e1', caseId: 'JR-DEMO-0006', createdAt: now - 96 * H, at: off(-900, -1700),
      description: 'Pipe leak near the school gate, water pooling', lang: 'en', category: 'pipe_leak',
      urgencyHints: ['near school'], landmark: 'the school gate', severity: 65,
      address: { source: 'manual', formatted: 'Sample Nagar (demo), Demo City', components: { locality: 'Sample Nagar (demo)', city: 'Demo City' } }, photo: placeholderPhoto('School gate leak'),
      reporterId: 'demo-user-6', truthGroup: 'E' }),
  ]
}

type Ev = CaseState['events'][number]
const ev = (at: number, actor: string, type: Ev['type'], text: string): Ev => ({ at, actor, type, text })

export function seedCases(now: number): Record<string, CaseState> {
  return {
    'demo-a1': {
      status: 'reported',
      events: [
        ev(now - 6 * H, 'system', 'reported', 'Report JR-DEMO-0001 received (DEMO DATA)'),
        ev(now - 3 * H, 'system', 'linked', 'Report JR-DEMO-0002 linked as likely duplicate (2 independent reporters)'),
      ],
      evidence: [],
    },
    'demo-b1': { status: 'reported', assignee: 'Demo operator', assignedBy: { name: 'Demo administrator', role: 'administrator' }, events: [ev(now - 30 * H, 'system', 'reported', 'Report JR-DEMO-0003 received (DEMO DATA)')], evidence: [] },
    'demo-n1': { status: 'reported', events: [ev(now - 240 * H, 'system', 'reported', 'Report JR-DEMO-0004 received (DEMO DATA)')], evidence: [] },
    'demo-d1': {
      status: 'closed',
      assignee: 'Field team 2',
      verifiedBy: 'Demo supervisor',
      events: [
        ev(now - 120 * H, 'system', 'reported', 'Report JR-DEMO-0005 received (DEMO DATA)'),
        ev(now - 114 * H, 'Demo operator', 'status', 'Status: investigating'),
        ev(now - 100 * H, 'Demo operator', 'status', 'Status: inspected'),
        ev(now - 70 * H, 'Demo operator', 'status', 'Status: repaired'),
        ev(now - 60 * H, 'Demo supervisor', 'status', 'Status: closed (evidence checklist complete)'),
      ],
      evidence: [
        { at: now - 101 * H, actor: 'Demo operator', kind: 'inspection_note', note: 'Joint leak found on the branch line; isolation valve closed.' },
        { at: now - 71 * H, actor: 'Demo operator', kind: 'after', photo: placeholderPhoto('After repair', '#2d8a4e') },
      ],
    },
    'demo-e1': {
      status: 'repaired',
      events: [
        ev(now - 96 * H, 'system', 'reported', 'Report JR-DEMO-0006 received (DEMO DATA)'),
        ev(now - 90 * H, 'Demo operator', 'status', 'Status: investigating'),
        ev(now - 50 * H, 'Demo operator', 'status', 'Status: inspected'),
        ev(now - 30 * H, 'Demo operator', 'status', 'Status: repaired'),
      ],
      evidence: [
        { at: now - 51 * H, actor: 'Demo operator', kind: 'inspection_note', note: 'Confirmed seepage at coupling.' },
        { at: now - 31 * H, actor: 'Demo operator', kind: 'after', photo: placeholderPhoto('After repair', '#2d8a4e') },
      ],
    },
  }
}
