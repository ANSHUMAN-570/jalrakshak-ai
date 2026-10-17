import { Card } from '../components/ui'
import { useStoreVersion } from '../hooks'
import { computeMetrics } from '../lib/analytics'
import { CATEGORY_LABELS } from '../lib/classify'
import { evaluateDuplicates } from '../lib/duplicates'
import { store } from '../lib/store'
import type { Category, Status } from '../lib/types'

const fmtH = (h: number | null) => (h === null ? 'n/a' : h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(1)} h`)

function Tile({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="text-2xl font-bold text-water-700">{value}</div>
      <div className="text-sm font-medium">{label}</div>
      {hint && <div className="text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

function Bars({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]))
  return (
    <ul className="space-y-1.5">
      {data.map(([k, v]) => (
        <li key={k} className="flex items-center gap-2 text-sm">
          <span className="w-44 shrink-0">{k}</span>
          <span className="h-3 rounded bg-water-500" style={{ width: `${(v / max) * 60}%`, minWidth: v ? 6 : 0 }} />
          <span className="tabular-nums">{v}</span>
        </li>
      ))}
    </ul>
  )
}

export default function AnalyticsPage() {
  useStoreVersion()
  const incidents = store.incidents()
  const m = computeMetrics(incidents)
  const ev = evaluateDuplicates(store.allReports())
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Analytics</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Reports received" value={m.totalReports} />
        <Tile label="Distinct incidents" value={m.incidents} hint="after duplicate grouping" />
        <Tile label="Duplicates consolidated" value={m.duplicatesConsolidated} />
        <Tile label="High-priority unresolved" value={m.highPriorityUnresolved} hint="score at or above 60" />
        <Tile label="Avg time to first action" value={fmtH(m.avgFirstResponseH)} hint="report to first status change" />
        <Tile label="Avg time to repair" value={fmtH(m.avgResolutionH)} hint="report to 'repaired'" />
        <Tile label="Closed cases" value={m.closed} />
        <Tile label="Closed with complete evidence" value={m.evidenceCompletenessPct === null ? 'n/a' : `${m.evidenceCompletenessPct}%`} hint={`${m.closedWithCompleteEvidence} of ${m.closed}`} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Cases by status">
          <Bars data={(Object.entries(m.byStatus) as [Status, number][]).map(([k, v]) => [k.replace('_', ' '), v])} />
        </Card>
        <Card title="Cases by issue type">
          <Bars data={(Object.entries(m.byCategory) as [Category, number][]).map(([k, v]) => [CATEGORY_LABELS[k].en, v])} />
        </Card>
      </div>

      <Card title="Duplicate detection check (labelled demo sample)">
        <p className="text-sm">
          On {ev.labelled} labelled sample reports: precision <b>{pct(ev.precision)}</b>, recall <b>{pct(ev.recall)}</b> ({ev.correctPairs} of {ev.truePairs} true duplicate pair(s) found; {ev.predictedPairs} predicted).
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Rule: within 75 m and 72 h, and similar wording or the same specific issue type. The sample is tiny and hand-made, so this shows the method works on seeded cases only. It is not a field accuracy claim.
        </p>
      </Card>

      <Card title="What these numbers do and do not show">
        <p className="text-sm text-slate-700">
          These metrics describe report handling in this demo. They do not measure water saved or leakage reduced; that would need real flow measurements and a pilot with a water utility.
        </p>
        <button className="mt-3 rounded border px-3 py-1 text-sm" onClick={() => confirm('Reset all data back to the demo sample?') && store.reset()}>Reset demo data</button>
      </Card>
    </div>
  )
}
