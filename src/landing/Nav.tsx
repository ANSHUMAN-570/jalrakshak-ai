import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { APP_ROUTE, SECTIONS } from './config'
import { usePrefersReducedMotion } from './hooks'
import { ThemeToggle } from '../theme'
import { Logo } from './Logo'

/** Smooth-scroll to a section, update the hash, and move focus there for keyboard / screen-reader users. */
export function useScrollTo() {
  const reduced = usePrefersReducedMotion()
  return useCallback(
    (id: string) => {
      const el = document.getElementById(id)
      if (!el) return
      el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' })
      history.replaceState(null, '', `#${id}`)
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus({ preventScroll: true })
    },
    [reduced],
  )
}

export function useActiveSection(): string {
  const [active, setActive] = useState('home')
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && setActive(e.target.id)),
      { rootMargin: '-35% 0px -60% 0px' },
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [])
  return active
}

export default function Nav() {
  const scrollTo = useScrollTo()
  const active = useActiveSection()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const toggleRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 16)
    on()
    window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        toggleRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const link = (id: string, label: string, mobile = false) => (
    <a
      key={id}
      href={`#${id}`}
      aria-current={active === id ? 'true' : undefined}
      onClick={(e) => {
        e.preventDefault()
        setOpen(false)
        scrollTo(id)
      }}
      className={`rounded px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jal-cyan ${
        active === id ? 'text-jal-cyan' : 'text-white/85 hover:text-white'
      } ${mobile ? 'block text-base' : ''}`}
    >
      {label}
    </a>
  )

  return (
    <header className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 motion-reduce:transition-none ${scrolled || open ? 'bg-jal-navy/95 shadow-lg shadow-black/20' : 'bg-transparent'}`}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4" aria-label="Main">
        <a href="#home" onClick={(e) => { e.preventDefault(); setOpen(false); scrollTo('home') }} aria-label="JalRakshak AI, back to top" className="rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-jal-cyan">
          <Logo />
        </a>
        <div className="hidden items-center gap-1 md:flex">{SECTIONS.map((s) => link(s.id, s.label))}</div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link to={APP_ROUTE} className="hidden rounded-lg bg-jal-aqua px-4 py-2 text-sm font-semibold text-jal-navy transition hover:bg-jal-cyan focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white sm:inline-block">
            Open Dashboard
          </Link>
          <button
            ref={toggleRef}
            type="button"
            className="rounded p-2 text-white md:hidden focus-visible:outline focus-visible:outline-2 focus-visible:outline-jal-cyan"
            aria-expanded={open}
            aria-controls="mobile-menu"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              {open ? <path d="M6 6l12 12M18 6 6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>
      {open && (
        <div id="mobile-menu" className="border-t border-white/10 px-4 pb-4 md:hidden">
          {SECTIONS.map((s) => link(s.id, s.label, true))}
          <Link to={APP_ROUTE} className="mt-2 block rounded-lg bg-jal-aqua px-4 py-3 text-center font-semibold text-jal-navy" onClick={() => setOpen(false)}>
            Open Dashboard
          </Link>
        </div>
      )}
    </header>
  )
}
