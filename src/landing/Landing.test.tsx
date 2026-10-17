// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Leaflet needs a real layout engine; the app's map wrappers are stubbed for the route test.
vi.mock('../components/LazyMaps', () => ({ LazyLocationPicker: () => null, LazyIncidentMap: () => null }))

import App from '../App'
import { APP_ROUTE, SECTIONS } from './config'
import Landing from './Landing'

const renderLanding = () => render(<MemoryRouter><Landing /></MemoryRouter>)
const scrollSpy = vi.fn()

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  Element.prototype.scrollIntoView = scrollSpy
  scrollSpy.mockClear()
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  window.history.pushState({}, '', '/')
})

describe('landing page content', () => {
  it('has the headline, tagline, and every nav section', () => {
    renderLanding()
    expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/Every Drop Matters\.\s*Every Leak Counts\./)
    expect(screen.getByText('Smarter Water Management. Stronger Communities.')).toBeTruthy()
    for (const s of SECTIONS) expect(document.getElementById(s.id), s.id).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Turning Water Reports Into Action' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Technology With a Purpose' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: "Let's Make Every Drop Count." })).toBeTruthy()
  })

  it('shows the four workflow steps in order', () => {
    renderLanding()
    const steps = within(document.getElementById('how-it-works')!).getAllByRole('listitem')
    expect(steps.map((s) => within(s).getByRole('heading').textContent)).toEqual(['Report', 'Analyze', 'Prioritize', 'Track Resolution'])
  })

  it('labels exactly one feature as Planned and never claims it as available', () => {
    renderLanding()
    const planned = screen.getAllByText('Planned')
    expect(planned).toHaveLength(1)
    expect(planned[0].closest('article')!.textContent).toMatch(/not done yet/)
  })

  it('invents no statistics', () => {
    renderLanding()
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\d[\d,.]*\s*(%|litres|liters|million|thousand)/i)
  })

  it('footer: current year, verification statement, no fake affiliations', () => {
    renderLanding()
    const footer = screen.getByRole('contentinfo')
    expect(footer.textContent).toContain(`© ${new Date().getFullYear()} JalRakshak AI`)
    expect(footer.textContent).toMatch(/require appropriate verification/)
    expect(footer.textContent).toMatch(/not connected to any government department/)
    expect(footer.querySelector('a[href^="http"]')).toBeNull() // no invented social/partner links
  })

  it('the preview images have meaningful alt text and fixed dimensions', () => {
    renderLanding()
    const imgs = [...document.querySelectorAll('#preview img')] as HTMLImageElement[]
    expect(imgs).toHaveLength(2)
    for (const i of imgs) {
      expect(i.alt.length).toBeGreaterThan(30)
      expect(i.getAttribute('width') && i.getAttribute('height')).toBeTruthy()
    }
  })

  it('renders the static fallback when WebGL is unavailable (jsdom has none)', () => {
    renderLanding()
    expect(screen.getByTestId('hero-visual').getAttribute('data-3d')).toBe('fallback')
    expect(document.querySelector('canvas')).toBeNull()
  })
})

describe('CTAs and navigation', () => {
  it('every "open the app" button links to the real app route', () => {
    renderLanding()
    for (const name of ['Open Dashboard', 'Explore the Platform', 'Launch JalRakshak AI', 'Open JalRakshak AI']) {
      const links = screen.getAllByRole('link', { name: new RegExp(name) })
      expect(links.length, name).toBeGreaterThan(0)
      for (const l of links) expect(l.getAttribute('href'), name).toBe(APP_ROUTE)
    }
    expect(APP_ROUTE).toBe('/dashboard')
  })

  it('"See How It Works" and "Explore the Workflow" scroll to the workflow section', async () => {
    const user = userEvent.setup()
    renderLanding()
    for (const name of ['See How It Works', 'Explore the Workflow']) {
      scrollSpy.mockClear()
      await user.click(screen.getByRole('link', { name }))
      expect(scrollSpy, name).toHaveBeenCalledTimes(1)
      expect(scrollSpy.mock.instances[0]).toBe(document.getElementById('how-it-works'))
      expect(scrollSpy.mock.calls[0][0]).toMatchObject({ behavior: 'smooth' })
    }
  })

  it('uses instant scrolling when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    const user = userEvent.setup()
    renderLanding()
    await user.click(screen.getByRole('link', { name: 'See How It Works' }))
    expect(scrollSpy.mock.calls[0][0]).toMatchObject({ behavior: 'auto' })
  })

  it('nav links scroll to their sections and update the hash', async () => {
    const user = userEvent.setup()
    renderLanding()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    await user.click(within(nav).getByRole('link', { name: 'Features' }))
    expect(scrollSpy.mock.instances[0]).toBe(document.getElementById('features'))
    expect(location.hash).toBe('#features')
  })

  it('mobile menu: toggles aria-expanded, lists the links, closes on Escape', async () => {
    const user = userEvent.setup()
    renderLanding()
    const btn = screen.getByRole('button', { name: 'Open menu' })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    await user.click(btn)
    expect(screen.getByRole('button', { name: 'Close menu' }).getAttribute('aria-expanded')).toBe('true')
    const menu = document.getElementById('mobile-menu')!
    expect(within(menu).getAllByRole('link').map((l) => l.textContent)).toEqual(['Home', 'About', 'How It Works', 'Features', 'Impact', 'Open Dashboard'])
    await user.keyboard('{Escape}')
    await waitFor(() => expect(document.getElementById('mobile-menu')).toBeNull())
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open menu' }))
  })

  it('the landing nav has a labelled theme toggle', () => {
    renderLanding()
    expect(screen.getByTestId('theme-toggle').getAttribute('aria-label')).toMatch(/Switch to (light|dark) theme/)
  })

  it('has a skip link and the primary CTA is keyboard reachable', async () => {
    const user = userEvent.setup()
    renderLanding()
    expect(screen.getByText('Skip to content').getAttribute('href')).toBe('#main')
    const cta = screen.getByRole('link', { name: /Explore the Platform/ })
    cta.focus()
    expect(document.activeElement).toBe(cta)
    await user.keyboard('{Enter}')
  })
})

describe('routing: landing is the entry point and the app still works', () => {
  it('/ shows the landing page; the CTA opens the dashboard route (behind the operator gate); the logo returns', async () => {
    const user = userEvent.setup()
    window.history.pushState({}, '', '/')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /Every Drop Matters/ })).toBeTruthy()

    await user.click(screen.getAllByRole('link', { name: /Explore the Platform/ })[0])
    expect(location.pathname).toBe('/dashboard')
    // citizens do not get the dashboard: they get the sign-in gate, and no complaint data is rendered
    expect(await screen.findByTestId('access-gate')).toBeTruthy()
    expect(screen.queryByText('Ranked investigation queue')).toBeNull()
    expect(screen.queryAllByTestId('queue-address')).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: 'Continue as demo operator' }))
    expect(await screen.findByRole('heading', { name: 'Operator dashboard' })).toBeTruthy()
    expect((await screen.findAllByTestId('queue-address')).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('link', { name: /home/i }))
    expect(await screen.findByRole('heading', { level: 1, name: /Every Drop Matters/ })).toBeTruthy()
    expect(location.pathname).toBe('/')
  })

  it('existing app URLs still resolve: public pages directly, staff pages behind the gate', async () => {
    for (const [path, heading] of [['/report', 'Report a water leak'], ['/track', 'Track a case']]) {
      cleanup()
      window.history.pushState({}, '', path)
      render(<App />)
      expect(await screen.findByRole('heading', { name: heading }), path).toBeTruthy()
    }
    for (const [path, gate] of [['/dashboard', 'Operator sign-in required'], ['/analytics', 'Operator sign-in required'], ['/admin', 'Administrator access required']]) {
      cleanup()
      window.history.pushState({}, '', path)
      render(<App />)
      expect(await screen.findByRole('heading', { name: gate }), path).toBeTruthy()
    }
  })

  it('an unknown URL goes back to the landing page', async () => {
    window.history.pushState({}, '', '/no-such-page')
    render(<App />)
    expect(await screen.findByRole('heading', { level: 1, name: /Every Drop Matters/ })).toBeTruthy()
    expect(location.pathname).toBe('/')
  })
})
