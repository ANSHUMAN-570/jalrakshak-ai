import type { ResponsibleMatch } from './routing'

export type Category =
  | 'burst_main'
  | 'pipe_leak'
  | 'meter_valve'
  | 'supply_disruption'
  | 'contamination'
  | 'sewer'
  | 'drainage'
  | 'overflow'
  | 'other'
export type Lang = 'en' | 'hi'
export type LocationSource = 'gps' | 'map_pin'

export interface AddressComponents {
  /** House number, street or landmark */
  line?: string
  locality?: string
  city?: string
  state?: string
  /** 6-digit Indian PIN code */
  pin?: string
}

/** Optional on Report so reports saved before addresses existed keep working. */
export interface ReportAddress {
  source: 'auto' | 'manual'
  formatted?: string
  components: AddressComponents
}

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
  address?: ReportAddress
  /** How the complaint was routed when it was submitted (department, and an officer only if verified). */
  match?: ResponsibleMatch
  /** 0-100, from category + urgency hints */
  severity: number
  photo?: string
  /**
   * Present only on reports submitted through the live-camera flow. Every field is CLIENT-PROVIDED and unverified:
   * it does not prove the photo is genuine, recent, or taken at the reported location. Legacy reports have none.
   */
  photoMeta?: PhotoMeta
  /** Anonymous per-browser id; used only to count independent reporters */
  reporterId: string
  /** Seed/demo data is always labelled as such in the UI */
  demo?: boolean
  /** Ground-truth group, only present on labelled demo data (for evaluation) */
  truthGroup?: string
}

export interface PhotoMeta {
  source: 'browser_camera_client_claim'
  capturedAtClient: string
  width: number
  height: number
  bytes: number
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
  /** Who made the assignment: an administrator's assignment counts as administrator-confirmed. */
  assignedBy?: { name: string; role: 'operator' | 'administrator' }
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
