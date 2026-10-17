import {
  BMC_CONTACTS, DEPARTMENT_LABELS, isCurrentlyVerified, MAX_VERIFICATION_AGE_DAYS, verificationAgeDays,
  type Department, type Officer, type VerificationStatus, type Zone,
} from './officers'
import type { Category } from './types'

/**
 * Deterministic complaint routing. No AI is involved in deciding who is responsible: the complaint category
 * (which may itself come from the keyword classifier and is confirmed by the citizen) maps to a department by a fixed
 * table, the location maps to a zone only through administrator-supplied boundaries, and an officer is named only
 * when exactly one ACTIVE, CURRENTLY VERIFIED officer covers that department and zone.
 */

/** Fixed category -> department table. Sewer and drainage are deliberately NOT treated as Water Works. */
export const CATEGORY_DEPARTMENT: Record<Category, Department> = {
  burst_main: 'WATER_WORKS',
  pipe_leak: 'WATER_WORKS',
  meter_valve: 'WATER_WORKS',
  supply_disruption: 'WATER_WORKS',
  contamination: 'WATER_WORKS',
  overflow: 'WATER_WORKS',
  sewer: 'SEWERAGE',
  drainage: 'DRAINAGE',
  other: 'GENERAL',
}

/** Officer departments that may answer for a complaint department (the combined "Sewage & Water Works" post covers both). */
const ELIGIBLE: Record<Department, Department[]> = {
  WATER_WORKS: ['WATER_WORKS', 'SEWERAGE_AND_WATER_WORKS'],
  SEWERAGE: ['SEWERAGE', 'SEWERAGE_AND_WATER_WORKS'],
  SEWERAGE_AND_WATER_WORKS: ['SEWERAGE_AND_WATER_WORKS'],
  DRAINAGE: ['DRAINAGE'],
  GENERAL: ['GENERAL'],
}

export function departmentFor(category: Category): Department {
  return CATEGORY_DEPARTMENT[category] ?? 'GENERAL'
}

/** Ray-casting point-in-polygon on [lat, lng] rings. */
export function pointInRing(lat: number, lng: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i]
    const [yj, xj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export type ZoneResolution = { status: 'resolved'; zone: Zone } | { status: 'none' } | { status: 'ambiguous'; zones: Zone[] } | { status: 'no_boundary_data' }

/** A zone is resolved only from administrator-supplied boundaries; with none loaded, nothing is guessed. */
export function resolveZone(lat: number, lng: number, zones: Zone[]): ZoneResolution {
  const withBoundary = zones.filter((z) => z.boundary && z.boundary.length >= 3)
  if (withBoundary.length === 0) return { status: 'no_boundary_data' }
  const hits = withBoundary.filter((z) => pointInRing(lat, lng, z.boundary!))
  if (hits.length === 1) return { status: 'resolved', zone: hits[0] }
  if (hits.length > 1) return { status: 'ambiguous', zones: hits }
  return { status: 'none' }
}

export type MatchKind = 'officer' | 'department' | 'helpline'

/** The public, citizen-safe view of an officer. Personal/unpublished fields are never copied here. */
export interface PublicOfficer {
  officer_id: string
  full_name: string
  designation: string
  zone: string
  office_name: string
  official_phone?: string
  official_email?: string
}

export interface StaffCandidate {
  officer_id: string
  full_name: string
  designation: string
  verification_status: VerificationStatus
  note: string
}

export interface ResponsibleMatch {
  kind: MatchKind
  department: Department
  departmentLabel: string
  zone: { id: string; name: string } | null
  officer: PublicOfficer | null
  /** Why this result was produced, in plain language */
  explanation: string
  /** Citizen-facing sentence (see spec wording) */
  message: string
  /** Verification status of the matched officer record, or null when no officer is named */
  verification: VerificationStatus | null
  sourceUrl: string | null
  lastVerifiedAt: string | null
  escalation: { helpline: string; support: string; office: string; officePhone: string; officeEmail: string }
  /** Staff-only: listed-but-unverified records for this department. NEVER shown to citizens. */
  staffCandidates: StaffCandidate[]
  computedAt: string
}

const escalation = {
  helpline: BMC_CONTACTS.helpline.phone,
  support: BMC_CONTACTS.support.phone,
  office: BMC_CONTACTS.office.label,
  officePhone: BMC_CONTACTS.office.phone,
  officeEmail: BMC_CONTACTS.office.email,
}

export interface MatchInput {
  category: Category
  lat: number
  lng: number
  /** Optional ward id, if a reliable source provides it. Not derived from coordinates. */
  ward?: string
}

export function matchResponsible(
  input: MatchInput,
  directory: { officers: Officer[]; zones: Zone[] },
  now: number = Date.now(),
  maxAgeDays = MAX_VERIFICATION_AGE_DAYS,
): ResponsibleMatch {
  const department = departmentFor(input.category)
  const departmentLabel = DEPARTMENT_LABELS[department]
  const eligible = directory.officers.filter((o) => ELIGIBLE[department].includes(o.department))

  const staffCandidates: StaffCandidate[] = eligible
    .filter((o) => o.active_status && !isCurrentlyVerified(o, now, maxAgeDays))
    .map((o) => ({
      officer_id: o.officer_id,
      full_name: o.full_name,
      designation: o.designation,
      verification_status: o.verification_status,
      note:
        o.verification_status === 'VERIFIED_OFFICIAL'
          ? `Verification is ${verificationAgeDays(o, now)} days old (limit ${maxAgeDays}); re-verify before relying on it.`
          : 'Listed in a directory; not confirmed by BMC.',
    }))

  const base = { department, departmentLabel, escalation, staffCandidates, computedAt: new Date(now).toISOString() }
  const helplineText = `Please contact BMC at ${BMC_CONTACTS.helpline.phone} or ${BMC_CONTACTS.support.phone}.`

  const fallback = (kind: MatchKind, explanation: string, zone: ResponsibleMatch['zone'] = null): ResponsibleMatch => ({
    ...base,
    kind,
    zone,
    officer: null,
    verification: null,
    sourceUrl: null,
    lastVerifiedAt: null,
    explanation,
    message:
      kind === 'helpline'
        ? `We could not determine which BMC department handles this complaint. ${helplineText}`
        : `Your complaint appears to concern BMC ${departmentLabel}. We could not verify the currently responsible zone-level officer. ${helplineText}`,
  })

  if (department === 'GENERAL') return fallback('helpline', 'The category does not map to a specific department, so no department or officer is suggested.')
  if (department === 'DRAINAGE' && eligible.length === 0)
    return fallback('department', 'Drainage / waterlogging complaints are routed to a drainage department, but no officer records exist for it.')

  const zr = resolveZone(input.lat, input.lng, directory.zones)
  if (zr.status === 'no_boundary_data')
    return fallback('department', `Department matched from the complaint category (${departmentLabel}). No verified zone boundaries are loaded, so the location cannot be mapped to a zone.`)
  if (zr.status === 'none') return fallback('department', `Department matched from the complaint category (${departmentLabel}). The location is outside every configured zone boundary.`)
  if (zr.status === 'ambiguous') return fallback('department', `Department matched from the complaint category (${departmentLabel}). The location falls inside more than one configured zone (${zr.zones.map((z) => z.zone_id).join(', ')}).`)

  const zone = { id: zr.zone.zone_id, name: zr.zone.name }
  const covering = eligible.filter((o) => o.assigned_zones.includes(zone.id) || (input.ward ? o.assigned_wards.includes(input.ward) : false))
  const verified = covering.filter((o) => isCurrentlyVerified(o, now, maxAgeDays))

  if (verified.length === 1) {
    const o = verified[0]
    return {
      ...base,
      kind: 'officer',
      zone,
      officer: { officer_id: o.officer_id, full_name: o.full_name, designation: o.designation, zone: `${zone.name} (zone ${zone.id})`, office_name: o.office_name, official_phone: o.official_phone, official_email: o.official_email },
      verification: o.verification_status,
      sourceUrl: o.source_url,
      lastVerifiedAt: o.verified_at,
      explanation: `Category "${input.category}" maps to ${departmentLabel}; the location is inside zone ${zone.id}; ${o.full_name} is the only active, currently verified ${departmentLabel} officer assigned to that zone.`,
      message: `Potential responsible contact: ${o.full_name}. Designation: ${o.designation}. Assigned area: ${zone.name} (zone ${zone.id}). Please confirm assignment with the municipal department.`,
    }
  }
  if (verified.length > 1)
    return fallback('department', `Zone ${zone.id} matched, but ${verified.length} verified officers cover it, so no single officer is named.`, zone)
  if (covering.length > 0)
    return fallback('department', `Zone ${zone.id} matched, but the officer record(s) for it are not currently verified (unverified, needs review, expired or inactive), so none is named.`, zone)
  return fallback('department', `Zone ${zone.id} matched, but no officer assignment is recorded for ${departmentLabel} in that zone.`, zone)
}
