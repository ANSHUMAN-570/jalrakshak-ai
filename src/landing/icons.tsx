import type { ReactNode } from 'react'

const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const

export type IconName = 'map' | 'camera' | 'layers' | 'scale' | 'pin' | 'clipboard' | 'chart' | 'globe' | 'database' | 'eye' | 'clock' | 'shield' | 'trace' | 'arrow'

const paths: Record<IconName, ReactNode> = {
  map: <><path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" /><path d="M9 4v14M15 6v14" /></>,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></>,
  scale: <><path d="M12 4v16M6 20h12" /><path d="M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7ZM19 7l-3 7a3 3 0 0 0 6 0l-3-7Z" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z" /><circle cx="12" cy="10" r="2.5" /></>,
  clipboard: <><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v3H9ZM9 13l2 2 4-4" /></>,
  chart: <><path d="M4 20V4M4 20h16" /><path d="M8 16v-4M12 16V8M16 16v-6" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  database: <><ellipse cx="12" cy="6" rx="8" ry="3" /><path d="M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>,
  trace: <><circle cx="6" cy="6" r="2" /><circle cx="18" cy="12" r="2" /><circle cx="6" cy="18" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4M8 18h4a4 4 0 0 0 4-4" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
}

export function Icon({ name, className = 'h-6 w-6' }: { name: IconName; className?: string }) {
  return <svg {...base} className={className}>{paths[name]}</svg>
}
