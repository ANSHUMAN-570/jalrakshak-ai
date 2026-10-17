import type { CaseState, ChecklistItem, Incident, Status } from './types'

export const NEXT_STATUSES: Record<Status, Status[]> = {
  reported: ['investigating'],
  investigating: ['inspected'],
  inspected: ['repaired', 'not_confirmed'],
  repaired: ['closed'],
  closed: [],
  not_confirmed: [],
}

export const OPEN_STATUSES: Status[] = ['reported', 'investigating', 'inspected', 'repaired']

export function isOpen(s: Status): boolean {
  return OPEN_STATUSES.includes(s)
}

type CaseLike = Pick<Incident, 'reports'> & { state: CaseState }

/** Closure evidence checklist: a status change alone is never treated as proof of repair. */
export function checklist(incident: CaseLike): ChecklistItem[] {
  const { reports, state } = incident
  return [
    { key: 'before', done: reports.some((r) => r.photo) || state.evidence.some((e) => e.kind === 'before' && e.photo) },
    { key: 'note', done: state.evidence.some((e) => e.kind === 'inspection_note' && !!e.note?.trim()) },
    { key: 'after', done: state.evidence.some((e) => e.kind === 'after' && e.photo) },
    { key: 'verifier', done: !!state.verifiedBy?.trim() },
  ]
}

export function evidenceComplete(incident: CaseLike): boolean {
  return checklist(incident).every((c) => c.done)
}

export type Verification = 'verified' | 'evidence_incomplete' | 'unverified'

/** 'verified' only for closed cases whose full evidence checklist is complete. */
export function verification(incident: CaseLike): Verification {
  const s = incident.state.status
  if (s === 'closed' && evidenceComplete(incident)) return 'verified'
  if (s === 'repaired' || s === 'closed') return 'evidence_incomplete'
  return 'unverified'
}

export function canTransition(
  incident: CaseLike,
  next: Status,
  verifier?: string,
): { ok: true } | { ok: false; error: string } {
  const cur = incident.state.status
  if (!NEXT_STATUSES[cur].includes(next)) return { ok: false, error: `Cannot move from "${cur}" to "${next}".` }
  const ev = incident.state.evidence
  if ((next === 'inspected' || next === 'not_confirmed') && !ev.some((e) => e.kind === 'inspection_note' && e.note?.trim()))
    return { ok: false, error: 'Add an inspection note before recording the inspection outcome.' }
  if (next === 'repaired' && !ev.some((e) => e.kind === 'after' && e.photo))
    return { ok: false, error: 'Attach an after-repair photo before marking repaired.' }
  if (next === 'closed') {
    const probe = { reports: incident.reports, state: { ...incident.state, verifiedBy: verifier ?? incident.state.verifiedBy } }
    const missing = checklist(probe).filter((c) => !c.done).map((c) => c.key)
    if (missing.length) return { ok: false, error: `Closure needs complete evidence. Missing: ${missing.join(', ')}.` }
  }
  return { ok: true }
}
