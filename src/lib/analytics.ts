import { computePriority, HIGH_BAND } from './priority'
import { evidenceComplete, isOpen } from './rules'
import type { Category, Incident, Status } from './types'

const HOUR = 3_600_000

export interface Metrics {
  totalReports: number
  incidents: number
  duplicatesConsolidated: number
  open: number
  highPriorityUnresolved: number
  avgFirstResponseH: number | null
  avgResolutionH: number | null
  closed: number
  closedWithCompleteEvidence: number
  evidenceCompletenessPct: number | null
  byStatus: Record<Status, number>
  byCategory: Partial<Record<Category, number>>
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

export function computeMetrics(incidents: Incident[], now: number = Date.now()): Metrics {
  const byStatus: Record<Status, number> = { reported: 0, investigating: 0, inspected: 0, repaired: 0, closed: 0, not_confirmed: 0 }
  const byCategory: Partial<Record<Category, number>> = {}
  const first: number[] = []
  const resolution: number[] = []
  let high = 0
  let closed = 0
  let closedComplete = 0

  for (const inc of incidents) {
    byStatus[inc.state.status]++
    byCategory[inc.category] = (byCategory[inc.category] ?? 0) + 1
    const reportedAt = inc.reports[0].createdAt
    const firstAction = inc.state.events.find((e) => e.type === 'status')
    if (firstAction) first.push((firstAction.at - reportedAt) / HOUR)
    const done = [...inc.state.events].reverse().find((e) => e.type === 'status' && /repaired|closed/.test(e.text))
    if (done && (inc.state.status === 'repaired' || inc.state.status === 'closed')) {
      const repairedAt = inc.state.events.find((e) => e.type === 'status' && /repaired/.test(e.text))?.at ?? done.at
      resolution.push((repairedAt - reportedAt) / HOUR)
    }
    if (isOpen(inc.state.status) && computePriority(inc, now).score >= HIGH_BAND) high++
    if (inc.state.status === 'closed') {
      closed++
      if (evidenceComplete(inc)) closedComplete++
    }
  }
  const totalReports = incidents.reduce((s, i) => s + i.reports.length, 0)
  return {
    totalReports,
    incidents: incidents.length,
    duplicatesConsolidated: totalReports - incidents.length,
    open: incidents.filter((i) => isOpen(i.state.status)).length,
    highPriorityUnresolved: high,
    avgFirstResponseH: avg(first),
    avgResolutionH: avg(resolution),
    closed,
    closedWithCompleteEvidence: closedComplete,
    evidenceCompletenessPct: closed ? Math.round((closedComplete / closed) * 100) : null,
    byStatus,
    byCategory,
  }
}
