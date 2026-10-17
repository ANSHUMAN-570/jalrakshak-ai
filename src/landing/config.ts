/** The real application routes (defined in AppShell). Every landing-page CTA uses these. */
export const APP_ROUTE = '/dashboard'
export const REPORT_ROUTE = '/report'

export const SECTIONS = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'features', label: 'Features' },
  { id: 'impact', label: 'Impact' },
] as const
