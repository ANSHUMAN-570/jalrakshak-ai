import { useEffect } from 'react'
import { CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import { BAND_COLOR } from './ui'

export const DEFAULT_CENTER: [number, number] = [28.6139, 77.209]

const Tiles = () => (
  <TileLayer
    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
  />
)

function ClickPicker({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) })
  return null
}

function FlyTo({ pos }: { pos: [number, number] | null }) {
  const map = useMap()
  useEffect(() => {
    if (pos) map.flyTo(pos, Math.max(map.getZoom(), 16), { duration: 0.6 })
  }, [pos, map])
  return null
}

export function LocationPicker({ value, onPick }: { value: { lat: number; lng: number } | null; onPick: (lat: number, lng: number) => void }) {
  const pos: [number, number] | null = value ? [value.lat, value.lng] : null
  return (
    <MapContainer center={pos ?? DEFAULT_CENTER} zoom={14} className="h-72 w-full rounded-lg" scrollWheelZoom>
      <Tiles />
      <ClickPicker onPick={onPick} />
      <FlyTo pos={pos} />
      {pos && <CircleMarker center={pos} radius={10} pathOptions={{ color: '#0a4f80', fillColor: '#0b7bc4', fillOpacity: 0.8 }} />}
    </MapContainer>
  )
}

export interface Pin {
  id: string
  lat: number
  lng: number
  band: 'high' | 'medium' | 'low'
  reports: number
  label: string
  closed: boolean
}

export function IncidentMap({ pins, selected, onSelect }: { pins: Pin[]; selected: string | null; onSelect: (id: string) => void }) {
  const sel = pins.find((p) => p.id === selected)
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={14} className="h-[420px] w-full rounded-lg" scrollWheelZoom>
      <Tiles />
      <FlyTo pos={sel ? [sel.lat, sel.lng] : null} />
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
          <Tooltip>{p.label}</Tooltip>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
