export type Category = 'burst_main' | 'pipe_leak' | 'meter_valve' | 'contamination' | 'overflow' | 'other'
export type Lang = 'en' | 'hi'
export type LocationSource = 'gps' | 'map_pin'

export interface Report {
  id: string
  caseId: string
  createdAt: number
  lat: number
  lng: number
  locationSource: LocationSource
  /** GPS accuracy in metres, when known */
  accuracyM?: number
  description: string
  lang: Lang
  category: Category
  /** Urgency phrases found in the text (shown to the citizen for confirmation) */
  urgencyHints: string[]
  landmark?: string
  /** 0-100, from category + urgency hints */
  severity: number
  photo?: string
  /** Anonymous per-browser id; used only to count independent reporters */
  reporterId: string
  /** Seed/demo data is always labelled as such in the UI */
  demo?: boolean
  /** Ground-truth group, only present on labelled demo data (for evaluation) */
  truthGroup?: string
}

export type Status = 'reported' | 'investigating' | 'inspected' | 'repaired' | 'closed' | 'not_confirmed'

export interface CaseEvent {
  at: number
  actor: string
  type: 'reported' | 'linked' | 'assigned' | 'status' | 'evidence'
  text: string
}

export type EvidenceKind = 'before' | 'after' | 'inspection_note'

export interface Evidence {
  at: number
  actor: string
  kind: EvidenceKind
  photo?: string
  note?: string
}

export interface CaseState {
  status: Status
  assignee?: string
  verifiedBy?: string
  events: CaseEvent[]
  evidence: Evidence[]
}

export interface Incident {
  /** id of the earliest report in the cluster */
  id: string
  reports: Report[]
  centroid: { lat: number; lng: number }
  category: Category
  state: CaseState
}

export interface PriorityFactor {
  key: 'S' | 'E' | 'R' | 'C'
  label: string
  weight: number
  /** 0-100 */
  value: number
  contribution: number
  reason: string
}

export interface PriorityResult {
  score: number
  band: 'high' | 'medium' | 'low'
  factors: PriorityFactor[]
}

export interface ChecklistItem {
  key: 'before' | 'note' | 'after' | 'verifier'
  done: boolean
}
