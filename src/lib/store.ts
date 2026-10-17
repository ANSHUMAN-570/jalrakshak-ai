import { directory as defaultDirectory, type Actor } from './officers'
import { matchResponsible } from './routing'
import { cleanComponents, cleanText, formatComponents, hasAddress, isValidPin } from './address'
import { clusterCentroid, clusterReports } from './duplicates'
import { canTransition, verification } from './rules'
import { seedCases, seedReports } from './seed'
import type { CaseState, Category, EvidenceKind, Incident, Lang, LocationSource, PhotoMeta, Report, ReportAddress, Status } from './types'

/**
 * Prototype data layer. Everything lives in browser localStorage so the demo works with
 * zero infrastructure. The functions below are the seam where a Supabase/PostgreSQL
 * backend would plug in; nothing outside this file touches storage.
 */
export interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}

interface State {
  reports: Report[]
  cases: Record<string, CaseState>
}

const KEY = 'jalrakshak.v1'

function memoryStorage(): StorageLike {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) }
}

export interface NewReportInput {
  lat: number
  lng: number
  locationSource: LocationSource
  accuracyM?: number
  description: string
  lang: Lang
  category: Category
  urgencyHints: string[]
  landmark?: string
  address?: ReportAddress
  severity: number
  photo?: string
  photoMeta?: PhotoMeta
  reporterId: string
}

export const MAX_PHOTO_BYTES = 1_500_000

/**
 * New complaints must carry a JPEG photo. This is the submission-path check (the database function repeats it).
 * It confirms type and size only; it cannot prove the photo came from a live camera or is authentic.
 */
export function validateEvidencePhoto(photo: string | undefined): string | null {
  if (!photo) return 'A live photo is required to submit a complaint.'
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(photo)
  if (!m) return 'The photo must be a JPEG image captured with the camera.'
  const b64 = m[1]
  if ((b64.length * 3) / 4 > MAX_PHOTO_BYTES) return 'The photo is too large (limit 1.5 MB).'
  let head = ''
  try { head = atob(b64.slice(0, 8)) } catch { return 'The photo data is not valid.' }
  if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) return 'The photo is not a valid JPEG image.'
  return null
}

/** Re-validates an address before it is saved (the form is not the only trusted path). */
export function sanitizeAddress(a: ReportAddress | undefined): ReportAddress | undefined {
  if (!a || (a.source !== 'auto' && a.source !== 'manual')) return undefined
  const components = cleanComponents(a.components ?? {})
  if (components.pin && !isValidPin(components.pin)) delete components.pin
  const formatted = a.source === 'manual' ? formatComponents(components) : cleanText(a.formatted, 300) || formatComponents(components)
  if (!formatted && !hasAddress(components)) return undefined
  return { source: a.source, formatted: formatted || undefined, components }
}

export type Result<T = undefined> = ({ ok: true } & (T extends undefined ? object : { value: T })) | { ok: false; error: string }

/**
 * What a citizen may read about the case timeline. Event text written for staff can contain operator names and other
 * citizens' case IDs, so public events are generic. Status changes carry no personal data and are shown as written.
 */
function publicEventText(e: { type: string; text: string }): string {
  switch (e.type) {
    case 'reported': return 'Report received'
    case 'linked': return 'A nearby report about the same issue was grouped with this one'
    case 'assigned': return 'Assigned to a municipal operator'
    case 'evidence': return 'Inspection or repair evidence recorded'
    default: return e.text
  }
}

/** Operators may only work on cases assigned to them; administrators on any case. (Demo-mode check; the database enforces it for real.) */
function mayWork(inc: Incident, actor: Actor): string | null {
  if (actor.role === 'administrator' && actor.name.trim()) return null
  if (actor.role === 'operator' && actor.name.trim() && inc.state.assignee === actor.name) return null
  return actor.role === 'operator'
    ? 'Only the operator assigned to this case (or an administrator) can change it. Claim it first.'
    : 'Operator or administrator access is required.'
}

export function createStore(storage: StorageLike = memoryStorage(), clock: () => number = Date.now, dir: Pick<typeof defaultDirectory, 'officers' | 'zones'> = defaultDirectory) {
  const listeners = new Set<() => void>()
  let version = 0
  let cache: State | null = null

  function load(): State {
    if (cache) return cache
    const raw = storage.getItem(KEY)
    if (raw) {
      try {
        cache = JSON.parse(raw) as State
        return cache
      } catch {
        /* fall through to reseed */
      }
    }
    const now = clock()
    cache = { reports: seedReports(now), cases: seedCases(now) }
    storage.setItem(KEY, JSON.stringify(cache))
    return cache
  }

  function save() {
    storage.setItem(KEY, JSON.stringify(cache))
    version++
    listeners.forEach((l) => l())
  }

  function newCase(report: Report): CaseState {
    return {
      status: 'reported',
      events: [{ at: report.createdAt, actor: 'system', type: 'reported', text: `Report ${report.caseId} received` }],
      evidence: [],
    }
  }

  /** Derives incidents from raw reports each time so duplicate grouping is always current. */
  function incidents(): Incident[] {
    const st = load()
    let migrated = false
    const result = clusterReports(st.reports).map((group) => {
      const root = group[0]
      if (!st.cases[root.id]) {
        // The cluster root changed (two clusters merged): inherit the most advanced member case.
        const inherited = group.map((r) => st.cases[r.id]).find(Boolean)
        st.cases[root.id] = inherited ?? newCase(root)
        migrated = true
      }
      const counts = new Map<Category, number>()
      group.forEach((r) => counts.set(r.category, (counts.get(r.category) ?? 0) + 1))
      const category = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
      return { id: root.id, reports: group, centroid: clusterCentroid(group), category, state: st.cases[root.id] }
    })
    if (migrated) storage.setItem(KEY, JSON.stringify(st))
    return result
  }

  function find(id: string): Incident | undefined {
    return incidents().find((i) => i.id === id)
  }

  function caseId(now: number): string {
    const d = new Date(now)
    const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase()
    return `JR-${ymd}-${rand}`
  }

  return {
    subscribe(l: () => void) {
      listeners.add(l)
      return () => void listeners.delete(l)
    },
    getVersion: () => version,
    incidents,
    find,

    submitReport(input: NewReportInput): Report {
      const photoError = validateEvidencePhoto(input.photo)
      if (photoError) throw new Error(photoError)
      const st = load()
      const now = clock()
      const match = matchResponsible({ category: input.category, lat: input.lat, lng: input.lng }, { officers: dir.officers(), zones: dir.zones() }, now)
      const photoMeta: PhotoMeta | undefined = input.photoMeta
        ? { source: 'browser_camera_client_claim', capturedAtClient: cleanText(input.photoMeta.capturedAtClient, 40), width: Math.round(Number(input.photoMeta.width)) || 0, height: Math.round(Number(input.photoMeta.height)) || 0, bytes: Math.round(Number(input.photoMeta.bytes)) || 0 }
        : undefined
      const report: Report = { ...input, match, photoMeta, address: sanitizeAddress(input.address), description: cleanText(input.description, 1000), id: `r-${now}-${Math.random().toString(36).slice(2, 7)}`, caseId: caseId(now), createdAt: now }
      st.reports.push(report)
      const inc = incidents().find((i) => i.reports.some((r) => r.id === report.id))
      if (inc) {
        const independent = new Set(inc.reports.map((r) => r.reporterId)).size
        if (inc.reports.length > 1)
          inc.state.events.push({
            at: now,
            actor: 'system',
            type: 'linked',
            text: `Report ${report.caseId} linked as likely duplicate (${independent} independent reporter${independent === 1 ? '' : 's'})`,
          })
      }
      save()
      return report
    },

    /** Incidents the actor may see: administrators all; operators their own plus unassigned; citizens none. */
    incidentsFor(actor: Actor): Incident[] {
      if (actor.role === 'administrator') return incidents()
      if (actor.role === 'operator') return incidents().filter((i) => !i.state.assignee || i.state.assignee === actor.name)
      return []
    },

    /** Operators may claim an unassigned case for themselves; only administrators may assign to someone else. */
    assign(incidentId: string, assignee: string, actor: Actor): Result {
      if (actor.role === 'citizen' || !actor.name.trim()) return { ok: false, error: 'Operator or administrator access is required.' }
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      const who = assignee.trim()
      if (!who) return { ok: false, error: 'Enter an assignee.' }
      if (actor.role === 'operator') {
        if (who !== actor.name) return { ok: false, error: 'Operators can only assign a case to themselves; ask an administrator to assign it to someone else.' }
        if (inc.state.assignee && inc.state.assignee !== actor.name) return { ok: false, error: 'This case is already assigned to someone else.' }
      }
      inc.state.assignee = who
      inc.state.assignedBy = { name: actor.name, role: actor.role }
      inc.state.events.push({
        at: clock(),
        actor: actor.name,
        type: 'assigned',
        text: `Assigned to ${who} by ${actor.name} (${actor.role})${actor.role === 'administrator' ? ' - administrator-confirmed' : ' - self-assigned, not administrator-confirmed'}`,
      })
      save()
      return { ok: true }
    },

    addEvidence(incidentId: string, e: { kind: EvidenceKind; photo?: string; note?: string }, actor: Actor): Result {
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      const denied = mayWork(inc, actor)
      if (denied) return { ok: false, error: denied }
      if (e.kind === 'inspection_note' && !e.note?.trim()) return { ok: false, error: 'Write an inspection note.' }
      if (e.kind !== 'inspection_note' && !e.photo) return { ok: false, error: 'Choose a photo to attach.' }
      const at = clock()
      inc.state.evidence.push({ at, actor: actor.name, kind: e.kind, photo: e.photo, note: e.note?.trim() })
      inc.state.events.push({ at, actor: actor.name, type: 'evidence', text: `Evidence added: ${e.kind.replace('_', ' ')}` })
      save()
      return { ok: true }
    },

    setStatus(incidentId: string, next: Status, actor: Actor, verifier?: string): Result {
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      const denied = mayWork(inc, actor)
      if (denied) return { ok: false, error: denied }
      const check = canTransition(inc, next, verifier)
      if (!check.ok) return check
      if (next === 'closed') inc.state.verifiedBy = verifier?.trim()
      inc.state.status = next
      inc.state.events.push({
        at: clock(),
        actor: next === 'closed' && verifier ? verifier.trim() : actor.name,
        type: 'status',
        text: next === 'closed' ? 'Status: closed (evidence checklist complete)' : `Status: ${next.replace('_', ' ')}`,
      })
      save()
      return { ok: true }
    },

    /**
     * Public, privacy-limited view for a citizen who knows a case ID: their own report, the status, how many reports are
     * grouped, and the public timeline text. No operator names, evidence photos, other citizens' reports or staff data.
     */
    track(caseIdInput: string) {
      const id = caseIdInput.trim().toUpperCase()
      const inc = incidents().find((i) => i.reports.some((r) => r.caseId.toUpperCase() === id))
      if (!inc) return null
      const rep = inc.reports.find((r) => r.caseId.toUpperCase() === id)!
      const { staffCandidates: _staff, ...publicMatch } = rep.match ?? ({} as NonNullable<Report['match']>)
      void _staff
      return {
        report: { ...rep, reporterId: '', match: rep.match ? ({ ...publicMatch, staffCandidates: [] } as NonNullable<Report['match']>) : undefined },
        status: inc.state.status,
        linkedReports: inc.reports.length,
        events: inc.state.events.map((e) => ({ at: e.at, text: publicEventText(e) })),
        verification: verification(inc),
      }
    },

    reset() {
      const now = clock()
      cache = { reports: seedReports(now), cases: seedCases(now) }
      save()
    },

    allReports: () => load().reports,
  }
}

export const store = createStore(typeof localStorage !== 'undefined' ? localStorage : undefined)
