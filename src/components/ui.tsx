import type { ReactNode } from 'react'
import type { Verification } from '../lib/rules'
import type { Status } from '../lib/types'

const STATUS_STYLE: Record<Status, string> = {
  reported: 'bg-elevated text-fg',
  investigating: 'bg-warn-bg text-warn-fg',
  inspected: 'bg-info-bg text-info-fg',
  repaired: 'bg-info-bg text-info-fg',
  closed: 'bg-ok-bg text-ok-fg',
  not_confirmed: 'bg-elevated text-fg',
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status.replace('_', ' ')}</span>
}

export function VerifyBadge({ v }: { v: Verification }) {
  if (v === 'verified') return <span className="rounded bg-ok px-2 py-0.5 text-xs font-medium text-on-accent">verified closure</span>
  if (v === 'evidence_incomplete')
    return <span className="rounded bg-warn-bg px-2 py-0.5 text-xs font-medium text-warn-fg">evidence incomplete - not verified</span>
  return null
}

export const BAND_COLOR = { high: '#c62828', medium: '#ef8f00', low: '#2e7d32' } as const

/** Text colour on each band: white on red/green passes AA, but white on amber is only 2.4:1, so amber gets dark text. */
const BAND_TEXT = { high: '#ffffff', medium: '#071B2C', low: '#ffffff' } as const

export function ScorePill({ score, band }: { score: number; band: 'high' | 'medium' | 'low' }) {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold" style={{ background: BAND_COLOR[band], color: BAND_TEXT[band] }} title={`Priority score ${score}/100 (${band})`}>
      {score}
    </span>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-line bg-surface p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-fg">{title}</h2>}
      {children}
    </section>
  )
}

export function DemoTag() {
  return <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-yellow-900">demo data</span>
}
