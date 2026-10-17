import L from 'leaflet'
import { memo, useEffect, useMemo, useState } from 'react'
import { CircleMarker, MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { useLang } from '../i18n'
import { BAND_COLOR } from './ui'

export const DEFAULT_CENTER: [number, number] = [28.6139, 77.209]

function Tiles({ onError }: { onError: () => void }) {
  return (
    <TileLayer
      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      eventHandlers={{ tileerror: onError }}
    />
  )
}

function TileNotice({ show, text }: { show: boolean; text: string }) {
  if (!show) return null
  return (
    <p role="status" className="absolute inset-x-2 bottom-8 z-[500] rounded bg-amber-100 p-2 text-xs text-amber-900 shadow">
      {text}
    </p>
  )
}

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function FlyTo({ pos, zoom }: { pos: [number, number] | null; zoom?: number }) {
  const map = useMap()
  const lat = pos?.[0]
  const lng = pos?.[1]
  useEffect(() => {
    if (lat !== undefined && lng !== undefined) map.flyTo([lat, lng], Math.max(map.getZoom(), zoom ?? 16), { duration: 0.6 })
  }, [lat, lng, zoom, map])
  return null
}

/** Draggable marker with an inline (CSS) icon, so no marker image files are needed under bundlers. */
const pickerIcon = L.divIcon({
  className: '',
  html: '<div style="width:22px;height:22px;border-radius:50%;background:#0b7bc4;border:3px solid #fff;box-shadow:0 0 0 2px #0a4f80,0 2px 6px rgba(0,0,0,.4)"></div>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

export function LocationPicker({ value, onPick }: { value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  const { t } = useLang()
  const [tileErr, setTileErr] = useState(false)
  const pos: [number, number] | null = value ? [value.lat, value.lng] : null
  const handlers = useMemo(
    () => ({
      dragend(e: L.LeafletEvent) {
        const ll = (e.target as L.Marker).getLatLng()
        onPick(ll.lat, ll.lng)
      },
    }),
    [onPick],
  )
  return (
    <div className="relative">
      <MapContainer center={pos ?? DEFAULT_CENTER} zoom={14} className="h-72 w-full rounded-lg sm:h-80" scrollWheelZoom>
        <Tiles onError={() => setTileErr(true)} />
        <ClickPicker onPick={onPick} />
        <FlyTo pos={pos} />
        {pos && <Marker position={pos} icon={pickerIcon} draggable eventHandlers={handlers} keyboard alt="Selected location marker" />}
      </MapContainer>
      <TileNotice show={tileErr} text={t('tileError')} />
    </div>
  )
}

export interface Pin {
  id: string
  lat: number
  lng: number
  band: 'high' | 'medium' | 'low'
  reports: number
  label: string
  address: string
  closed: boolean
}

function IncidentMapImpl({ pins, selected, onSelect }: { pins: Pin[]; selected: string | null; onSelect: (id: string) => void }) {
  const { t } = useLang()
  const [tileErr, setTileErr] = useState(false)
  const sel = pins.find((p) => p.id === selected)
  return (
    <div className="relative">
      <MapContainer center={DEFAULT_CENTER} zoom={14} className="h-[320px] w-full rounded-lg sm:h-[420px]" scrollWheelZoom>
        <Tiles onError={() => setTileErr(true)} />
        <FlyTo pos={sel ? [sel.lat, sel.lng] : null} zoom={15} />
        {pins.map((p) => (
          <CircleMarker
            key={p.id}
            center={[p.lat, p.lng]}
            radius={9 + Math.min(p.reports, 5) * 3}
            pathOptions={{
              color: p.id === selected ? '#000' : '#fff',
              weight: p.id === selected ? 3 : 2,
              fillColor: p.closed ? '#9e9e9e' : BAND_COLOR[p.band],
              fillOpacity: 0.85,
            }}
            eventHandlers={{ click: () => onSelect(p.id) }}
          >
            <Tooltip>
              <strong>{p.label}</strong>
              <br />
              {p.address}
            </Tooltip>
          </CircleMarker>
        ))}
      </MapContainer>
      <TileNotice show={tileErr} text={t('tileError')} />
    </div>
  )
}

/** Memoised: it only re-renders when the pins array or the selection actually changes. */
export const IncidentMap = memo(IncidentMapImpl)
