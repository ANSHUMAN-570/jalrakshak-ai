import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import AddressPanel, { type AddressMode, type AutoState } from '../components/AddressPanel'
import AddressSearch from '../components/AddressSearch'
import { LazyLocationPicker } from '../components/LazyMaps'
import { Card } from '../components/ui'
import { reporterId, resizePhoto } from '../hooks'
import { useLang } from '../i18n'
import { addressText, cleanComponents, coordsText, createLatest, formatComponents, hasAddress, isValidPin, reverseGeocode, type SearchHit } from '../lib/address'
import { analyzeText, CATEGORY_LABELS, severityFor, type Analysis } from '../lib/classify'
import { store } from '../lib/store'
import type { AddressComponents, Category, LocationSource, Report, ReportAddress } from '../lib/types'

interface Coords {
  lat: number
  lng: number
  source: LocationSource
  accuracy?: number
}

export default function ReportPage() {
  const { t, lang } = useLang()
  const [photo, setPhoto] = useState<string>()
  const [loc, setLoc] = useState<Coords | null>(null)
  const [locating, setLocating] = useState(false)
  const [mode, setMode] = useState<AddressMode>('auto')
  const [auto, setAuto] = useState<AutoState>({ status: 'idle' })
  const [manual, setManual] = useState<AddressComponents>({})
  const [text, setText] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [consent, setConsent] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState<{ report: Report; linked: boolean } | null>(null)

  const latest = useRef(createLatest())
  const abort = useRef<AbortController | null>(null)
  const submitted = useRef(false)

  useEffect(() => () => abort.current?.abort(), [])

  /** Reverse geocode for a point. Only ever writes `auto`; typed (manual) fields are never touched. */
  const resolveAddress = useCallback((lat: number, lng: number) => {
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const token = latest.current.next()
    setAuto({ status: 'loading' })
    reverseGeocode(lat, lng, { signal: ctl.signal })
      .then((r) => {
        if (!latest.current.isCurrent(token)) return // a newer point was chosen meanwhile
        setAuto(r.status === 'ok' ? { status: 'ok', address: r.address } : { status: 'none' })
      })
      .catch((e: unknown) => {
        if ((e as Error)?.name === 'AbortError' || !latest.current.isCurrent(token)) return
        setAuto({ status: 'error' })
      })
  }, [])

  const pick = useCallback(
    (c: Coords) => {
      setLoc(c)
      setError('')
      resolveAddress(c.lat, c.lng)
    },
    [resolveAddress],
  )
  const onMapPick = useCallback((lat: number, lng: number) => pick({ lat, lng, source: 'map_pin' }), [pick])

  const onSearchSelect = (hit: SearchHit) => {
    abort.current?.abort()
    latest.current.invalidate()
    setLoc({ lat: hit.lat, lng: hit.lng, source: 'map_pin' })
    setError('')
    // The search result already carries the address, so no extra lookup is needed.
    setAuto(hit.address ? { status: 'ok', address: hit.address } : { status: 'none' })
  }

  const useGps = () => {
    if (!navigator.geolocation) return setError('Geolocation is not available in this browser. Search for an address or tap the map instead.')
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        pick({ lat: p.coords.latitude, lng: p.coords.longitude, source: 'gps', accuracy: Math.round(p.coords.accuracy) })
        setLocating(false)
      },
      () => {
        setLocating(false)
        setError('Location permission was not granted. You can search for an address or tap the map instead.')
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

  const editAuto = () => {
    if (auto.address && !hasAddress(manual)) setManual({ ...auto.address.components })
    setMode('manual')
  }

  /** The address that will be saved for the current mode, or undefined (coordinates only). */
  const chosenAddress = (): ReportAddress | undefined => {
    if (mode === 'manual') {
      const components = cleanComponents(manual)
      return hasAddress(components) ? { source: 'manual', formatted: formatComponents(components), components } : undefined
    }
    return auto.status === 'ok' ? auto.address : undefined
  }

  const check = () => {
    setError('')
    if (!loc) return setError(t('needLocation'))
    if (mode === 'manual' && manual.pin && !isValidPin(manual.pin)) return setError(t('addrPinInvalid'))
    if (mode === 'auto' && auto.status === 'loading') return setError(t('stillDetecting'))
    if (text.trim().length < 10) return setError(t('needDescription'))
    setAnalysis(analyzeText(text))
  }

  const submit = () => {
    if (!loc || !analysis || submitted.current) return
    if (!consent) return setError(t('needConsent'))
    submitted.current = true // blocks double clicks before React re-renders
    setSubmitting(true)
    try {
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
        address: chosenAddress(),
        severity: analysis.severity,
        photo,
        reporterId: reporterId(),
      })
      const inc = store.track(report.caseId)
      setDone({ report, linked: (inc?.linkedReports ?? 1) > 1 })
    } catch (e) {
      // Recoverable: keep everything the user typed and let them retry.
      submitted.current = false
      setSubmitting(false)
      setError(`Could not save the report: ${(e as Error).message}`)
    }
  }

  if (done)
    return (
      <Card title={t('doneTitle')}>
        <p className="text-sm text-slate-600">{t('yourCase')}</p>
        <p className="my-2 select-all font-mono text-3xl font-bold text-water-700" data-testid="case-id">{done.report.caseId}</p>
        <p className="text-sm">{t('saveId')}</p>
        <p className="mt-2 text-sm text-slate-700">{addressText(done.report.address) ?? `${t('addrUnavailable')} (${coordsText(done.report.lat, done.report.lng)})`}</p>
        {done.linked && <p className="mt-3 rounded bg-sky-50 p-2 text-sm text-sky-900">{t('linked')}</p>}
        <div className="mt-4 flex flex-wrap gap-3">
          <Link className="rounded bg-water-600 px-4 py-2 text-white" to={`/track?id=${done.report.caseId}`}>{t('navTrack')}</Link>
          <button className="rounded border px-4 py-2" onClick={() => location.reload()}>{t('newReport')}</button>
        </div>
      </Card>
    )

  const summaryAddress = chosenAddress()

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t('reportTitle')}</h1>

      <Card title={t('step2')}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <button type="button" className="rounded border border-water-600 px-3 py-1.5 text-water-700" onClick={useGps} disabled={locating}>
            {locating ? t('locating') : t('useLocation')}
          </button>
          <span className="text-xs text-slate-500">{t('locPermNote')}</span>
        </div>
        <AddressSearch onSelect={onSearchSelect} />
        <div className="my-3">
          <LazyLocationPicker value={loc} onPick={onMapPick} />
          <p className="mt-1 text-xs text-slate-500">{t('markerHint')}</p>
        </div>
        <AddressPanel
          coords={loc}
          mode={mode}
          onMode={setMode}
          auto={auto}
          onRetry={() => loc && resolveAddress(loc.lat, loc.lng)}
          manual={manual}
          onManual={setManual}
          onEditAuto={editAuto}
        />
      </Card>

      <Card title={t('step1')}>
        <input type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
        {photo && (
          <div className="mt-2">
            <img src={photo} alt="attached" className="h-32 w-auto rounded" decoding="async" />
            <p className="text-xs text-emerald-700">{t('photoChosen')}</p>
          </div>
        )}
      </Card>

      <Card title={t('step3')}>
        <textarea
          aria-label={t('step3')}
          className="h-28 w-full rounded border p-2"
          value={text}
          maxLength={1000}
          placeholder={t('placeholderDesc')}
          onChange={(e) => {
            setText(e.target.value)
            setAnalysis(null)
          }}
        />
        <button type="button" className="mt-2 rounded bg-water-600 px-4 py-2 text-white" onClick={check}>{t('analyze')}</button>
      </Card>

      {analysis && (
        <Card title={t('confirmTitle')}>
          <div className="space-y-3 text-sm">
            <p data-testid="summary-address">
              <span className="font-medium">{t('addressTitle')}:</span>{' '}
              {summaryAddress ? (
                <>
                  {addressText(summaryAddress)} <span className="text-xs text-slate-500">({summaryAddress.source === 'manual' ? t('addrSourceManual') : t('addrSourceAuto')})</span>
                </>
              ) : (
                <>
                  <span className="text-slate-600">{t('addrUnavailable')}</span> <span className="text-xs text-slate-500">{t('addrCoordsOnly')}</span>
                </>
              )}
              {loc && <span className="block font-mono text-xs text-slate-500">{coordsText(loc.lat, loc.lng)}</span>}
            </p>
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
            <button type="button" className="rounded bg-emerald-600 px-4 py-2 font-medium text-white disabled:opacity-60" onClick={submit} disabled={submitting}>
              {submitting ? t('submitting') : t('submit')}
            </button>
          </div>
        </Card>
      )}

      {error && <p role="alert" className="rounded bg-red-50 p-2 text-sm text-red-800">{error}</p>}
    </div>
  )
}
