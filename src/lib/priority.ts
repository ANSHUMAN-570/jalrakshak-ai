import type { Evidence, Incident, PriorityResult } from './types'

/**
 * P = 0.35 S + 0.30 E + 0.20 R + 0.15 C   (each factor 0-100)
 * An initial prototype heuristic for ordering investigations. It is NOT a validated
 * model and NOT proof that a leak exists.
 */
export const WEIGHTS = { S: 0.35, E: 0.3, R: 0.2, C: 0.15 } as const
export const RECENCY_HALF_LIFE_H = 48
export const HIGH_BAND = 60
export const MEDIUM_BAND = 40

export function recencyScore(latestReportAt: number, now: number): number {
  const hours = Math.max(0, (now - latestReportAt) / 3_600_000)
  return 100 * Math.pow(0.5, hours / RECENCY_HALF_LIFE_H)
}

/** Independent confirmation: distinct reporters only, so one person re-submitting adds nothing. */
export function confirmationScore(independentReporters: number): number {
  if (independentReporters <= 0) return 0
  return Math.min(100, 20 + (independentReporters - 1) * 35)
}

export function evidenceScore(incident: Incident): { value: number; parts: string[] } {
  const parts: string[] = []
  let v = 0
  const photos = incident.reports.filter((r) => r.photo).length
  if (photos > 0) { v += 40; parts.push('photo attached (+40)') }
  if (photos > 1) { v += 10; parts.push('more than one photo (+10)') }
  const best = incident.reports.reduce((m, r) => {
    const s = r.locationSource === 'gps' && (r.accuracyM ?? 999) <= 50 ? 25 : r.locationSource === 'gps' ? 18 : 12
    return Math.max(m, s)
  }, 0)
  v += best
  parts.push(best === 25 ? 'precise GPS location (+25)' : best === 18 ? 'coarse GPS location (+18)' : 'manually pinned location (+12)')
  const longest = Math.max(...incident.reports.map((r) => r.description.trim().length))
  const d = longest >= 40 ? 15 : 5
  v += d
  parts.push(longest >= 40 ? 'detailed description (+15)' : 'short description (+5)')
  if (incident.category !== 'other') { v += 10; parts.push('issue type identified (+10)') }
  return { value: Math.min(100, v), parts }
}

export function computePriority(incident: Incident, now: number = Date.now()): PriorityResult {
  const reporters = new Set(incident.reports.map((r) => r.reporterId)).size
  // Severity is the MAX over reports, never a sum: duplicates must not inflate severity.
  const S = Math.max(...incident.reports.map((r) => r.severity))
  const ev = evidenceScore(incident)
  const R = recencyScore(Math.max(...incident.reports.map((r) => r.createdAt)), now)
  const C = confirmationScore(reporters)
  const hours = Math.max(0, (now - Math.max(...incident.reports.map((r) => r.createdAt))) / 3_600_000)

  const mk = (key: 'S' | 'E' | 'R' | 'C', label: string, value: number, reason: string) => ({
    key,
    label,
    weight: WEIGHTS[key],
    value: Math.round(value),
    contribution: Math.round(WEIGHTS[key] * value * 10) / 10,
    reason,
  })
  const factors = [
    mk('S', 'Reported severity', S, `highest severity among ${incident.reports.length} report(s), not summed`),
    mk('E', 'Evidence completeness', ev.value, ev.parts.join('; ')),
    mk('R', 'Recency', R, `latest report ${hours < 1 ? 'under 1 h' : Math.round(hours) + ' h'} ago (half-life ${RECENCY_HALF_LIFE_H} h)`),
    mk('C', 'Independent confirmation', C, `${reporters} distinct reporter(s)`),
  ]
  const score = Math.round(factors.reduce((s, f) => s + WEIGHTS[f.key] * f.value, 0))
  return { score, band: score >= HIGH_BAND ? 'high' : score >= MEDIUM_BAND ? 'medium' : 'low', factors }
}

export function hasPhoto(evidence: Evidence[], kind: 'before' | 'after'): boolean {
  return evidence.some((e) => e.kind === kind && e.photo)
}
