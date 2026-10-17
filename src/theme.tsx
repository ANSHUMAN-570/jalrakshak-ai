import { useSyncExternalStore } from 'react'

export type Theme = 'dark' | 'light'
const KEY = 'jalrakshak.theme'
const subs = new Set<() => void>()

const systemTheme = (): Theme => (typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function stored(): Theme | null {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'dark' || t === 'light' ? t : null
  } catch {
    return null
  }
}

function current(): Theme {
  if (typeof document !== 'undefined') {
    const t = document.documentElement.dataset.theme
    if (t === 'dark' || t === 'light') return t
  }
  return stored() ?? systemTheme()
}

export function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t
  document.documentElement.style.colorScheme = t
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#071B2C' : '#F5FAFC')
  subs.forEach((s) => s())
}

/** Explicit user choice: persisted. */
export function setTheme(t: Theme) {
  try {
    localStorage.setItem(KEY, t)
  } catch { /* private mode: the choice just will not persist */ }
  applyTheme(t)
}

// Follow the system setting only while the user has not chosen a theme themselves.
if (typeof matchMedia !== 'undefined') {
  matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
    if (!stored()) applyTheme(systemTheme())
  })
}

export function useTheme() {
  const theme = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    current,
    () => 'dark' as Theme,
  )
  return { theme, setTheme, toggle: () => setTheme(theme === 'dark' ? 'light' : 'dark') }
}

export function ThemeToggle({ className = '' }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const toLight = theme === 'dark'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      title={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      data-testid="theme-toggle"
      className={`inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/40 text-white transition hover:border-jal-cyan hover:text-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jal-cyan ${className}`}
    >
      {toLight ? (
        // sun: shown in dark mode, offers light
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true" focusable="false">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        // moon: shown in light mode, offers dark
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.7 6.7 0 0 0 9.8 9.8Z" />
        </svg>
      )}
    </button>
  )
}
