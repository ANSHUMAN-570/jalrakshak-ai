import { useMemo, useState } from 'react'
import { IncidentMap } from '../components/Maps'
import { Card, DemoTag, ScorePill, StatusBadge, VerifyBadge } from '../components/ui'
import { fmtTime, operatorName, resizePhoto, setOperatorName, useStoreVersion } from '../hooks'
import { CATEGORY_LABELS } from '../lib/classify'
import { computePriority } from '../lib/priority'
import { checklist, isOpen, NEXT_STATUSES, verification } from '../lib/rules'
import { store } from '../lib/store'
import type { EvidenceKind, Incident, Status } from '../lib/types'

const CHECK_LABEL = {
  before: 'Before / citizen photo on file',
  note: 'Inspection note recorded',
  after: 'After-repair photo attached',
  verifier: 'Verifier named at closure',
} as const

export default function DashboardPage() {
  useStoreVersion()
  const [op, setOp] = useState(operatorName())
  const [selected, setSelected] = useState<string | null>(null)
  const now = Date.now()

  const ranked = useMemo(
    () =>
      store
        .incidents()
        .map((inc) => ({ inc, p: computePriority(inc, now) }))
        .sort((a, b) => Number(isOpen(b.inc.state.status)) - Number(isOpen(a.inc.state.status)) || b.p.score - a.p.score),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [store.getVersion()],
  )
  const current = ranked.find((r) => r.inc.id === selected) ?? null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-bold">Operator dashboard</h1>
        <label className="text-sm">
          Operator name (recorded in the audit trail){' '}
          <input
            className="ml-1 rounded border p-1"
            value={op}
            placeholder="Your name"
            onChange={(e) => {
              setOp(e.target.value)
              setOperatorName(e.target.value)
            }}
          />
        </label>
      </div>
      <p className="rounded bg-yellow-50 p-2 text-xs text-yellow-900">
        Priority is an investigation-ordering heuristic, not proof a leak exists. Sign-in is not implemented in this prototype; production would require authenticated operator accounts.
      </p>

      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <IncidentMap
            selected={selected}
            onSelect={setSelected}
            pins={ranked.map(({ inc, p }) => ({
              id: inc.id,
              lat: inc.centroid.lat,
              lng: inc.centroid.lng,
              band: p.band,
              reports: inc.reports.length,
              closed: !isOpen(inc.state.status),
              label: `${CATEGORY_LABELS[inc.category].en} - score ${p.score} - ${inc.reports.length} report(s)`,
            }))}
          />
          <p className="text-xs text-slate-500">Marker size = number of grouped reports. Red/amber/green = priority band; grey = resolved.</p>
          <Card title="Ranked investigation queue">
            <ol className="divide-y">
              {ranked.map(({ inc, p }, i) => (
                <li key={inc.id}>
                  <button
                    onClick={() => setSelected(inc.id)}
                    className={`flex w-full items-center gap-3 p-2 text-left hover:bg-slate-50 ${inc.id === selected ? 'bg-sky-50' : ''}`}
                  >
                    <span className="w-5 text-sm text-slate-500">{i + 1}</span>
                    <ScorePill score={p.score} band={p.band} />
                    <span className="flex-1">
                      <span className="block text-sm font-medium">{CATEGORY_LABELS[inc.category].en}</span>
                      <span className="block text-xs text-slate-500">
                        {inc.reports.length} report(s) from {new Set(inc.reports.map((r) => r.reporterId)).size} reporter(s)
                        {inc.reports[0].demo && ' '}
                        {inc.reports[0].demo && <DemoTag />}
                      </span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
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
          {current ? <CaseDetail key={current.inc.id} inc={current.inc} operator={op} /> : <Card><p className="text-sm text-slate-600">Select an incident on the map or in the queue.</p></Card>}
        </div>
      </div>
    </div>
  )
}

function CaseDetail({ inc, operator }: { inc: Incident; operator: string }) {
  const p = computePriority(inc)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [note, setNote] = useState('')
  const [assignee, setAssignee] = useState(inc.state.assignee ?? '')
  const [verifier, setVerifier] = useState('')
  const report = (r: { ok: boolean; error?: string }, okText: string) => setMsg(r.ok ? { ok: true, text: okText } : { ok: false, text: r.error ?? 'Failed' })

  const upload = async (kind: EvidenceKind, f?: File) => {
    if (!f) return
    try {
      const photo = await resizePhoto(f)
      report(store.addEvidence(inc.id, { kind, photo, actor: operator || 'operator' }), `${kind} photo attached`)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }

  const checks = checklist(inc)
  const next = NEXT_STATUSES[inc.state.status]

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
        <h3 className="mt-4 text-sm font-semibold">Why this priority (P = 0.35S + 0.30E + 0.20R + 0.15C)</h3>
        <table className="mt-1 w-full text-xs">
          <tbody>
            {p.factors.map((f) => (
              <tr key={f.key} className="border-t align-top">
                <td className="py-1 pr-2 font-medium">{f.label} <span className="text-slate-400">x{f.weight}</span></td>
                <td className="py-1 pr-2 text-right tabular-nums">{f.value}</td>
                <td className="py-1 pr-2 text-right tabular-nums">+{f.contribution}</td>
                <td className="py-1 text-slate-600">{f.reason}</td>
              </tr>
            ))}
            <tr className="border-t font-semibold"><td colSpan={2}>Total</td><td className="text-right">{p.score}</td><td /></tr>
          </tbody>
        </table>
      </Card>

      <Card title={`Grouped reports (${inc.reports.length})`}>
        <ul className="space-y-3 text-sm">
          {inc.reports.map((r) => (
            <li key={r.id} className="flex gap-3">
              {r.photo && <img src={r.photo} alt="" className="h-16 w-24 rounded object-cover" />}
              <div>
                <p><span className="font-mono text-xs">{r.caseId}</span> <span className="text-xs text-slate-500">{fmtTime(r.createdAt)} - {r.lang.toUpperCase()} - {r.locationSource === 'gps' ? `GPS ±${r.accuracyM ?? '?'} m` : 'map pin'}</span></p>
                <p>{r.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Case actions">
        {!operator.trim() && <p className="mb-2 rounded bg-amber-50 p-2 text-xs text-amber-900">Enter your operator name above to make changes.</p>}
        <div className="mb-3 flex gap-2">
          <input className="flex-1 rounded border p-1 text-sm" value={assignee} onChange={(e) => setAssignee(e.target.value)} placeholder="Assign to (team / person)" />
          <button className="rounded border px-3 text-sm" onClick={() => report(store.assign(inc.id, assignee, operator || 'operator'), 'Assigned')}>Assign</button>
        </div>

        <h4 className="text-sm font-medium">Evidence</h4>
        <textarea className="mt-1 h-16 w-full rounded border p-1 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Inspection note (what was found on site)" />
        <button
          className="mb-2 rounded border px-3 py-1 text-sm"
          onClick={() => {
            const r = store.addEvidence(inc.id, { kind: 'inspection_note', note, actor: operator || 'operator' })
            if (r.ok) setNote('')
            report(r, 'Inspection note saved')
          }}
        >Save note</button>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <label>Before photo<input type="file" accept="image/*" onChange={(e) => upload('before', e.target.files?.[0])} /></label>
          <label>After-repair photo<input type="file" accept="image/*" onChange={(e) => upload('after', e.target.files?.[0])} /></label>
        </div>

        <h4 className="mt-4 text-sm font-medium">Closure checklist</h4>
        <ul className="text-sm">
          {checks.map((c) => (
            <li key={c.key} className={c.done ? 'text-emerald-700' : 'text-slate-500'}>{c.done ? '[x]' : '[ ]'} {CHECK_LABEL[c.key]}</li>
          ))}
        </ul>

        {next.length > 0 && (
          <div className="mt-3 space-y-2">
            {next.includes('closed') && (
              <input className="w-full rounded border p-1 text-sm" value={verifier} onChange={(e) => setVerifier(e.target.value)} placeholder="Verifier name (required to close)" />
            )}
            <div className="flex flex-wrap gap-2">
              {next.map((s: Status) => (
                <button key={s} className="rounded bg-water-600 px-3 py-1.5 text-sm text-white" onClick={() => report(store.setStatus(inc.id, s, operator, verifier), `Status set to ${s.replace('_', ' ')}`)}>
                  Mark {s.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>
        )}
        {msg && <p role="status" className={`mt-2 rounded p-2 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{msg.text}</p>}
      </Card>

      {inc.state.evidence.some((e) => e.photo) && (
        <Card title="Evidence photos">
          <div className="grid grid-cols-2 gap-2">
            {inc.state.evidence.filter((e) => e.photo).map((e, i) => (
              <figure key={i}><img src={e.photo} alt={e.kind} className="rounded" /><figcaption className="text-xs text-slate-500">{e.kind} - {e.actor} - {fmtTime(e.at)}</figcaption></figure>
            ))}
          </div>
        </Card>
      )}

      <Card title="Audit trail">
        <ul className="space-y-1 border-l-2 border-slate-200 pl-3 text-sm">
          {inc.state.events.map((e, i) => (
            <li key={i}><span className="text-slate-500">{fmtTime(e.at)}</span> <span className="font-medium">{e.actor}</span>: {e.text}</li>
          ))}
          {inc.state.evidence.filter((e) => e.note).map((e, i) => (
            <li key={'n' + i} className="text-slate-700">Note ({e.actor}): {e.note}</li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
