/**
 * BMC officer directory: data model, seed records, validation, CSV import and an audit-logged store.
 *
 * IMPORTANT: in this prototype the store lives in the browser (localStorage), so the permission checks in it are
 * a convenience for the demo, NOT a security boundary. Real enforcement is in the database
 * (supabase/migrations/0002_*.sql: RLS, triggers and SECURITY DEFINER functions), which requires the app to be
 * connected to Supabase.
 */

export type VerificationStatus = 'VERIFIED_OFFICIAL' | 'UNVERIFIED' | 'NEEDS_REVIEW' | 'INACTIVE'
export const VERIFICATION_STATUSES: VerificationStatus[] = ['VERIFIED_OFFICIAL', 'UNVERIFIED', 'NEEDS_REVIEW', 'INACTIVE']

export type Department = 'WATER_WORKS' | 'SEWERAGE' | 'SEWERAGE_AND_WATER_WORKS' | 'DRAINAGE' | 'GENERAL'
export const DEPARTMENTS: Department[] = ['WATER_WORKS', 'SEWERAGE', 'SEWERAGE_AND_WATER_WORKS', 'DRAINAGE', 'GENERAL']

export const DEPARTMENT_LABELS: Record<Department, string> = {
  WATER_WORKS: 'Water Works',
  SEWERAGE: 'Sewerage',
  SEWERAGE_AND_WATER_WORKS: 'Sewage & Water Works',
  DRAINAGE: 'Drainage / Storm water',
  GENERAL: 'General civic issues',
}

export type SourceType = 'official_portal' | 'official_directory' | 'third_party_directory' | 'manual_entry' | 'csv_import'
export const SOURCE_TYPES: SourceType[] = ['official_portal', 'official_directory', 'third_party_directory', 'manual_entry', 'csv_import']

export type Role = 'citizen' | 'operator' | 'administrator'
export interface Actor {
  name: string
  role: Role
}

export interface Officer {
  officer_id: string
  full_name: string
  designation: string
  department: Department
  assigned_zones: string[]
  assigned_wards: string[]
  official_phone?: string
  official_email?: string
  office_name: string
  office_address: string
  source_url: string
  source_type: SourceType
  verification_status: VerificationStatus
  /** ISO date; only set by verify() after an administrator's review */
  verified_at: string | null
  verified_by?: string
  /** ISO date the source was last looked at (not the same as verified) */
  last_checked_at: string
  active_status: boolean
  assignment_notes: string
}

export type OfficerDraft = Omit<Officer, 'officer_id' | 'verification_status' | 'verified_at' | 'verified_by' | 'active_status'> & Partial<Pick<Officer, 'active_status'>>

export interface Zone {
  zone_id: string
  name: string
  /** Optional boundary ring as [lat, lng] points. Without it the zone can never be resolved from coordinates. */
  boundary?: [number, number][]
  notes?: string
}

export interface AuditEntry {
  at: string
  actor: string
  role: Role
  action: string
  target: string
  detail: string
}

// ---------------------------------------------------------------------------------------------------------------
// Public contacts (used as the safe fallback)
// ---------------------------------------------------------------------------------------------------------------

export const BMC_CONTACTS = {
  helpline: {
    label: 'BMC municipal helpline',
    phone: '155304',
    source_url: 'https://www.bmconline.gov.in/sap/bc/ui5_ui5/sap/zbmcprdhome/index.html',
    note: 'Number as listed for the BMC portal (the portal is a JavaScript app that could not be read automatically); also listed by a third-party directory. Confirm periodically.',
    verification: 'NEEDS_REVIEW' as VerificationStatus,
    last_checked_at: '2026-10-17',
  },
  support: {
    label: 'BMC contact support (toll free)',
    phone: '1800-233-0014',
    source_url: 'https://www.bmconline.gov.in/sap/bc/ui5_ui5/sap/zbmcprdhome/index.html',
    note: 'Same sourcing as the helpline above.',
    verification: 'NEEDS_REVIEW' as VerificationStatus,
    last_checked_at: '2026-10-17',
  },
  office: {
    label: 'Bhopal Municipal Corporation (head office)',
    address: 'Harshwardhan Complex, Mata Mandir, Bhopal, Madhya Pradesh 462001',
    phone: '+91-755-2701222',
    email: 'commoffice@bmconline.gov.in',
    source_url: 'https://bhopal.nic.in/en/public-utility/bhopal-municipal-corporation/',
    note: 'Read from the District Bhopal government directory page.',
    verification: 'VERIFIED_OFFICIAL' as VerificationStatus,
    last_checked_at: '2026-10-17',
  },
} as const

// ---------------------------------------------------------------------------------------------------------------
// Seed: the water-related records published by a THIRD-PARTY directory. All UNVERIFIED. Nothing here has been
// confirmed by BMC, and none of it is a verified zone/ward assignment.
// ---------------------------------------------------------------------------------------------------------------

const TP = 'https://www.indiacustomercare.com/bhopal-municipal-corporation-contact-details'
const HQ = 'Bhopal Municipal Corporation, Harshwardhan Complex, Mata Mandir, Bhopal, Madhya Pradesh 462001'
const NOTE = 'Listed by a third-party directory (page shows "Updated on Monday, 28 September 2026"). Not confirmed by BMC; not a verified assignment.'

export function seedOfficers(): Officer[] {
  const base = { office_address: HQ, source_url: TP, source_type: 'third_party_directory' as const, verification_status: 'UNVERIFIED' as const, verified_at: null, last_checked_at: '2026-10-17', active_status: true, assigned_wards: [] as string[] }
  return [
    { ...base, officer_id: 'bmc-seed-001', full_name: 'Shri Tanmay Vashisht Sharma', designation: 'Additional Commissioner (listed portfolio includes Water Works, Lake Conservation, Sewage)', department: 'WATER_WORKS', assigned_zones: [], official_phone: '8879421719', office_name: 'Bhopal Municipal Corporation', assignment_notes: `${NOTE} Listed portfolio is department-wide; no zone assignment published.` },
    { ...base, officer_id: 'bmc-seed-002', full_name: 'Shri Udit Garg', designation: 'In-charge Superintending Engineer, Sewage & Water Works', department: 'SEWERAGE_AND_WATER_WORKS', assigned_zones: [], official_phone: '9424499576', office_name: 'Bhopal Municipal Corporation', assignment_notes: `${NOTE} No zone assignment published.` },
    { ...base, officer_id: 'bmc-seed-003', full_name: 'Shri J.A. Khan', designation: 'Executive Engineer, Water Works Zones 01-08 and 20-21', department: 'WATER_WORKS', assigned_zones: ['01', '02', '03', '04', '05', '06', '07', '08', '20', '21'], official_phone: '9826273768', office_name: 'Bhopal Municipal Corporation, Water Works', assignment_notes: `${NOTE} Zones are as listed by that directory; BMC zone boundaries are not loaded in this app, so this cannot be matched to a location.` },
    { ...base, officer_id: 'bmc-seed-004', full_name: 'Shri H.C. Ladia', designation: 'Executive Engineer, Water Works Narmada Project, Gravity & Treatment Plant, Kolar', department: 'WATER_WORKS', assigned_zones: [], official_phone: '9425377517', office_name: 'Bhopal Municipal Corporation, Water Works (Narmada Project)', assignment_notes: `${NOTE} Project-level (bulk supply / treatment) role, not a ward-level complaint contact.` },
  ]
}

// ---------------------------------------------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------------------------------------------

const PHONE_RE = /^[+0-9][0-9 ()-]{5,19}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/

export function isHttpUrl(u: string): boolean {
  try {
    const x = new URL(u)
    return x.protocol === 'http:' || x.protocol === 'https:'
  } catch {
    return false
  }
}

const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function normalizeDraft(d: Partial<Record<keyof OfficerDraft, unknown>>): OfficerDraft {
  const list = (v: unknown) => (Array.isArray(v) ? v : String(v ?? '').split(/[;|]/)).map((x) => clean(x, 20)).filter(Boolean)
  return {
    full_name: clean(d.full_name, 120),
    designation: clean(d.designation, 240),
    department: d.department as Department,
    assigned_zones: list(d.assigned_zones),
    assigned_wards: list(d.assigned_wards),
    official_phone: clean(d.official_phone, 20) || undefined,
    official_email: clean(d.official_email, 120).toLowerCase() || undefined,
    office_name: clean(d.office_name, 160),
    office_address: clean(d.office_address, 300),
    source_url: clean(d.source_url, 400),
    source_type: d.source_type as SourceType,
    last_checked_at: clean(d.last_checked_at, 30),
    assignment_notes: clean(d.assignment_notes, 600),
    active_status: (d.active_status as boolean | undefined) ?? true,
  }
}

export function validateDraft(d: OfficerDraft): string[] {
  const e: string[] = []
  if (d.full_name.length < 2) e.push('full_name is required')
  if (!d.designation) e.push('designation is required')
  if (!DEPARTMENTS.includes(d.department)) e.push(`department must be one of ${DEPARTMENTS.join(', ')}`)
  if (d.official_phone && !PHONE_RE.test(d.official_phone)) e.push('official_phone is not a valid phone number')
  if (d.official_email && !EMAIL_RE.test(d.official_email)) e.push('official_email is not a valid email address')
  if (!d.office_name) e.push('office_name is required')
  if (!d.source_url || !isHttpUrl(d.source_url)) e.push('source_url must be an http(s) URL')
  if (!SOURCE_TYPES.includes(d.source_type)) e.push(`source_type must be one of ${SOURCE_TYPES.join(', ')}`)
  if (!d.last_checked_at || !ISO_DATE_RE.test(d.last_checked_at) || Number.isNaN(Date.parse(d.last_checked_at))) e.push('last_checked_at must be an ISO date (YYYY-MM-DD)')
  return e
}

// ---------------------------------------------------------------------------------------------------------------
// Duplicates and verification currency
// ---------------------------------------------------------------------------------------------------------------

export function normalizeName(n: string): string {
  return n.toLowerCase().replace(/\b(shri|smt|mr|mrs|ms|dr|er|ias)\b\.?/g, ' ').replace(/[^a-zऀ-ॿ ]/g, ' ').replace(/\s+/g, ' ').trim()
}
const digits = (s?: string) => (s ?? '').replace(/\D/g, '').slice(-10)

export function isDuplicate(a: Pick<Officer, 'full_name' | 'official_phone'>, b: Pick<Officer, 'full_name' | 'official_phone'>): boolean {
  const pa = digits(a.official_phone)
  return normalizeName(a.full_name) === normalizeName(b.full_name) || (pa.length >= 8 && pa === digits(b.official_phone))
}

export function findDuplicateGroups(officers: Officer[]): Officer[][] {
  const seen = new Set<string>()
  const groups: Officer[][] = []
  officers.forEach((o, i) => {
    if (seen.has(o.officer_id)) return
    const g = [o]
    for (let j = i + 1; j < officers.length; j++) if (!seen.has(officers[j].officer_id) && isDuplicate(o, officers[j])) g.push(officers[j])
    if (g.length > 1) {
      g.forEach((x) => seen.add(x.officer_id))
      groups.push(g)
    }
  })
  return groups
}

export const MAX_VERIFICATION_AGE_DAYS = 180

export function verificationAgeDays(o: Pick<Officer, 'verified_at'>, now: number): number | null {
  if (!o.verified_at) return null
  return Math.floor((now - Date.parse(o.verified_at)) / 86_400_000)
}

export type VerificationIssue = 'never_verified' | 'verification_expired' | 'needs_review' | 'no_zone_assignment' | 'inactive'

export function verificationIssues(o: Officer, now: number, maxAgeDays = MAX_VERIFICATION_AGE_DAYS): VerificationIssue[] {
  const out: VerificationIssue[] = []
  if (!o.active_status || o.verification_status === 'INACTIVE') return ['inactive']
  if (o.verification_status === 'NEEDS_REVIEW') out.push('needs_review')
  if (o.verification_status !== 'VERIFIED_OFFICIAL' || !o.verified_at) out.push('never_verified')
  else if ((verificationAgeDays(o, now) ?? 0) > maxAgeDays) out.push('verification_expired')
  if (o.assigned_zones.length === 0 && o.assigned_wards.length === 0) out.push('no_zone_assignment')
  return out
}

/** A record may be presented as "the responsible contact" only if it is active, verified and the verification is current. */
export function isCurrentlyVerified(o: Officer, now: number, maxAgeDays = MAX_VERIFICATION_AGE_DAYS): boolean {
  return o.active_status && o.verification_status === 'VERIFIED_OFFICIAL' && !!o.verified_at && (verificationAgeDays(o, now) ?? Infinity) <= maxAgeDays
}

// ---------------------------------------------------------------------------------------------------------------
// CSV import (validation only; imported rows are ALWAYS unverified)
// ---------------------------------------------------------------------------------------------------------------

export const CSV_MAX_BYTES = 200_000
export const CSV_MAX_ROWS = 500
export const CSV_COLUMNS = ['full_name', 'designation', 'department', 'assigned_zones', 'assigned_wards', 'official_phone', 'official_email', 'office_name', 'office_address', 'source_url', 'source_type', 'last_checked_at', 'assignment_notes'] as const

/** RFC 4180-style parser: quoted fields, escaped quotes, embedded commas/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cur = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++ } else q = false
      } else cur += c
    } else if (c === '"') q = true
    else if (c === ',') { row.push(cur); cur = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cur); cur = ''
      if (row.some((x) => x.trim() !== '')) rows.push(row)
      row = []
    } else cur += c
  }
  row.push(cur)
  if (row.some((x) => x.trim() !== '')) rows.push(row)
  return rows
}

export interface CsvResult {
  drafts: { line: number; draft: OfficerDraft }[]
  errors: { line: number; message: string }[]
  warnings: string[]
}

export function parseOfficerCsv(text: string): CsvResult {
  const out: CsvResult = { drafts: [], errors: [], warnings: [] }
  if (text.length > CSV_MAX_BYTES) return { ...out, errors: [{ line: 0, message: `File is larger than ${CSV_MAX_BYTES} bytes` }] }
  const rows = parseCsv(text.replace(/^﻿/, ''))
  if (rows.length === 0) return { ...out, errors: [{ line: 0, message: 'The file is empty' }] }
  const header = rows[0].map((h) => h.trim().toLowerCase())
  const missing = CSV_COLUMNS.filter((c) => !['assigned_wards', 'official_phone', 'official_email', 'office_address', 'assignment_notes'].includes(c) && !header.includes(c))
  if (missing.length) return { ...out, errors: [{ line: 1, message: `Missing required column(s): ${missing.join(', ')}` }] }
  if (header.includes('verification_status') || header.includes('verified_at') || header.includes('verified_by'))
    out.warnings.push('verification_status / verified_at / verified_by columns are ignored: imported records are always UNVERIFIED until an administrator verifies them.')
  if (rows.length - 1 > CSV_MAX_ROWS) return { ...out, errors: [{ line: 0, message: `More than ${CSV_MAX_ROWS} data rows` }] }
  rows.slice(1).forEach((r, i) => {
    const line = i + 2
    const get = (c: string) => r[header.indexOf(c)] ?? ''
    const draft = normalizeDraft({
      full_name: get('full_name'), designation: get('designation'), department: get('department').trim().toUpperCase() as Department,
      assigned_zones: get('assigned_zones'), assigned_wards: get('assigned_wards'), official_phone: get('official_phone'), official_email: get('official_email'),
      office_name: get('office_name'), office_address: get('office_address'), source_url: get('source_url'),
      source_type: (get('source_type').trim().toLowerCase() || 'csv_import') as SourceType, last_checked_at: get('last_checked_at'), assignment_notes: get('assignment_notes'),
    })
    const errs = validateDraft(draft)
    if (errs.length) errs.forEach((m) => out.errors.push({ line, message: m }))
    else out.drafts.push({ line, draft })
  })
  return out
}

export function validateBoundary(ring: unknown): string | null {
  if (!Array.isArray(ring) || ring.length < 3) return 'boundary needs at least 3 [lat, lng] points'
  for (const p of ring) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return 'every boundary point must be [lat, lng] numbers'
    if (Math.abs(p[0]) > 90 || Math.abs(p[1]) > 180) return 'boundary point out of range'
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// Store (browser demo mode; see the note at the top of this file)
// ---------------------------------------------------------------------------------------------------------------

export interface StorageLike {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
}
interface DirState {
  officers: Officer[]
  zones: Zone[]
  audit: AuditEntry[]
}
type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const KEY = 'jalrakshak.directory.v1'
const KEY_FIELDS: (keyof Officer)[] = ['full_name', 'designation', 'department', 'assigned_zones', 'assigned_wards', 'official_phone', 'official_email', 'office_name', 'office_address', 'active_status']

export function createDirectoryStore(storage?: StorageLike, clock: () => number = Date.now) {
  const mem = new Map<string, string>()
  const st: StorageLike = storage ?? { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => void mem.set(k, v) }
  let cache: DirState | null = null
  let version = 0
  const listeners = new Set<() => void>()

  const load = (): DirState => {
    if (cache) return cache
    const raw = st.getItem(KEY)
    if (raw) {
      try {
        cache = JSON.parse(raw) as DirState
        return cache
      } catch { /* reseed */ }
    }
    cache = { officers: seedOfficers(), zones: [], audit: [] }
    st.setItem(KEY, JSON.stringify(cache))
    return cache
  }
  const save = () => { st.setItem(KEY, JSON.stringify(cache)); version++; listeners.forEach((l) => l()) }
  const iso = () => new Date(clock()).toISOString()
  const day = () => iso().slice(0, 10)
  const log = (a: Actor, action: string, target: string, detail = '') => load().audit.unshift({ at: iso(), actor: a.name, role: a.role, action, target, detail })
  const deny = (a: Actor): { ok: false; error: string } | null => (a.role === 'administrator' && a.name.trim() ? null : { ok: false, error: 'Administrator access is required.' })
  const newId = () => `bmc-${clock().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  return {
    subscribe: (l: () => void) => (listeners.add(l), () => void listeners.delete(l)),
    getVersion: () => version,
    officers: () => load().officers,
    zones: () => load().zones,
    audit: () => load().audit,
    get: (id: string) => load().officers.find((o) => o.officer_id === id),

    add(input: Partial<OfficerDraft>, actor: Actor): Res<{ id: string }> {
      const d = deny(actor); if (d) return d
      const draft = normalizeDraft(input)
      const errs = validateDraft(draft); if (errs.length) return { ok: false, error: errs.join('; ') }
      const dup = load().officers.find((o) => isDuplicate(o, draft))
      if (dup) return { ok: false, error: `Possible duplicate of existing record "${dup.full_name}" (${dup.officer_id}).` }
      const officer: Officer = { ...draft, active_status: true, officer_id: newId(), verification_status: 'UNVERIFIED', verified_at: null }
      load().officers.push(officer)
      log(actor, 'officer.add', officer.officer_id, `${officer.full_name} (UNVERIFIED)`)
      save()
      return { ok: true, id: officer.officer_id }
    },

    /** Editing never changes verification_status directly. Editing a verified record's key fields sends it back for review. */
    update(id: string, patch: Partial<OfficerDraft>, actor: Actor): Res<{ demotedToReview: boolean }> {
      const d = deny(actor); if (d) return d
      const o = load().officers.find((x) => x.officer_id === id)
      if (!o) return { ok: false, error: 'Officer not found.' }
      if ('verification_status' in patch || 'verified_at' in patch || 'verified_by' in patch) return { ok: false, error: 'Verification can only be changed through the verify action.' }
      const merged = normalizeDraft({ ...o, ...patch })
      const errs = validateDraft(merged); if (errs.length) return { ok: false, error: errs.join('; ') }
      const dup = load().officers.find((x) => x.officer_id !== id && isDuplicate(x, merged))
      if (dup) return { ok: false, error: `Would duplicate "${dup.full_name}" (${dup.officer_id}).` }
      const changed = KEY_FIELDS.filter((k) => JSON.stringify(o[k]) !== JSON.stringify((merged as unknown as Officer)[k]))
      const demote = o.verification_status === 'VERIFIED_OFFICIAL' && changed.length > 0
      Object.assign(o, merged, { active_status: o.active_status })
      if (demote) o.verification_status = 'NEEDS_REVIEW'
      log(actor, 'officer.update', id, `changed: ${changed.join(', ') || 'notes/source only'}${demote ? '; verification reset to NEEDS_REVIEW' : ''}`)
      save()
      return { ok: true, demotedToReview: demote }
    },

    deactivate(id: string, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const o = load().officers.find((x) => x.officer_id === id)
      if (!o) return { ok: false, error: 'Officer not found.' }
      o.active_status = false
      o.verification_status = 'INACTIVE'
      log(actor, 'officer.deactivate', id, o.full_name)
      save()
      return { ok: true }
    },

    /** Reactivated records are never verified: they go to NEEDS_REVIEW. */
    reactivate(id: string, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const o = load().officers.find((x) => x.officer_id === id)
      if (!o) return { ok: false, error: 'Officer not found.' }
      o.active_status = true
      o.verification_status = 'NEEDS_REVIEW'
      log(actor, 'officer.reactivate', id, 'set to NEEDS_REVIEW')
      save()
      return { ok: true }
    },

    markNeedsReview(id: string, note: string, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const o = load().officers.find((x) => x.officer_id === id)
      if (!o) return { ok: false, error: 'Officer not found.' }
      if (o.verification_status === 'INACTIVE') return { ok: false, error: 'Inactive records must be reactivated first.' }
      o.verification_status = 'NEEDS_REVIEW'
      log(actor, 'officer.needs_review', id, clean(note, 300))
      save()
      return { ok: true }
    },

    /** The ONLY way to reach VERIFIED_OFFICIAL: an administrator records the source and what was checked. */
    verify(id: string, review: { source_url: string; notes: string }, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const o = load().officers.find((x) => x.officer_id === id)
      if (!o) return { ok: false, error: 'Officer not found.' }
      if (!o.active_status || o.verification_status === 'INACTIVE') return { ok: false, error: 'Inactive records cannot be verified.' }
      const url = clean(review.source_url, 400)
      if (!isHttpUrl(url)) return { ok: false, error: 'Enter the source URL used for verification (http/https).' }
      const notes = clean(review.notes, 600)
      if (notes.length < 10) return { ok: false, error: 'Describe what was confirmed and with whom (at least 10 characters).' }
      o.verification_status = 'VERIFIED_OFFICIAL'
      o.verified_at = day()
      o.verified_by = actor.name
      o.last_checked_at = day()
      o.source_url = url
      o.assignment_notes = notes
      log(actor, 'officer.verify', id, `${o.full_name}; source ${url}`)
      save()
      return { ok: true }
    },

    importCsv(text: string, actor: Actor): Res<{ added: number; skippedDuplicates: { line: number; name: string }[]; errors: { line: number; message: string }[]; warnings: string[] }> {
      const d = deny(actor); if (d) return d
      const parsed = parseOfficerCsv(text)
      let added = 0
      const skipped: { line: number; name: string }[] = []
      for (const { line, draft } of parsed.drafts) {
        if (load().officers.some((o) => isDuplicate(o, draft)) ) { skipped.push({ line, name: draft.full_name }); continue }
        load().officers.push({ ...draft, active_status: true, officer_id: newId(), verification_status: 'UNVERIFIED', verified_at: null })
        added++
      }
      log(actor, 'officer.import', 'csv', `${added} added, ${skipped.length} duplicates skipped, ${parsed.errors.length} row errors`)
      save()
      return { ok: true, added, skippedDuplicates: skipped, errors: parsed.errors, warnings: parsed.warnings }
    },

    saveZone(z: Zone, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const id = clean(z.zone_id, 20), name = clean(z.name, 80)
      if (!id || !name) return { ok: false, error: 'zone_id and name are required.' }
      if (z.boundary) { const b = validateBoundary(z.boundary); if (b) return { ok: false, error: b } }
      const zones = load().zones
      const i = zones.findIndex((x) => x.zone_id === id)
      const next: Zone = { zone_id: id, name, boundary: z.boundary, notes: clean(z.notes, 300) || undefined }
      if (i >= 0) zones[i] = next; else zones.push(next)
      log(actor, i >= 0 ? 'zone.update' : 'zone.add', id, name)
      save()
      return { ok: true }
    },

    deleteZone(id: string, actor: Actor): Res {
      const d = deny(actor); if (d) return d
      const zones = load().zones
      const i = zones.findIndex((x) => x.zone_id === id)
      if (i < 0) return { ok: false, error: 'Zone not found.' }
      zones.splice(i, 1)
      log(actor, 'zone.delete', id, '')
      save()
      return { ok: true }
    },

    reset() { cache = { officers: seedOfficers(), zones: [], audit: [] }; save() },
  }
}

export const directory = createDirectoryStore(typeof localStorage !== 'undefined' ? localStorage : undefined)
