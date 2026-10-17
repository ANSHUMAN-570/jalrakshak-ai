// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Mq = { matches: boolean; listeners: Set<() => void> }
function mockMatchMedia(prefersDark: boolean) {
  const mq: Mq = { matches: prefersDark, listeners: new Set() }
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: /prefers-color-scheme: dark/.test(q) ? mq.matches : false,
    media: q,
    addEventListener: (_: string, l: () => void) => mq.listeners.add(l),
    removeEventListener: (_: string, l: () => void) => mq.listeners.delete(l),
    addListener() {}, removeListener() {},
  }))
  return mq
}

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.style.colorScheme = ''
  vi.resetModules()
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

// The inline script in index.html runs before first paint; execute exactly that script.
const bootScript = (() => {
  const html = readFileSync('index.html', 'utf8')
  const m = /<script>([\s\S]*?)<\/script>/.exec(html)!
  return m[1]
})()
const runBoot = () => new Function(bootScript)()

describe('no flash of the wrong theme (inline boot script in index.html)', () => {
  it('uses the saved choice first', () => {
    mockMatchMedia(true)
    localStorage.setItem('jalrakshak.theme', 'light')
    runBoot()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
  })
  it('first visit: follows a dark system preference', () => {
    mockMatchMedia(true)
    runBoot()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('first visit: follows a light system preference', () => {
    mockMatchMedia(false)
    runBoot()
    expect(document.documentElement.dataset.theme).toBe('light')
  })
  it('ignores a corrupted saved value', () => {
    mockMatchMedia(true)
    localStorage.setItem('jalrakshak.theme', '<script>')
    runBoot()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
  it('the script is in <head> before the app bundle so it runs before first paint', () => {
    const html = readFileSync('index.html', 'utf8')
    expect(html.indexOf('jalrakshak.theme')).toBeGreaterThan(-1)
    expect(html.indexOf('jalrakshak.theme')).toBeLessThan(html.indexOf('src="/src/main.tsx"'))
  })
})

describe('theme toggle', () => {
  async function mount(prefersDark: boolean, boot = true) {
    mockMatchMedia(prefersDark)
    if (boot) runBoot()
    const { ThemeToggle } = await import('./theme')
    render(<ThemeToggle />)
    return userEvent.setup()
  }

  it('16. switches both ways, updates the document, and labels the action accessibly', async () => {
    const user = await mount(true)
    const btn = screen.getByTestId('theme-toggle')
    expect(btn.getAttribute('aria-label')).toBe('Switch to light theme') // currently dark
    await user.click(btn)
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(document.documentElement.style.colorScheme).toBe('light')
    expect(screen.getByTestId('theme-toggle').getAttribute('aria-label')).toBe('Switch to dark theme')
    await user.click(screen.getByTestId('theme-toggle'))
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('the icon is decorative (aria-hidden) and the button is keyboard operable', async () => {
    const user = await mount(false)
    const btn = screen.getByTestId('theme-toggle')
    expect(btn.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true')
    btn.focus()
    await user.keyboard('{Enter}')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('17. the choice persists: after a "reload" the boot script restores it', async () => {
    const user = await mount(true)
    await user.click(screen.getByTestId('theme-toggle')) // dark -> light, saved
    expect(localStorage.getItem('jalrakshak.theme')).toBe('light')
    cleanup()
    document.documentElement.removeAttribute('data-theme')
    vi.resetModules()
    mockMatchMedia(true) // system still says dark
    runBoot()
    expect(document.documentElement.dataset.theme).toBe('light') // saved choice beats the system preference
    const { ThemeToggle } = await import('./theme')
    render(<ThemeToggle />)
    expect(screen.getByTestId('theme-toggle').getAttribute('aria-label')).toBe('Switch to dark theme')
  })

  it('follows live system changes only while the user has not chosen a theme', async () => {
    const mq = mockMatchMedia(false)
    runBoot()
    const { ThemeToggle } = await import('./theme')
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('light')
    mq.matches = true
    mq.listeners.forEach((l) => l())
    expect(document.documentElement.dataset.theme).toBe('dark')
    // once the user picks a theme, system changes are ignored
    await userEvent.setup().click(screen.getByTestId('theme-toggle')) // -> light (saved)
    mq.matches = true
    mq.listeners.forEach((l) => l())
    expect(document.documentElement.dataset.theme).toBe('light')
  })
})

describe('theme tokens', () => {
  const css = readFileSync('src/index.css', 'utf8')
  const light = /:root\s*\{([\s\S]*?)\}/.exec(css)![1]
  const dark = /\[data-theme='dark'\]\s*\{([\s\S]*?)\}/.exec(css)![1]
  const tok = (block: string, name: string) => new RegExp(`--c-${name}:\\s*([\\d ]+);`).exec(block)![1].trim().split(/\s+/).map(Number)
  const hex = (rgb: number[]) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase()

  it('dark palette matches the specification', () => {
    expect(hex(tok(dark, 'canvas'))).toBe('#071B2C')
    expect(hex(tok(dark, 'surface'))).toBe('#0B2740')
    expect(hex(tok(dark, 'elevated'))).toBe('#103650')
    expect(hex(tok(dark, 'accent'))).toBe('#00C2D1')
    expect(hex(tok(dark, 'accent2'))).toBe('#45E6E0')
    expect(hex(tok(dark, 'fg'))).toBe('#F4FBFF')
    expect(hex(tok(dark, 'muted'))).toBe('#A9C0CE')
    expect(hex(tok(dark, 'ok'))).toBe('#38B878')
  })
  it('light palette matches the specification', () => {
    expect(hex(tok(light, 'canvas'))).toBe('#F5FAFC')
    expect(hex(tok(light, 'surface'))).toBe('#FFFFFF')
    expect(hex(tok(light, 'elevated'))).toBe('#EAF4F8')
    expect(hex(tok(light, 'accent'))).toBe('#007F91')
    expect(hex(tok(light, 'accent2'))).toBe('#00A6B5')
    expect(hex(tok(light, 'accent-text'))).toBe('#00788A')
    expect(hex(tok(light, 'fg'))).toBe('#102A3A')
    expect(hex(tok(light, 'muted'))).toBe('#536B7A')
    expect(hex(tok(light, 'ok'))).toBe('#168652')
  })

  const lum = (c: number[]) => { const [r, g, b] = c.map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
  const ratio = (a: number[], b: number[]) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05)

  it('18. text/background token pairs meet WCAG AA (4.5:1) in both themes', () => {
    for (const [name, block] of [['light', light], ['dark', dark]] as const) {
      const pairs: [string, string][] = [['fg', 'canvas'], ['fg', 'surface'], ['fg', 'elevated'], ['muted', 'canvas'], ['muted', 'surface'], ['muted', 'elevated'], ['accent-text', 'canvas'], ['accent-text', 'surface'], ['accent-text', 'elevated'], ['on-accent', 'accent'], ['on-accent', 'ok'], ['ok-fg', 'ok-bg'], ['danger-fg', 'danger-bg'], ['warn-fg', 'warn-bg'], ['info-fg', 'info-bg'], ['danger', 'canvas'], ['ok', 'surface'], ['ok-fg', 'canvas']]
      for (const [fg, bg] of pairs) {
        const r = ratio(tok(block, fg), tok(block, bg))
        expect(r, `${name}: ${fg} on ${bg} = ${r.toFixed(2)}`).toBeGreaterThanOrEqual(4.5)
      }
    }
  })
})
