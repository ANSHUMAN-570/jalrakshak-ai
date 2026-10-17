import type { ReactNode } from 'react'
import type { Verification } from '../lib/rules'
import type { Status } from '../lib/types'

const STATUS_STYLE: Record<Status, string> = {
  reported: 'bg-slate-200 text-slate-800',
  investigating: 'bg-amber-100 text-amber-900',
  inspected: 'bg-sky-100 text-sky-900',
  repaired: 'bg-indigo-100 text-indigo-900',
  closed: 'bg-emerald-100 text-emerald-900',
  not_confirmed: 'bg-slate-100 text-slate-700',
}

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status]}`}>{status.replace('_', ' ')}</span>
}

export function VerifyBadge({ v }: { v: Verification }) {
  if (v === 'verified') return <span className="rounded bg-emerald-600 px-2 py-0.5 text-xs font-medium text-white">verified closure</span>
  if (v === 'evidence_incomplete')
    return <span className="rounded bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-900">evidence incomplete - not verified</span>
  return null
}

export const BAND_COLOR = { high: '#c62828', medium: '#ef8f00', low: '#2e7d32' } as const

export function ScorePill({ score, band }: { score: number; band: 'high' | 'medium' | 'low' }) {
  return (
    <span className="inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: BAND_COLOR[band] }} title={`Priority score ${score}/100 (${band})`}>
      {score}
    </span>
  )
}

export function Card({ title, children, className = '' }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {title && <h2 className="mb-3 text-base font-semibold text-slate-800">{title}</h2>}
      {children}
    </section>
  )
}

export function DemoTag() {
  return <span className="rounded bg-yellow-200 px-1.5 py-0.5 text-[10px] font-bold uppercase text-yellow-900">demo data</span>
}
