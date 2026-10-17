import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Card, DemoTag, StatusBadge, VerifyBadge } from '../components/ui'
import { fmtTime, useStoreVersion } from '../hooks'
import { useLang } from '../i18n'
import { verification } from '../lib/rules'
import { store } from '../lib/store'

export default function TrackPage() {
  const { t } = useLang()
  useStoreVersion()
  const [params] = useSearchParams()
  const [id, setId] = useState(params.get('id') ?? '')
  const [query, setQuery] = useState(params.get('id') ?? '')
  const found = query ? store.track(query) : null

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('trackTitle')}</h1>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(id)
        }}
      >
        <input className="flex-1 rounded border p-2 font-mono" value={id} onChange={(e) => setId(e.target.value)} placeholder={t('caseIdPlaceholder')} />
        <button className="rounded bg-water-600 px-4 py-2 text-white">{t('find')}</button>
      </form>

      {query && !found && <p className="rounded bg-red-50 p-2 text-sm text-red-800">{t('notFound')}</p>}

      {found && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold">{found.report.caseId}</span>
            {found.report.demo && <DemoTag />}
            <span className="text-sm text-slate-600">{t('status')}:</span>
            <StatusBadge status={found.status} />
            <VerifyBadge v={verification(found.incident)} />
          </div>
          <p className="mt-2 text-sm">{found.report.description}</p>
          <p className="mt-2 text-sm text-slate-600">{t('reportsInIncident')}: {found.linkedReports}</p>
          {verification(found.incident) === 'verified' && <p className="mt-2 text-sm text-emerald-800">{t('verifiedNote')}</p>}
          {verification(found.incident) === 'evidence_incomplete' && <p className="mt-2 text-sm text-orange-800">{t('incompleteNote')}</p>}
          <ul className="mt-3 space-y-1 border-l-2 border-slate-200 pl-3 text-sm">
            {found.incident.state.events.map((e, i) => (
              <li key={i}><span className="text-slate-500">{fmtTime(e.at)}</span> {e.text}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
