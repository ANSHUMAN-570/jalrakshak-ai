import { useLang } from '../i18n'
import { addressText, coordsText, isValidPin } from '../lib/address'
import type { AddressComponents, ReportAddress } from '../lib/types'

export type AutoState = { status: 'idle' | 'loading' | 'ok' | 'none' | 'error'; address?: ReportAddress }
export type AddressMode = 'auto' | 'manual'

interface Props {
  coords: { lat: number; lng: number } | null
  mode: AddressMode
  onMode: (m: AddressMode) => void
  auto: AutoState
  onRetry: () => void
  manual: AddressComponents
  onManual: (c: AddressComponents) => void
  onEditAuto: () => void
}

const FIELDS: { key: keyof AddressComponents; label: 'addrLine' | 'addrLocality' | 'addrCity' | 'addrState' | 'addrPin'; max: number; wide?: boolean }[] = [
  { key: 'line', label: 'addrLine', max: 160, wide: true },
  { key: 'locality', label: 'addrLocality', max: 80 },
  { key: 'city', label: 'addrCity', max: 80 },
  { key: 'state', label: 'addrState', max: 60 },
  { key: 'pin', label: 'addrPin', max: 6 },
]

export default function AddressPanel({ coords, mode, onMode, auto, onRetry, manual, onManual, onEditAuto }: Props) {
  const { t } = useLang()
  const tab = (m: AddressMode, label: string) => (
    <button
      type="button"
      role="tab"
      aria-selected={mode === m}
      onClick={() => onMode(m)}
      className={`rounded px-3 py-1.5 text-sm ${mode === m ? 'bg-water-600 text-white' : 'border text-water-700'}`}
    >
      {label}
    </button>
  )
  const pinBad = !!manual.pin && !isValidPin(manual.pin)

  return (
    <div className="space-y-3" data-testid="address-panel">
      <div className="rounded bg-slate-50 p-2 text-sm" data-testid="selected-point">
        <span className="font-medium">{t('selectedPoint')}: </span>
        {coords ? <span className="font-mono">{coordsText(coords.lat, coords.lng)}</span> : <span className="text-slate-500">{t('locationNone')}</span>}
      </div>

      <div role="tablist" aria-label={t('addressTitle')} className="flex gap-2">
        {tab('auto', t('addrAuto'))}
        {tab('manual', t('addrManual'))}
      </div>

      {mode === 'auto' && (
        <div aria-live="polite" className="text-sm" data-testid="auto-address">
          {!coords && <p className="text-slate-500">{t('locationNone')}</p>}
          {coords && auto.status === 'loading' && (
            <p className="flex items-center gap-2 text-slate-600">
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-water-600 border-t-transparent" aria-hidden />
              {t('addrDetecting')}
            </p>
          )}
          {coords && auto.status === 'ok' && (
            <div>
              <p className="font-medium" data-testid="auto-address-text">{addressText(auto.address)}</p>
              <p className="text-xs text-slate-500">{t('addrSourceAuto')}</p>
              <button type="button" className="mt-1 text-water-700 underline" onClick={onEditAuto}>{t('addrEdit')}</button>
            </div>
          )}
          {coords && auto.status === 'none' && (
            <p className="rounded bg-amber-50 p-2 text-amber-900">
              <strong>{t('addrUnavailable')}.</strong> {t('addrNone')}
            </p>
          )}
          {coords && auto.status === 'error' && (
            <p className="rounded bg-red-50 p-2 text-red-800" role="alert">
              {t('addrError')}{' '}
              <button type="button" className="underline" onClick={onRetry}>{t('addrRetry')}</button>
            </p>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div data-testid="manual-address">
          <p className="mb-2 text-xs text-slate-600">{t('addrManualNote')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className={`block text-sm ${f.wide ? 'sm:col-span-2' : ''}`}>
                <span className="font-medium">{t(f.label)}</span>
                <input
                  className="mt-1 w-full rounded border p-2"
                  value={manual[f.key] ?? ''}
                  maxLength={f.max}
                  inputMode={f.key === 'pin' ? 'numeric' : undefined}
                  autoComplete="off"
                  aria-invalid={f.key === 'pin' && pinBad}
                  onChange={(e) => onManual({ ...manual, [f.key]: f.key === 'pin' ? e.target.value.replace(/\D/g, '') : e.target.value })}
                />
              </label>
            ))}
          </div>
          {pinBad && <p className="mt-1 text-sm text-red-700" role="alert">{t('addrPinInvalid')}</p>}
        </div>
      )}
    </div>
  )
}
