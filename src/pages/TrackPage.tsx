import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ResponsibleContact from '../components/ResponsibleContact'
import { Card, DemoTag, StatusBadge, VerifyBadge } from '../components/ui'
import { fmtTime, useStoreVersion } from '../hooks'
import { useLang } from '../i18n'
import { reportLocation } from '../lib/address'
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
        <button className="rounded bg-accent px-4 py-2 text-on-accent">{t('find')}</button>
      </form>

      {query && !found && <p className="rounded bg-danger-bg p-2 text-sm text-danger-fg">{t('notFound')}</p>}

      {found && (
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-lg font-bold">{found.report.caseId}</span>
            {found.report.demo && <DemoTag />}
            <span className="text-sm text-muted">{t('status')}:</span>
            <StatusBadge status={found.status} />
            <VerifyBadge v={found.verification} />
          </div>
          <p className="mt-2 text-sm">{found.report.description}</p>
          <p className="mt-1 text-sm text-fg" data-testid="track-address">
            {reportLocation(found.report).primary}
            <span className="block font-mono text-xs text-muted">{reportLocation(found.report).coords}</span>
          </p>
          <p className="mt-2 text-sm text-muted">{t('reportsInIncident')}: {found.linkedReports}</p>
          {found.verification === 'verified' && <p className="mt-2 text-sm text-ok-fg">{t('verifiedNote')}</p>}
          {found.verification === 'evidence_incomplete' && <p className="mt-2 text-sm text-warn-fg">{t('incompleteNote')}</p>}
          <ul className="mt-3 space-y-1 border-l-2 border-line pl-3 text-sm">
            {found.events.map((e, i) => (
              <li key={i}><span className="text-muted">{fmtTime(e.at)}</span> {e.text}</li>
            ))}
          </ul>
          <div className="mt-4"><ResponsibleContact match={found.report.match} /></div>
        </Card>
      )}
    </div>
  )
}
