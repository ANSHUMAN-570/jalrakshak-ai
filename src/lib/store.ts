import { cleanComponents, cleanText, formatComponents, hasAddress, isValidPin } from './address'
import { clusterCentroid, clusterReports } from './duplicates'
import { canTransition } from './rules'
import { seedCases, seedReports } from './seed'
import type { CaseState, Category, EvidenceKind, Incident, Lang, LocationSource, Report, ReportAddress, Status } from './types'

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
  reporterId: string
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

export function createStore(storage: StorageLike = memoryStorage(), clock: () => number = Date.now) {
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
      const st = load()
      const now = clock()
      const report: Report = { ...input, address: sanitizeAddress(input.address), description: cleanText(input.description, 1000), id: `r-${now}-${Math.random().toString(36).slice(2, 7)}`, caseId: caseId(now), createdAt: now }
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

    assign(incidentId: string, assignee: string, actor: string): Result {
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      if (!assignee.trim()) return { ok: false, error: 'Enter an assignee.' }
      inc.state.assignee = assignee.trim()
      inc.state.events.push({ at: clock(), actor, type: 'assigned', text: `Assigned to ${assignee.trim()}` })
      save()
      return { ok: true }
    },

    addEvidence(incidentId: string, e: { kind: EvidenceKind; photo?: string; note?: string; actor: string }): Result {
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      if (e.kind === 'inspection_note' && !e.note?.trim()) return { ok: false, error: 'Write an inspection note.' }
      if (e.kind !== 'inspection_note' && !e.photo) return { ok: false, error: 'Choose a photo to attach.' }
      const at = clock()
      inc.state.evidence.push({ at, actor: e.actor, kind: e.kind, photo: e.photo, note: e.note?.trim() })
      inc.state.events.push({ at, actor: e.actor, type: 'evidence', text: `Evidence added: ${e.kind.replace('_', ' ')}` })
      save()
      return { ok: true }
    },

    setStatus(incidentId: string, next: Status, actor: string, verifier?: string): Result {
      const inc = find(incidentId)
      if (!inc) return { ok: false, error: 'Incident not found.' }
      if (!actor.trim()) return { ok: false, error: 'Enter your operator name first.' }
      const check = canTransition(inc, next, verifier)
      if (!check.ok) return check
      if (next === 'closed') inc.state.verifiedBy = verifier?.trim()
      inc.state.status = next
      inc.state.events.push({
        at: clock(),
        actor: next === 'closed' && verifier ? verifier.trim() : actor,
        type: 'status',
        text: next === 'closed' ? 'Status: closed (evidence checklist complete)' : `Status: ${next.replace('_', ' ')}`,
      })
      save()
      return { ok: true }
    },

    /** Public, privacy-safe view for a citizen tracking a case ID. */
    track(caseIdInput: string) {
      const id = caseIdInput.trim().toUpperCase()
      const inc = incidents().find((i) => i.reports.some((r) => r.caseId.toUpperCase() === id))
      if (!inc) return null
      const rep = inc.reports.find((r) => r.caseId.toUpperCase() === id)!
      return { report: rep, status: inc.state.status, linkedReports: inc.reports.length, incident: inc }
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
