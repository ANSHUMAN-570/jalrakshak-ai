import { useMemo, useState } from 'react'
import { useSession } from '../auth'
import { LazyIncidentMap } from '../components/LazyMaps'
import ResponsibleContact from '../components/ResponsibleContact'
import { Card, DemoTag, ScorePill, StatusBadge, VerifyBadge } from '../components/ui'
import { fmtTime, resizePhoto, useDirectoryVersion, useStoreVersion } from '../hooks'
import { incidentLocation, reportLocation } from '../lib/address'
import { CATEGORY_LABELS } from '../lib/classify'
import { DEPARTMENT_LABELS, directory, type Actor, type Department } from '../lib/officers'
import { computePriority } from '../lib/priority'
import { checklist, isOpen, NEXT_STATUSES, verification } from '../lib/rules'
import { departmentFor, matchResponsible } from '../lib/routing'
import { store } from '../lib/store'
import type { Category, EvidenceKind, Incident, Report, Status } from '../lib/types'

const BANDS = ['all', 'high', 'medium', 'low'] as const
type Scope = 'visible' | 'mine' | 'unassigned'

const CHECK_LABEL = {
  before: 'Before / citizen photo on file',
  note: 'Inspection note recorded',
  after: 'After-repair photo attached',
  verifier: 'Verifier named at closure',
} as const

const sel = 'rounded border p-2 text-sm'

/** Small label that says where a piece of information comes from. */
function Source({ kind }: { kind: 'citizen' | 'system' | 'admin' | 'verified' | 'self' }) {
  const m = {
    citizen: ['Citizen-reported', 'bg-elevated text-fg'],
    system: ['System recommendation', 'bg-info-bg text-info-fg'],
    admin: ['Administrator-confirmed', 'bg-ok-bg text-ok-fg'],
    self: ['Self-assigned, not administrator-confirmed', 'bg-warn-bg text-warn-fg'],
    verified: ['Verified evidence', 'bg-ok-bg text-ok-fg'],
  }[kind]
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${m[1]}`}>{m[0]}</span>
}

export default function DashboardPage() {
  useStoreVersion()
  useDirectoryVersion()
  const { actor, role } = useSession()
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | Status>('all')
  const [bandFilter, setBandFilter] = useState<(typeof BANDS)[number]>('all')
  const [scope, setScope] = useState<Scope>('visible')
  const [dept, setDept] = useState<'all' | Department>('all')
  const [zone, setZone] = useState<string>('all')
  const [category, setCategory] = useState<'all' | Category>('all')
  const now = Date.now()

  const ranked = useMemo(
    () =>
      store
        .incidentsFor(actor)
        .map((inc) => ({ inc, p: computePriority(inc, now), dept: departmentFor(inc.category), zone: inc.reports[0].match?.zone?.id ?? null }))
        .sort((a, b) => Number(isOpen(b.inc.state.status)) - Number(isOpen(a.inc.state.status)) || b.p.score - a.p.score),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getVersion(), actor.name, actor.role],
  )
  const zones = useMemo(() => [...new Set(ranked.map((r) => r.zone).filter((z): z is string => !!z))].sort(), [ranked])
  const current = ranked.find((r) => r.inc.id === selected) ?? null

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return ranked.filter(({ inc, p, dept: d, zone: z }) => {
      if (scope === 'mine' && inc.state.assignee !== actor.name) return false
      if (scope === 'unassigned' && inc.state.assignee) return false
      if (dept !== 'all' && d !== dept) return false
      if (zone !== 'all' && (zone === 'none' ? z !== null : z !== zone)) return false
      if (category !== 'all' && inc.category !== category) return false
      if (statusFilter === 'open' ? !isOpen(inc.state.status) : statusFilter !== 'all' && inc.state.status !== statusFilter) return false
      if (bandFilter !== 'all' && p.band !== bandFilter) return false
      if (!q) return true
      const loc = incidentLocation(inc)
      const hay = [CATEGORY_LABELS[inc.category].en, loc.address ?? '', ...inc.reports.flatMap((r) => [r.caseId, r.description])].join(' ').toLowerCase()
      return hay.includes(q)
    })
  }, [ranked, query, statusFilter, bandFilter, scope, dept, zone, category, actor.name])

  // Stable pins array so the memoised map only re-renders when incidents or the filter change.
  const pins = useMemo(
    () =>
      visible.map(({ inc, p }) => ({
        id: inc.id,
        lat: inc.centroid.lat,
        lng: inc.centroid.lng,
        band: p.band,
        reports: inc.reports.length,
        closed: !isOpen(inc.state.status),
        label: `${CATEGORY_LABELS[inc.category].en} - score ${p.score} - ${inc.reports.length} report(s)`,
        address: incidentLocation(inc).address ?? `Address unavailable (${incidentLocation(inc).coords})`,
      })),
    [visible],
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Operator dashboard</h1>
        <p className="text-sm text-muted" data-testid="dash-scope-note">
          {role === 'administrator' ? 'Administrator view: all complaints.' : 'Operator view: complaints assigned to you and unassigned complaints.'}
        </p>
      </div>
      <p className="rounded bg-warn-bg p-2 text-xs text-warn-fg">
        Priority and routing are rule-based suggestions to help order work. They are not proof that a leak exists and not a confirmed assignment. Access control in this build is simulated in the browser (demo mode).
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <LazyIncidentMap selected={selected} onSelect={setSelected} pins={pins} />
          <p className="text-xs text-muted">Marker size = number of grouped reports. Red/amber/green = priority band; grey = resolved.</p>
          <Card title="Ranked investigation queue">
            <div className="mb-3 flex flex-wrap gap-2">
              <input
                type="search"
                aria-label="Search incidents"
                className="min-w-0 basis-full rounded border p-2 text-sm sm:flex-1 sm:basis-48"
                placeholder="Search case ID, address or description"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select aria-label="Filter by assignment" className={sel} value={scope} onChange={(e) => setScope(e.target.value as Scope)}>
                <option value="visible">{role === 'administrator' ? 'All complaints' : 'Mine + unassigned'}</option>
                <option value="mine">Assigned to me</option>
                <option value="unassigned">Unassigned</option>
              </select>
              <select aria-label="Filter by department" className={sel} value={dept} onChange={(e) => setDept(e.target.value as typeof dept)}>
                <option value="all">All departments</option>
                {(['WATER_WORKS', 'SEWERAGE', 'DRAINAGE', 'GENERAL'] as Department[]).map((d) => (
                  <option key={d} value={d}>{DEPARTMENT_LABELS[d]}</option>
                ))}
              </select>
              <select aria-label="Filter by zone" className={sel} value={zone} onChange={(e) => setZone(e.target.value)}>
                <option value="all">All zones</option>
                <option value="none">Zone unresolved</option>
                {zones.map((z) => (
                  <option key={z} value={z}>Zone {z}</option>
                ))}
              </select>
              <select aria-label="Filter by category" className={sel} value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                <option value="all">All categories</option>
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c].en}</option>
                ))}
              </select>
              <select aria-label="Filter by status" className={sel} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
                <option value="all">All statuses</option>
                <option value="open">Open only</option>
                {(Object.keys(NEXT_STATUSES) as Status[]).map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              <select aria-label="Filter by priority" className={sel} value={bandFilter} onChange={(e) => setBandFilter(e.target.value as typeof bandFilter)}>
                {BANDS.map((b) => (
                  <option key={b} value={b}>{b === 'all' ? 'All priorities' : `${b} priority`}</option>
                ))}
              </select>
            </div>
            {visible.length === 0 && (
              <p className="rounded bg-canvas p-3 text-sm text-muted" data-testid="queue-empty">
                {ranked.length === 0 ? 'No incidents yet. Reports submitted by citizens will appear here.' : 'No incidents match these filters.'}
              </p>
            )}
            <ol className="divide-y">
              {visible.map(({ inc, p, dept: d }, i) => (
                <li key={inc.id}>
                  <button
                    onClick={() => setSelected(inc.id)}
                    className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 p-2 text-left hover:bg-canvas ${inc.id === selected ? 'bg-info-bg' : ''}`}
                  >
                    <span className="w-5 text-sm text-muted">{i + 1}</span>
                    <ScorePill score={p.score} band={p.band} />
                    <span className="min-w-[10rem] flex-1">
                      <span className="block text-sm font-medium">{CATEGORY_LABELS[inc.category].en}</span>
                      <span className="block text-xs text-fg" data-testid="queue-address">{incidentLocation(inc).primary}</span>
                      <span className="block text-xs text-muted">
                        {DEPARTMENT_LABELS[d]} · {inc.state.assignee ? `assigned: ${inc.state.assignee}` : 'unassigned'} · {inc.reports.length} report(s)
                        {inc.reports[0].demo && ' '}
                        {inc.reports[0].demo && <DemoTag />}
                      </span>
                    </span>
                    <span className="ml-14 flex flex-row flex-wrap items-center gap-1 sm:ml-0 sm:flex-col sm:items-end">
                      <StatusBadge status={inc.state.status} />
                      <VerifyBadge v={verification(inc)} />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <div className="lg:col-span-2">
          {current ? <CaseDetail key={current.inc.id} inc={current.inc} actor={actor} /> : <Card><p className="text-sm text-muted">Select an incident on the map or in the queue.</p></Card>}
        </div>
      </div>
    </div>
  )
}

function PhotoCard({ r }: { r: Report }) {
  const [big, setBig] = useState(false)
  if (!r.photo) return <p className="text-xs text-muted">No photo (report predates the live-photo requirement).</p>
  return (
    <figure className={big ? 'w-full' : 'w-24 shrink-0'}>
      <button type="button" onClick={() => setBig((b) => !b)} aria-label={big ? 'Shrink photo' : 'Enlarge photo'} className="block w-full">
        <img src={r.photo} alt={`Photo submitted with report ${r.caseId}`} width={96} height={64} loading="lazy" decoding="async" className={`rounded object-cover ${big ? 'h-auto w-full' : 'h-16 w-24'}`} />
      </button>
      <figcaption className="mt-1 text-[11px] leading-tight text-muted">
        {r.photoMeta
          ? `Live camera photo. Capture time ${fmtTime(Date.parse(r.photoMeta.capturedAtClient))} is reported by the citizen's device and is not verified.`
          : 'Legacy photo (submitted before live capture was required).'}
      </figcaption>
    </figure>
  )
}

function CaseDetail({ inc, actor }: { inc: Incident; actor: Actor }) {
  useDirectoryVersion()
  const p = computePriority(inc)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState(inc.state.assignee ?? '')
  const [verifier, setVerifier] = useState('')
  const report = (r: { ok: boolean; error?: string }, okText: string) => setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Failed' })

  const mine = actor.role === 'administrator' || (actor.role === 'operator' && inc.state.assignee === actor.name)
  const snapshot = inc.reports[0].match
  const live = matchResponsible({ category: inc.category, lat: inc.centroid.lat, lng: inc.centroid.lng }, { officers: directory.officers(), zones: directory.zones() })
  const changed = !!snapshot && (snapshot.kind !== live.kind || snapshot.officer?.officer_id !== live.officer?.officer_id)

  const upload = async (kind: EvidenceKind, f?: File) => {
    if (!f) return
    try {
      const photo = await resizePhoto(f)
      report(store.addEvidence(inc.id, { kind, photo }, actor), `${kind} photo attached`)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const checks = checklist(inc)
  const next = NEXT_STATUSES[inc.state.status]
  const assignedKind = !inc.state.assignee ? null : inc.state.assignedBy?.role === 'administrator' ? 'admin' : 'self'

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-center gap-3">
          <ScorePill score={p.score} band={p.band} />
          <div>
            <h2 className="font-semibold">{CATEGORY_LABELS[inc.category].en}</h2>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={inc.state.status} />
              <VerifyBadge v={verification(inc)} />
              {inc.reports[0].demo && <DemoTag />}
            </div>
          </div>
        </div>
        <p className="mt-3 text-sm" data-testid="detail-address">
          <span className="font-medium">Location: </span>
          {incidentLocation(inc).primary}
          <span className="block font-mono text-xs text-muted">{incidentLocation(inc).coords}</span>
          <Source kind="citizen" />
        </p>
        <p className="mt-2 text-sm" data-testid="detail-assignment">
          <span className="font-medium">Assignment: </span>
          {inc.state.assignee ?? 'Unassigned'} {assignedKind && <Source kind={assignedKind} />}
        </p>
        <h3 className="mt-4 flex flex-wrap items-center gap-2 text-sm font-semibold">Why this priority (P = 0.35S + 0.30E + 0.20R + 0.15C) <Source kind="system" /></h3>
        <table className="mt-1 w-full text-xs">
          <tbody>
            {p.factors.map((f) => (
              <tr key={f.key} className="border-t align-top">
                <td className="py-1 pr-2 font-medium">{f.label} <span className="text-muted">x{f.weight}</span></td>
                <td className="py-1 pr-2 text-right tabular-nums">{f.value}</td>
                <td className="py-1 pr-2 text-right tabular-nums">+{f.contribution}</td>
                <td className="py-1 text-muted">{f.reason}</td>
              </tr>
            ))}
            <tr className="border-t font-semibold"><td colSpan={2}>Total</td><td className="text-right">{p.score}</td><td /></tr>
          </tbody>
        </table>
      </Card>

      <ResponsibleContact match={live} staff />
      {changed && (
        <p className="rounded bg-info-bg p-2 text-xs text-info-fg" data-testid="routing-changed">
          The directory has changed since this complaint was submitted. At submission the suggestion was: {snapshot!.officer ? `${snapshot!.officer.full_name} (verified)` : `${snapshot!.departmentLabel} department only`}. The panel above shows the current suggestion.
        </p>
      )}

      <Card title={`Grouped reports (${inc.reports.length})`}>
        <ul className="space-y-3 text-sm">
          {inc.reports.map((r) => (
            <li key={r.id} className="flex flex-wrap gap-3">
              <PhotoCard r={r} />
              <div className="min-w-0 flex-1">
                <p><span className="font-mono text-xs">{r.caseId}</span> <span className="text-xs text-muted">{fmtTime(r.createdAt)} - {r.lang.toUpperCase()} - {r.locationSource === 'gps' ? `GPS ±${r.accuracyM ?? '?'} m` : 'map pin'}</span> <Source kind="citizen" /></p>
                <p className="break-words">{r.description}</p>
                <p className="text-xs text-muted">{reportLocation(r).primary}{reportLocation(r).source ? ` (${reportLocation(r).source === 'manual' ? 'entered manually' : 'detected automatically'})` : ` - ${reportLocation(r).coords}`}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Case actions">
        {!mine && actor.role === 'operator' && (
          <p className="mb-2 rounded bg-warn-bg p-2 text-xs text-warn-fg">You can view this case. Claim it to record inspections, evidence and status changes.</p>
        )}
        <div className="mb-3 flex flex-wrap gap-2">
          {actor.role === 'operator' && !inc.state.assignee && (
            <button className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-on-accent" onClick={() => report(store.assign(inc.id, actor.name, actor), 'Case assigned to you')}>Assign to me</button>
          )}
          {actor.role === 'administrator' && (
            <>
              <input aria-label="Assign to" className="min-w-0 flex-1 rounded border p-1 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assign to (operator name)" />
              <button className="rounded border px-3 text-sm" onClick={() => report(store.assign(inc.id, assignee, actor), 'Assigned (administrator-confirmed)')}>Assign</button>
            </>
          )}
        </div>

        <h4 className="flex items-center gap-2 text-sm font-medium">Evidence <Source kind="verified" /></h4>
        <textarea aria-label="Inspection note" className="mt-1 h-16 w-full rounded border p-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Inspection note (what was found on site)" disabled={!mine} />
        <button
          className="mb-2 rounded border px-3 py-1 text-sm disabled:opacity-50"
          disabled={!mine}
          onClick={() => {
            const r = store.addEvidence(inc.id, { kind: 'inspection_note', note }, actor)
            if (r.ok) setNote('')
            report(r, 'Inspection note saved')
          }}
        >Save note</button>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>Before photo<input type="file" accept="image/*" disabled={!mine} onChange={(e) => upload('before', e.target.files?.[0])} /></label>
          <label>After-repair photo<input type="file" accept="image/*" disabled={!mine} onChange={(e) => upload('after', e.target.files?.[0])} /></label>
        </div>

        <h4 className="mt-4 text-sm font-medium">Closure checklist</h4>
        <ul className="text-sm">
          {checks.map((c) => (
            <li key={c.key} className={c.done ? 'text-ok' : 'text-muted'}>{c.done ? '[x]' : '[ ]'} {CHECK_LABEL[c.key]}</li>
          ))}
        </ul>

        {next.length > 0 && (
          <div className="mt-3 space-y-2">
            {next.includes('closed') && (
              <input aria-label="Verifier name" className="w-full rounded border p-1 text-sm" value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Verifier name (required to close)" disabled={!mine} />
            )}
            <div className="flex flex-wrap gap-2">
              {next.map((s: Status) => (
                <button key={s} disabled={!mine} className="rounded bg-accent px-3 py-1.5 text-sm text-on-accent disabled:opacity-50" onClick={() => report(store.setStatus(inc.id, s, actor, verifier), `Status set to ${s.replace('_', ' ')}`)}>
                  Mark {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
        {msg && <p role="status" className={`mt-2 rounded p-2 text-sm ${msg.ok ? 'bg-ok-bg text-ok-fg' : 'bg-danger-bg text-danger-fg'}`}>{msg.text}</p>}
      </Card>

      {inc.state.evidence.some((e) => e.photo) && (
        <Card title="Evidence photos">
          <div className="grid grid-cols-2 gap-2">
            {inc.state.evidence.filter((e) => e.photo).map((e, i) => (
              <figure key={i}><img src={e.photo} alt={`${e.kind} evidence`} className="rounded" loading="lazy" decoding="async" /><figcaption className="text-xs text-muted">{e.kind} - {e.actor} - {fmtTime(e.at)}</figcaption></figure>
            ))}
          </div>
        </Card>
      )}

      <Card title="Assignment and status history">
        <ul className="space-y-1 border-l-2 border-line pl-3 text-sm">
          {inc.state.events.map((e, i) => (
            <li key={i}><span className="text-muted">{fmtTime(e.at)}</span> <span className="font-medium">{e.actor}</span>: {e.text}</li>
          ))}
          {inc.state.evidence.filter((e) => e.note).map((e, i) => (
            <li key={'n' + i} className="text-fg">Note ({e.actor}): {e.note}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
