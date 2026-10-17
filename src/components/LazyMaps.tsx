import { Component, lazy, Suspense, type ReactNode } from 'react'
import { useLang } from '../i18n'
import type { Pin } from './Maps'

// Leaflet is the heaviest dependency; load it only on pages that show a map.
const LocationPickerImpl = lazy(() => import('./Maps').then((m) => ({ default: m.LocationPicker })))
const IncidentMapImpl = lazy(() => import('./Maps').then((m) => ({ default: m.IncidentMap })))

function Fallback() {
  const { t } = useLang()
  return <div className="flex h-72 items-center justify-center rounded-lg bg-slate-100 text-sm text-slate-500">{t('mapLoading')}</div>
}

function Failed() {
  const { t } = useLang()
  return <div role="alert" className="flex h-40 items-center justify-center rounded-lg bg-red-50 p-3 text-sm text-red-800">{t('mapFailed')}</div>
}

class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? <Failed /> : this.props.children
  }
}

export function LazyLocationPicker(props: { value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  return (
    <Boundary>
      <Suspense fallback={<Fallback />}>
        <LocationPickerImpl {...props} />
      </Suspense>
    </Boundary>
  )
}

export function LazyIncidentMap(props: { pins: Pin[]; selected: string | null; onSelect: (id: string) => void }) {
  return (
    <Boundary>
      <Suspense fallback={<Fallback />}>
        <IncidentMapImpl {...props} />
      </Suspense>
    </Boundary>
  )
}
