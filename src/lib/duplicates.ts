import { centroid, haversine } from './geo'
import type { Report } from './types'

export const DUP_MAX_DISTANCE_M = 75
export const DUP_MAX_AGE_GAP_H = 72
export const DUP_MIN_TEXT_SIM = 0.15

const STOP = new Set(['the', 'a', 'an', 'is', 'in', 'on', 'at', 'of', 'and', 'to', 'from', 'near', 'there', 'it', 'की', 'का', 'के', 'में', 'है', 'से', 'पर', 'और', 'को', 'हो', 'रहा', 'गया'])

export function tokens(text: string): Set<string> {
  return new Set(
    (text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)),
  )
}

export function textSimilarity(a: string, b: string): number {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let inter = 0
  for (const w of ta) if (tb.has(w)) inter++
  return inter / (ta.size + tb.size - inter)
}

export interface PairMatch {
  distanceM: number
  hoursApart: number
  textSim: number
  sameCategory: boolean
}

/** Returns match details when two reports are likely about the same leak, else null. */
export function matchPair(a: Report, b: Report): PairMatch | null {
  const distanceM = haversine(a.lat, a.lng, b.lat, b.lng)
  const hoursApart = Math.abs(a.createdAt - b.createdAt) / 3_600_000
  if (distanceM > DUP_MAX_DISTANCE_M || hoursApart > DUP_MAX_AGE_GAP_H) return null
  const textSim = textSimilarity(a.description, b.description)
  const sameCategory = a.category === b.category && a.category !== 'other'
  // Proximity and time are required; then either similar wording or the same specific category.
  if (textSim < DUP_MIN_TEXT_SIM && !sameCategory) return null
  return { distanceM, hoursApart, textSim, sameCategory }
}

/** Groups reports into likely-same-leak clusters (union-find over pair matches). */
export function clusterReports(reports: Report[]): Report[][] {
  const sorted = [...reports].sort((x, y) => x.createdAt - y.createdAt)
  const parent = sorted.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++)
      if (matchPair(sorted[i], sorted[j])) parent[find(j)] = find(i)
  const groups = new Map<number, Report[]>()
  sorted.forEach((r, i) => {
    const k = find(i)
    groups.set(k, [...(groups.get(k) ?? []), r])
  })
  return [...groups.values()]
}

export function clusterCentroid(reports: Report[]) {
  return centroid(reports)
}

export interface DuplicateEval {
  precision: number
  recall: number
  truePairs: number
  predictedPairs: number
  correctPairs: number
  labelled: number
}

/** Pairwise precision/recall against `truthGroup` labels on a labelled sample. */
export function evaluateDuplicates(reports: Report[]): DuplicateEval {
  const labelled = reports.filter((r) => r.truthGroup)
  const clusterOf = new Map<string, number>()
  clusterReports(labelled).forEach((g, i) => g.forEach((r) => clusterOf.set(r.id, i)))
  let truePairs = 0
  let predictedPairs = 0
  let correctPairs = 0
  for (let i = 0; i < labelled.length; i++)
    for (let j = i + 1; j < labelled.length; j++) {
      const same = labelled[i].truthGroup === labelled[j].truthGroup
      const pred = clusterOf.get(labelled[i].id) === clusterOf.get(labelled[j].id)
      if (same) truePairs++
      if (pred) predictedPairs++
      if (same && pred) correctPairs++
    }
  return {
    precision: predictedPairs ? correctPairs / predictedPairs : 1,
    recall: truePairs ? correctPairs / truePairs : 1,
    truePairs,
    predictedPairs,
    correctPairs,
    labelled: labelled.length,
  }
}
