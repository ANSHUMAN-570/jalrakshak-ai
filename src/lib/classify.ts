import type { Category } from './types'

/**
 * Transparent keyword rules (English + Hindi). No model is trained and no API is
 * needed, so the core product works offline. An LLM could be layered on top, but
 * the user always confirms the result before submitting.
 */
const CATEGORY_RULES: { category: Category; base: number; words: string[] }[] = [
  { category: 'burst_main', base: 85, words: ['burst', 'gushing', 'broken pipe', 'main pipe', 'फट', 'फव्वारा', 'टूट'] },
  { category: 'contamination', base: 70, words: ['dirty', 'muddy', 'smell', 'sewage', 'contaminat', 'गंदा', 'गंदे', 'बदबू', 'कीचड़', 'मटमैला'] },
  { category: 'pipe_leak', base: 60, words: ['leak', 'drip', 'seep', 'लीक', 'रिसाव', 'टपक', 'रिस'] },
  { category: 'meter_valve', base: 45, words: ['meter', 'valve', 'tap ', 'मीटर', 'वाल्व', 'नल'] },
  { category: 'overflow', base: 40, words: ['overflow', 'tank', 'ओवरफ्लो', 'टंकी', 'टंकी'] },
]

const URGENCY_WORDS: { word: string; label: string }[] = [
  { word: 'flood', label: 'flooding' },
  { word: 'बाढ़', label: 'flooding' },
  { word: 'road', label: 'road affected' },
  { word: 'सड़क', label: 'road affected' },
  { word: 'hospital', label: 'near hospital' },
  { word: 'अस्पताल', label: 'near hospital' },
  { word: 'school', label: 'near school' },
  { word: 'स्कूल', label: 'near school' },
  { word: 'days', label: 'ongoing for days' },
  { word: 'दिन से', label: 'ongoing for days' },
  { word: 'दिनों', label: 'ongoing for days' },
  { word: 'gush', label: 'high flow' },
  { word: 'बहुत पानी', label: 'high flow' },
  { word: 'तेज', label: 'high flow' },
  { word: 'urgent', label: 'urgent' },
  { word: 'तुरंत', label: 'urgent' },
]

export const CATEGORY_LABELS: Record<Category, { en: string; hi: string }> = {
  burst_main: { en: 'Burst pipe / main', hi: 'पाइप फटना' },
  pipe_leak: { en: 'Pipe leak', hi: 'पाइप रिसाव' },
  meter_valve: { en: 'Meter / valve leak', hi: 'मीटर / वाल्व रिसाव' },
  contamination: { en: 'Dirty / contaminated water', hi: 'गंदा पानी' },
  overflow: { en: 'Tank overflow', hi: 'टंकी ओवरफ्लो' },
  other: { en: 'Other / unclear', hi: 'अन्य / अस्पष्ट' },
}

export interface Analysis {
  category: Category
  severity: number
  urgencyHints: string[]
  landmark?: string
}

export function severityFor(category: Category, urgencyHints: string[]): number {
  const base = CATEGORY_RULES.find((r) => r.category === category)?.base ?? 25
  return Math.min(100, base + Math.min(urgencyHints.length, 3) * 5)
}

export function analyzeText(text: string): Analysis {
  const t = text.toLowerCase()
  const rule = CATEGORY_RULES.find((r) => r.words.some((w) => t.includes(w)))
  const category: Category = rule?.category ?? 'other'
  const urgencyHints = [...new Set(URGENCY_WORDS.filter((u) => t.includes(u.word)).map((u) => u.label))]
  return { category, severity: severityFor(category, urgencyHints), urgencyHints, landmark: extractLandmark(text) }
}

function extractLandmark(text: string): string | undefined {
  const en = /(?:near|opposite|behind|outside)\s+([A-Za-z0-9][A-Za-z0-9 ]{2,40}?)(?:[,.]|$|\s+(?:and|where|which|there))/i.exec(text)
  if (en) return en[1].trim()
  const hi = /([ऀ-ॿ][ऀ-ॿ ]{1,30}?)\s*(?:के पास|के सामने|के पीछे)/.exec(text)
  if (hi) return hi[1].trim()
  return undefined
}
