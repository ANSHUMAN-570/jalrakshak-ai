import { useMemo, useState } from 'react'
import { useSession } from '../auth'
import { Card } from '../components/ui'
import { useDirectoryVersion } from '../hooks'
import {
  CSV_COLUMNS, DEPARTMENT_LABELS, DEPARTMENTS, directory, findDuplicateGroups, MAX_VERIFICATION_AGE_DAYS, parseOfficerCsv, SOURCE_TYPES,
  validateBoundary, verificationIssues, type Officer, type OfficerDraft, type VerificationIssue, type VerificationStatus,
} from '../lib/officers'

const STATUS_STYLE: Record<VerificationStatus, string> = {
  VERIFIED_OFFICIAL: 'bg-ok-bg text-ok-fg',
  UNVERIFIED: 'bg-warn-bg text-warn-fg',
  NEEDS_REVIEW: 'bg-info-bg text-info-fg',
  INACTIVE: 'bg-elevated text-muted',
}
const ISSUE_LABEL: Record<VerificationIssue, string> = {
  never_verified: 'never verified',
  verification_expired: `verification older than ${MAX_VERIFICATION_AGE_DAYS} days`,
  needs_review: 'needs review',
  no_zone_assignment: 'no zone assignment',
  inactive: 'inactive',
}
const input = 'w-full rounded border p-2 text-sm'
const btn = 'rounded border border-line px-3 py-1.5 text-sm text-fg hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent'
const btnPrimary = 'rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

const emptyDraft = (): Record<keyof OfficerDraft, string> => ({
  full_name: '', designation: '', department: 'WATER_WORKS', assigned_zones: '', assigned_wards: '', official_phone: '', official_email: '',
  office_name: 'Bhopal Municipal Corporation', office_address: '', source_url: '', source_type: 'manual_entry', last_checked_at: new Date().toISOString().slice(0, 10),
  assignment_notes: '', active_status: 'true',
})

export default function AdminPage() {
  useDirectoryVersion()
  const { actor } = useSession()
  const now = Date.now()
  const officers = directory.officers()
  const zones = directory.zones()
  const [filter, setFilter] = useState<'all' | VerificationStatus | 'attention'>('all')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const say = (r: { ok: boolean; error?: string }, ok: string) => setMsg(r.ok ? { ok: true, text: ok } : { ok: false, text: r.error ?? 'Failed' })

  const dupIds = useMemo(() => new Set(findDuplicateGroups(officers).flat().map((o) => o.officer_id)), [officers])
  const rows = officers.filter((o) => {
    const issues = verificationIssues(o, now)
    if (filter === 'attention' ? issues.length === 0 : filter !== 'all' && o.verification_status !== filter) return false
    const q = query.trim().toLowerCase()
    return !q || `${o.full_name} ${o.designation} ${o.assigned_zones.join(' ')}`.toLowerCase().includes(q)
  })
  const counts = (['VERIFIED_OFFICIAL', 'UNVERIFIED', 'NEEDS_REVIEW', 'INACTIVE'] as VerificationStatus[]).map((s) => [s, officers.filter((o) => o.verification_status === s).length] as const)

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Officer directory administration</h1>
      <p className="rounded bg-warn-bg p-2 text-xs text-warn-fg">
        Demo mode: changes are stored in this browser only and the permission checks here are simulated. Records are never auto-verified: only the Verify action, with a source and a review note, marks a record VERIFIED_OFFICIAL, and editing a verified record sends it back for review.
      </p>
      <div className="flex flex-wrap gap-2 text-sm" data-testid="dir-counts">
        {counts.map(([s, n]) => (
          <span key={s} className={`rounded px-2 py-1 ${STATUS_STYLE[s]}`}>{s}: {n}</span>
        ))}
        {dupIds.size > 0 && <span className="rounded bg-danger-bg px-2 py-1 text-danger-fg">possible duplicates: {dupIds.size}</span>}
      </div>

      {msg && <p role="status" className={`rounded p-2 text-sm ${msg.ok ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg'}`}>{msg.text}</p>}

      <Card title="Officers">
        <div className="mb-3 flex flex-wrap gap-2">
          <input type="search" aria-label="Search officers" className={`${input} basis-full sm:flex-1 sm:basis-48`} placeholder="Search name, designation or zone" value={query} onChange={(e) => setQuery(e.target.value)} />
          <select aria-label="Filter officers" className="rounded border p-2 text-sm" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All records</option>
            <option value="attention">Needs attention (unverified, expired, no zone)</option>
            {(['VERIFIED_OFFICIAL', 'UNVERIFIED', 'NEEDS_REVIEW', 'INACTIVE'] as VerificationStatus[]).map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <button className={btnPrimary} onClick={() => { setEditing('new'); setMsg(null) }}>Add officer</button>
        </div>

        {editing && <OfficerForm key={editing} id={editing} onDone={(m) => { setEditing(null); if (m) setMsg(m) }} />}

        <ul className="divide-y" data-testid="officer-list">
          {rows.map((o) => {
            const issues = verificationIssues(o, now)
            return (
              <li key={o.officer_id} className="py-3" data-testid="officer-row" data-status={o.verification_status}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium">{o.full_name} <span className={`ml-1 rounded px-2 py-0.5 text-xs ${STATUS_STYLE[o.verification_status]}`}>{o.verification_status}</span></p>
                    <p className="text-sm text-muted">{o.designation}</p>
                    <p className="text-xs text-muted">
                      {DEPARTMENT_LABELS[o.department]} · zones: {o.assigned_zones.join(', ') || 'none recorded'}
                      {o.official_phone && <> · {o.official_phone}</>}
                    </p>
                    <p className="text-xs text-muted">
                      Source: <a className="text-accent-text underline" href={o.source_url} target="_blank" rel="noopener noreferrer">{o.source_type.replace(/_/g, ' ')}</a> · last checked {o.last_checked_at} ·{' '}
                      {o.verified_at ? `verified ${o.verified_at}${o.verified_by ? ` by ${o.verified_by}` : ''}` : 'never verified'}
                    </p>
                    {o.assignment_notes && <p className="mt-1 text-xs text-muted">{o.assignment_notes}</p>}
                    <p className="mt-1 flex flex-wrap gap-1">
                      {issues.map((i) => <span key={i} className="rounded bg-warn-bg px-1.5 py-0.5 text-[11px] text-warn-fg">{ISSUE_LABEL[i]}</span>)}
                      {dupIds.has(o.officer_id) && <span className="rounded bg-danger-bg px-1.5 py-0.5 text-[11px] text-danger-fg">possible duplicate</span>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button className={btn} onClick={() => { setEditing(o.officer_id); setMsg(null) }}>Edit</button>
                    {o.active_status && o.verification_status !== 'VERIFIED_OFFICIAL' && <button className={btn} onClick={() => { setVerifying(o.officer_id); setMsg(null) }}>Verify…</button>}
                    {o.verification_status === 'VERIFIED_OFFICIAL' && <button className={btn} onClick={() => say(directory.markNeedsReview(o.officer_id, 'Flagged for re-check', actor), 'Marked as needs review')}>Needs review</button>}
                    {o.active_status ? (
                      <button className={btn} onClick={() => say(directory.deactivate(o.officer_id, actor), 'Record deactivated')}>Deactivate</button>
                    ) : (
                      <button className={btn} onClick={() => say(directory.reactivate(o.officer_id, actor), 'Reactivated; needs review before it can be verified again')}>Reactivate</button>
                    )}
                  </div>
                </div>
                {verifying === o.officer_id && <VerifyForm officer={o} onDone={(m) => { setVerifying(null); if (m) setMsg(m) }} />}
              </li>
            )
          })}
          {rows.length === 0 && <li className="py-3 text-sm text-muted">No records match.</li>}
        </ul>
      </Card>

      <CsvImport onDone={setMsg} />
      <ZonesCard onDone={setMsg} zones={zones} />

      <Card title="Audit log">
        <div className="max-h-80 overflow-auto">
          <table className="w-full text-left text-xs" data-testid="audit-table">
            <thead className="text-muted"><tr><th className="py-1 pr-2">When</th><th className="pr-2">Who</th><th className="pr-2">Action</th><th className="pr-2">Target</th><th>Detail</th></tr></thead>
            <tbody>
              {directory.audit().slice(0, 100).map((a, i) => (
                <tr key={i} className="border-t align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{a.at.replace('T', ' ').slice(0, 19)}</td>
                  <td className="pr-2">{a.actor} ({a.role})</td>
                  <td className="pr-2">{a.action}</td>
                  <td className="pr-2 font-mono">{a.target}</td>
                  <td>{a.detail}</td>
                </tr>
              ))}
              {directory.audit().length === 0 && <tr><td colSpan={5} className="py-2 text-muted">No changes recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}

function OfficerForm({ id, onDone }: { id: string; onDone: (m?: { ok: boolean; text: string }) => void }) {
  const { actor } = useSession()
  const existing = id === 'new' ? null : directory.get(id)
  // Only the editable fields go into the form. Verification fields are deliberately NOT part of it:
  // they can only change through the Verify action.
  const [f, setF] = useState<Record<keyof OfficerDraft, string>>(() => {
    const base = emptyDraft()
    if (!existing) return base
    const text = (v: unknown) => (Array.isArray(v) ? v.join(';') : v === undefined || v === null ? '' : String(v))
    const out = { ...base }
    for (const k of Object.keys(base) as (keyof OfficerDraft)[]) out[k] = text(existing[k])
    return out
  })
  const [error, setError] = useState('')
  const set = (k: keyof OfficerDraft) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })
  const field = (k: keyof OfficerDraft, label: string, extra = '') => (
    <label className={`block text-sm ${extra}`}>
      <span className="font-medium">{label}</span>
      <input className={`${input} mt-1`} value={f[k]} onChange={set(k)} />
    </label>
  )
  const submit = () => {
    const draft = { ...f, assigned_zones: f.assigned_zones, assigned_wards: f.assigned_wards } as unknown as Partial<OfficerDraft>
    const r = existing ? directory.update(existing.officer_id, draft, actor) : directory.add(draft, actor)
    if (!r.ok) return setError(r.error)
    const demoted = existing && 'demotedToReview' in r && r.demotedToReview
    onDone({ ok: true, text: existing ? `Saved.${demoted ? ' Verification was reset to NEEDS_REVIEW because key fields changed.' : ''}` : 'Officer added as UNVERIFIED.' })
  }
  return (
    <div className="mb-4 rounded border border-line bg-elevated p-3" data-testid="officer-form">
      <h3 className="mb-2 text-sm font-semibold">{existing ? `Edit ${existing.full_name}` : 'Add officer'}</h3>
      {existing?.verification_status === 'VERIFIED_OFFICIAL' && <p className="mb-2 rounded bg-warn-bg p-2 text-xs text-warn-fg">This record is verified. Changing the name, designation, department, zones, contact details or office sends it back to NEEDS_REVIEW.</p>}
      <div className="grid gap-2 sm:grid-cols-2">
        {field('full_name', 'Full name')}
        {field('designation', 'Designation', 'sm:col-span-2')}
        <label className="block text-sm"><span className="font-medium">Department</span>
          <select className={`${input} mt-1`} value={f.department} onChange={set('department')}>{DEPARTMENTS.map((d) => <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>)}</select>
        </label>
        {field('assigned_zones', 'Assigned zones (separate with ;)')}
        {field('assigned_wards', 'Assigned wards (separate with ;)')}
        {field('official_phone', 'Official phone')}
        {field('official_email', 'Official email (if published)')}
        {field('office_name', 'Office name')}
        {field('office_address', 'Office address', 'sm:col-span-2')}
        {field('source_url', 'Source URL (https://…)', 'sm:col-span-2')}
        <label className="block text-sm"><span className="font-medium">Source type</span>
          <select className={`${input} mt-1`} value={f.source_type} onChange={set('source_type')}>{SOURCE_TYPES.map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select>
        </label>
        {field('last_checked_at', 'Source last checked (YYYY-MM-DD)')}
        <label className="block text-sm sm:col-span-2"><span className="font-medium">Assignment notes</span>
          <textarea className={`${input} mt-1 h-16`} value={f.assignment_notes} onChange={set('assignment_notes')} />
        </label>
      </div>
      {error && <p role="alert" className="mt-2 rounded bg-danger-bg p-2 text-sm text-danger-fg">{error}</p>}
      <div className="mt-3 flex gap-2"><button className={btnPrimary} onClick={submit}>Save</button><button className={btn} onClick={() => onDone()}>Cancel</button></div>
    </div>
  )
}

function VerifyForm({ officer, onDone }: { officer: Officer; onDone: (m?: { ok: boolean; text: string }) => void }) {
  const { actor } = useSession()
  const [url, setUrl] = useState(officer.source_type.startsWith('official') ? officer.source_url : '')
  const [notes, setNotes] = useState('')
  const [ok, setOk] = useState(false)
  const [error, setError] = useState('')
  return (
    <div className="mt-2 rounded border border-line bg-elevated p-3" data-testid="verify-form">
      <p className="text-sm font-medium">Verify {officer.full_name}</p>
      <p className="text-xs text-muted">Only mark a record verified after confirming the name, designation and zone assignment with BMC or an official BMC publication. Do not rely on a third-party directory alone.</p>
      <input aria-label="Verification source URL" className={`${input} mt-2`} placeholder="Official source URL used (https://…)" value={url} onChange={(e) => setUrl(e.target.value)} />
      <textarea aria-label="Verification notes" className={`${input} mt-2 h-16`} placeholder="What was confirmed, and with whom / where" value={notes} onChange={(e) => setNotes(e.target.value)} />
      <label className="mt-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={ok} onChange={(e) => setOk(e.target.checked)} /> I confirm this was checked against the source above and the record is accurate today.</label>
      {error && <p role="alert" className="mt-2 rounded bg-danger-bg p-2 text-sm text-danger-fg">{error}</p>}
      <div className="mt-2 flex gap-2">
        <button className={btnPrimary} disabled={!ok} onClick={() => { const r = directory.verify(officer.officer_id, { source_url: url, notes }, actor); if (!r.ok) return setError(r.error); onDone({ ok: true, text: `${officer.full_name} marked VERIFIED_OFFICIAL.` }) }}>Mark as verified</button>
        <button className={btn} onClick={() => onDone()}>Cancel</button>
      </div>
    </div>
  )
}

function CsvImport({ onDone }: { onDone: (m: { ok: boolean; text: string }) => void }) {
  const { actor } = useSession()
  const [text, setText] = useState('')
  const parsed = useMemo(() => (text.trim() ? parseOfficerCsv(text) : null), [text])
  const template = `${CSV_COLUMNS.join(',')}\n`
  return (
    <Card title="Import officers from CSV">
      <p className="text-xs text-muted">Required columns: {CSV_COLUMNS.filter((c) => !['assigned_wards', 'official_phone', 'official_email', 'office_address', 'assignment_notes'].includes(c)).join(', ')}. Separate several zones with ;. Imported records are <strong>always UNVERIFIED</strong>; any verification columns are ignored. Max 500 rows / 200 KB.</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <label className="text-sm">CSV file <input aria-label="CSV file" type="file" accept=".csv,text/csv" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(f.size > 200_000 ? '' : await f.text()) }} /></label>
        <a className="text-sm text-accent-text underline" download="officers-template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(template)}`}>Download template</a>
      </div>
      <textarea aria-label="CSV text" className={`${input} mt-2 h-24 font-mono text-xs`} placeholder="…or paste CSV here" value={text} onChange={(e) => setText(e.target.value)} />
      {parsed && (
        <div className="mt-2 text-sm" data-testid="csv-preview">
          <p>{parsed.drafts.length} valid row(s), {parsed.errors.length} error(s).</p>
          {parsed.warnings.map((w) => <p key={w} className="text-xs text-warn-fg">{w}</p>)}
          {parsed.errors.length > 0 && <ul className="mt-1 list-disc pl-5 text-xs text-danger-fg">{parsed.errors.slice(0, 10).map((e, i) => <li key={i}>line {e.line}: {e.message}</li>)}</ul>}
          <button className={`${btnPrimary} mt-2`} disabled={parsed.drafts.length === 0} onClick={() => {
            const r = directory.importCsv(text, actor)
            if (!r.ok) return onDone({ ok: false, text: r.error })
            onDone({ ok: true, text: `Imported ${r.added} record(s) as UNVERIFIED; ${r.skippedDuplicates.length} duplicate(s) skipped; ${r.errors.length} row error(s).` })
            setText('')
          }}>Import {parsed.drafts.length} valid row(s) as UNVERIFIED</button>
        </div>
      )}
    </Card>
  )
}

function ZonesCard({ zones, onDone }: { zones: ReturnType<typeof directory.zones>; onDone: (m: { ok: boolean; text: string }) => void }) {
  const { actor } = useSession()
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [boundary, setBoundary] = useState('')
  const [error, setError] = useState('')
  const save = () => {
    let ring: [number, number][] | undefined
    if (boundary.trim()) {
      try {
        const parsed: unknown = JSON.parse(boundary)
        const bad = validateBoundary(parsed)
        if (bad) return setError(bad)
        ring = parsed as [number, number][]
      } catch {
        return setError('Boundary must be JSON like [[23.25,77.40],[23.25,77.45],[23.30,77.45]] ([lat, lng] points).')
      }
    }
    const r = directory.saveZone({ zone_id: id, name, boundary: ring }, actor)
    if (!r.ok) return setError(r.error)
    setError(''); setId(''); setName(''); setBoundary('')
    onDone({ ok: true, text: `Zone ${id} saved.` })
  }
  return (
    <Card title="Zones">
      <p className="text-xs text-muted">A complaint can be matched to a zone only from a boundary entered here. No BMC zone boundaries are bundled with the app, so until an administrator adds verified boundaries every complaint falls back to the department and BMC helplines.</p>
      <ul className="mt-2 text-sm" data-testid="zone-list">
        {zones.map((z) => (
          <li key={z.zone_id} className="flex items-center justify-between border-t py-1">
            <span>Zone {z.zone_id}: {z.name} <span className="text-xs text-muted">({z.boundary ? `${z.boundary.length} boundary points` : 'no boundary'})</span></span>
            <button className={btn} onClick={() => onDone(directory.deleteZone(z.zone_id, actor).ok ? { ok: true, text: `Zone ${z.zone_id} deleted.` } : { ok: false, text: 'Could not delete.' })}>Delete</button>
          </li>
        ))}
        {zones.length === 0 && <li className="text-muted">No zones configured.</li>}
      </ul>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <input aria-label="Zone id" className={input} placeholder="Zone id (e.g. 01)" value={id} onChange={(e) => setId(e.target.value)} />
        <input aria-label="Zone name" className={input} placeholder="Zone name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea aria-label="Zone boundary" className={`${input} h-16 font-mono text-xs sm:col-span-2`} placeholder="Boundary (optional JSON): [[lat,lng],[lat,lng],[lat,lng],…]" value={boundary} onChange={(e) => setBoundary(e.target.value)} />
      </div>
      {error && <p role="alert" className="mt-2 rounded bg-danger-bg p-2 text-sm text-danger-fg">{error}</p>}
      <button className={`${btnPrimary} mt-2`} onClick={save}>Save zone</button>
    </Card>
  )
}
