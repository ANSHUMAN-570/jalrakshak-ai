import { useState } from 'react'
import { Link } from 'react-router-dom'
import { LocationPicker } from '../components/Maps'
import { Card } from '../components/ui'
import { reporterId, resizePhoto } from '../hooks'
import { useLang } from '../i18n'
import { analyzeText, CATEGORY_LABELS, severityFor, type Analysis } from '../lib/classify'
import { store } from '../lib/store'
import type { Category, LocationSource, Report } from '../lib/types'

export default function ReportPage() {
  const { t, lang } = useLang()
  const [photo, setPhoto] = useState<string>()
  const [loc, setLoc] = useState<{ lat: number; lng: number; source: LocationSource; accuracy?: number } | null>(null)
  const [locating, setLocating] = useState(false)
  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<{ report: Report; linked: boolean } | null>(null)

  const useGps = () => {
    if (!navigator.geolocation) return setError('Geolocation is not available in this browser. Tap the map instead.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ lat: p.coords.latitude, lng: p.coords.longitude, source: 'gps', accuracy: Math.round(p.coords.accuracy) })
        setLocating(false)
      },
      () => {
        setLocating(false)
        setError('Could not get your location. Tap the map instead.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const onPhoto = async (f?: File) => {
    if (!f) return
    try {
      setPhoto(await resizePhoto(f))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const check = () => {
    setError('')
    if (!loc) return setError(t('needLocation'))
    if (text.trim().length < 10) return setError(t('needDescription'))
    setAnalysis(analyzeText(text))
  }

  const submit = () => {
    if (!loc || !analysis) return
    if (!consent) return setError(t('needConsent'))
    const report = store.submitReport({
      lat: loc.lat,
      lng: loc.lng,
      locationSource: loc.source,
      accuracyM: loc.accuracy,
      description: text.trim(),
      lang,
      category: analysis.category,
      urgencyHints: analysis.urgencyHints,
      landmark: analysis.landmark,
      severity: analysis.severity,
      photo,
      reporterId: reporterId(),
    })
    const inc = store.track(report.caseId)
    setDone({ report, linked: (inc?.linkedReports ?? 1) > 1 })
  }

  if (done)
    return (
      <Card title={t('doneTitle')}>
        <p className="text-sm text-slate-600">{t('yourCase')}</p>
        <p className="my-2 select-all font-mono text-3xl font-bold text-water-700">{done.report.caseId}</p>
        <p className="text-sm">{t('saveId')}</p>
        {done.linked && <p className="mt-3 rounded bg-sky-50 p-2 text-sm text-sky-900">{t('linked')}</p>}
        <div className="mt-4 flex gap-3">
          <Link className="rounded bg-water-600 px-4 py-2 text-white" to={`/track?id=${done.report.caseId}`}>{t('navTrack')}</Link>
          <button className="rounded border px-4 py-2" onClick={() => location.reload()}>{t('newReport')}</button>
        </div>
      </Card>
    )

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('reportTitle')}</h1>

      <Card title={t('step1')}>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
        {photo && (
          <div className="mt-2">
            <img src={photo} alt="attached" className="h-32 rounded" />
            <p className="text-xs text-emerald-700">{t('photoChosen')}</p>
          </div>
        )}
      </Card>

      <Card title={t('step2')}>
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <button className="rounded border border-water-600 px-3 py-1.5 text-water-700" onClick={useGps} disabled={locating}>
            {locating ? t('locating') : t('useLocation')}
          </button>
          <span className="text-sm text-slate-600">
            {loc
              ? `${t('locationSet')}: ${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}${loc.source === 'gps' ? ` (GPS ±${loc.accuracy} m)` : ' (map pin)'}`
              : t('locationNone')}
          </span>
        </div>
        <LocationPicker value={loc} onPick={(lat, lng) => setLoc({ lat, lng, source: 'map_pin' })} />
      </Card>

      <Card title={t('step3')}>
        <textarea
          className="h-28 w-full rounded border p-2"
          value={text}
          placeholder={t('placeholderDesc')}
          onChange={(e) => {
            setText(e.target.value)
            setAnalysis(null)
          }}
        />
        <button className="mt-2 rounded bg-water-600 px-4 py-2 text-white" onClick={check}>{t('analyze')}</button>
      </Card>

      {analysis && (
        <Card title={t('confirmTitle')}>
          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mr-2 font-medium">{t('category')}</span>
              <select
                className="rounded border p-1"
                value={analysis.category}
                onChange={(e) => {
                  const category = e.target.value as Category
                  setAnalysis({ ...analysis, category, severity: severityFor(category, analysis.urgencyHints) })
                }}
              >
                {(Object.keys(CATEGORY_LABELS) as Category[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c][lang]}</option>
                ))}
              </select>
            </label>
            <p><span className="font-medium">{t('urgency')}:</span> {analysis.urgencyHints.join(', ') || t('none')}</p>
            <p><span className="font-medium">{t('landmark')}:</span> {analysis.landmark ?? t('none')}</p>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              <span>{t('consent')}</span>
            </label>
            <button className="rounded bg-emerald-600 px-4 py-2 font-medium text-white" onClick={submit}>{t('submit')}</button>
          </div>
        </Card>
      )}

      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
    </div>
  )
}
