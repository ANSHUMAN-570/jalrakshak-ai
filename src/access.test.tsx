// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./components/LazyMaps', () => ({ LazyLocationPicker: () => null, LazyIncidentMap: () => null }))

import App from './App'
import { signInDemo, signOut } from './auth'
import { directory } from './lib/officers'
import { store } from './lib/store'

const open = (path: string) => {
  window.history.pushState({}, '', path)
  return render(<App />)
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  store.reset()
  directory.reset()
})
afterEach(() => {
  cleanup()
  signOut()
  window.history.pushState({}, '', '/')
})

describe('6. citizens cannot reach staff pages', () => {
  it('a citizen at /dashboard sees only the gate: no complaints, no addresses, no operator controls', async () => {
    open('/dashboard')
    expect(await screen.findByTestId('access-gate')).toBeTruthy()
    expect(screen.queryByText('Ranked investigation queue')).toBeNull()
    expect(screen.queryByTestId('queue-address')).toBeNull()
    expect(screen.queryByText(/Case actions/)).toBeNull()
    expect(document.body.textContent).not.toContain('Kartavya Path') // seeded complaint data is not rendered
    expect(document.body.textContent).toMatch(/not a security boundary/i) // and the gate is honest about demo mode
  })

  it('/analytics and /admin are gated the same way; nav links to staff pages are hidden', async () => {
    open('/analytics')
    expect(await screen.findByRole('heading', { name: 'Operator sign-in required' })).toBeTruthy()
    cleanup()
    open('/report')
    const nav = await screen.findByRole('navigation', { name: 'Main' })
    expect(within(nav).queryByText('Operator dashboard')).toBeNull()
    expect(within(nav).queryByText('Analytics')).toBeNull()
    expect(within(nav).queryByText('Admin')).toBeNull()
    expect(within(nav).getByText('Report a leak')).toBeTruthy()
    expect(within(nav).getByText('Track a case')).toBeTruthy()
  })

  it('citizens can still report and track complaints', async () => {
    open('/track?id=JR-DEMO-0001')
    expect(await screen.findByTestId('track-address')).toBeTruthy()
    expect(screen.getByTestId('responsible-contact')).toBeTruthy()
  })
})

describe('9. operators cannot use administrator pages', () => {
  it('a signed-in operator at /admin is stopped at the administrator gate; admin nav link is absent', async () => {
    signInDemo('operator')
    open('/admin')
    expect(await screen.findByRole('heading', { name: 'Administrator access required' })).toBeTruthy()
    expect(screen.getByText(/signed in as operator/i)).toBeTruthy()
    expect(screen.queryByText('Officer directory administration')).toBeNull()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).queryByText('Admin')).toBeNull()
  })

  it('an administrator can open /admin and sees the Admin link', async () => {
    signInDemo('administrator')
    open('/admin')
    expect(await screen.findByRole('heading', { name: 'Officer directory administration' })).toBeTruthy()
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Admin')).toBeTruthy()
  })

  it('sign out returns to citizen access', async () => {
    const user = userEvent.setup()
    signInDemo('operator')
    open('/dashboard')
    expect(await screen.findByRole('heading', { name: 'Operator dashboard' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByTestId('access-gate')).toBeTruthy()
    expect(screen.queryByTestId('session-badge')).toBeNull()
  })

  it('a tampered session value does not grant a role', async () => {
    sessionStorage.setItem('jalrakshak.session', JSON.stringify({ role: 'superuser', name: 'x' }))
    open('/admin')
    expect(await screen.findByTestId('access-gate')).toBeTruthy()
    cleanup()
    sessionStorage.setItem('jalrakshak.session', '{not json')
    open('/dashboard')
    expect(await screen.findByTestId('access-gate')).toBeTruthy()
  })
})

describe('8. operators work only on assigned complaints (UI level)', () => {
  it('operator sees only unassigned + own cases; must claim before changing status', async () => {
    const user = userEvent.setup()
    signInDemo('operator')
    open('/dashboard')
    const rows = await screen.findAllByTestId('queue-address')
    // the closed 'Field team 2' case and nobody else's work is hidden from this operator
    expect(screen.getByTestId('dash-scope-note').textContent).toMatch(/Operator view/)
    const total = store.incidents().length
    expect(rows.length).toBeLessThan(total)

    // open an unassigned incident
    await user.click(rows[0].closest('button')!)
    expect(await screen.findByTestId('detail-assignment')).toBeTruthy()
    const mark = screen.queryAllByRole('button', { name: /^Mark / })
    for (const b of mark) expect((b as HTMLButtonElement).disabled).toBe(true) // not claimed yet
    await user.click(screen.getByRole('button', { name: 'Assign to me' }))
    await waitFor(() => expect(screen.getByTestId('detail-assignment').textContent).toMatch(/Demo operator/))
    expect(screen.getByTestId('detail-assignment').textContent).toMatch(/Self-assigned, not administrator-confirmed/)
    const after = screen.getAllByRole('button', { name: /^Mark / }) as HTMLButtonElement[]
    expect(after.length).toBeGreaterThan(0)
    expect(after.every((b) => !b.disabled)).toBe(true)
    await user.click(screen.getByRole('button', { name: 'Mark investigating' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/Status set to investigating/)
  })

  it('an administrator sees every complaint and can assign (administrator-confirmed)', async () => {
    const user = userEvent.setup()
    signInDemo('administrator')
    open('/dashboard')
    const rows = await screen.findAllByTestId('queue-address')
    expect(rows.length).toBe(store.incidents().length)
    expect(screen.getByTestId('dash-scope-note').textContent).toMatch(/Administrator view/)
    await user.click(rows[0].closest('button')!)
    await user.type(await screen.findByLabelText('Assign to'), 'Demo operator')
    await user.click(screen.getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(screen.getByTestId('detail-assignment').textContent).toMatch(/Administrator-confirmed/))
  })

  it('the dashboard shows the routing result, labelled as a system suggestion, with unverified listings marked staff-only', async () => {
    const user = userEvent.setup()
    signInDemo('administrator')
    open('/dashboard')
    const rows = await screen.findAllByTestId('queue-address')
    await user.click(rows[0].closest('button')!)
    const box = await screen.findByTestId('responsible-contact')
    expect(box.textContent).toContain('System suggestion (rule-based)')
    expect(box.textContent).toContain('155304')
    expect(within(box).getByTestId('staff-candidates').textContent).toMatch(/NOT verified/)
    expect(within(box).queryByTestId('matched-officer')).toBeNull()
  })
})

describe('officer administration (UI level)', () => {
  it('lists the four seeded records as UNVERIFIED with their sources and "never verified"', async () => {
    signInDemo('administrator')
    open('/admin')
    const rows = await screen.findAllByTestId('officer-row')
    expect(rows).toHaveLength(4)
    for (const r of rows) {
      expect(r.getAttribute('data-status')).toBe('UNVERIFIED')
      expect(r.textContent).toMatch(/never verified/)
      expect(r.textContent).toMatch(/third party directory/)
      expect(r.querySelector('a')!.getAttribute('href')).toContain('indiacustomercare.com')
    }
    expect(screen.getByTestId('dir-counts').textContent).toContain('UNVERIFIED: 4')
  })

  it('verification needs a source, a note and an explicit confirmation; then it is dated and audited', async () => {
    const user = userEvent.setup()
    signInDemo('administrator')
    open('/admin')
    const row = (await screen.findAllByTestId('officer-row')).find((r) => r.textContent!.includes('J.A. Khan'))!
    await user.click(within(row).getByRole('button', { name: 'Verify…' }))
    const form = await within(row).findByTestId('verify-form')
    const submit = within(form).getByRole('button', { name: 'Mark as verified' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true) // confirmation checkbox first
    await user.click(within(form).getByRole('checkbox'))
    await user.click(submit)
    expect((await within(form).findByRole('alert')).textContent).toMatch(/source URL/)
    await user.type(within(form).getByLabelText('Verification source URL'), 'https://example.org/bmc-zone-list')
    await user.type(within(form).getByLabelText('Verification notes'), 'Confirmed zones 01-08 with water works office')
    await user.click(submit)
    await waitFor(() => expect(directory.officers().find((o) => o.full_name.includes('Khan'))!.verification_status).toBe('VERIFIED_OFFICIAL'))
    const updated = directory.officers().find((o) => o.full_name.includes('Khan'))!
    expect(updated.verified_by).toBe('Demo administrator')
    expect(updated.verified_at).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(directory.audit()[0]).toMatchObject({ action: 'officer.verify', actor: 'Demo administrator', role: 'administrator' })
    expect((await screen.findByTestId('audit-table')).textContent).toContain('officer.verify')
  })

  it('editing a verified record resets it for review and says so', async () => {
    const user = userEvent.setup()
    const khan = directory.officers().find((o) => o.full_name.includes('Khan'))!
    directory.verify(khan.officer_id, { source_url: 'https://example.org/x', notes: 'verified for the test run' }, { name: 'Demo administrator', role: 'administrator' })
    signInDemo('administrator')
    open('/admin')
    const row = (await screen.findAllByTestId('officer-row')).find((r) => r.textContent!.includes('J.A. Khan'))!
    await user.click(within(row).getByRole('button', { name: 'Edit' }))
    const form = await screen.findByTestId('officer-form')
    expect(form.textContent).toMatch(/sends it back to NEEDS_REVIEW/)
    const designation = within(form).getByText('Designation').closest('label')!.querySelector('input')!
    await user.type(designation, ' (updated)')
    await user.click(within(form).getByRole('button', { name: 'Save' }))
    expect((await screen.findByRole('status')).textContent).toMatch(/reset to NEEDS_REVIEW/)
    expect(directory.get(khan.officer_id)!.verification_status).toBe('NEEDS_REVIEW')
  })

  it('CSV import previews errors and imports only valid rows as UNVERIFIED', async () => {
    const user = userEvent.setup()
    signInDemo('administrator')
    open('/admin')
    const csv = [
      'full_name,designation,department,assigned_zones,official_phone,office_name,source_url,source_type,last_checked_at,verification_status',
      'Import Person One,Assistant Engineer,WATER_WORKS,10,0755-4100001,Zone Office,https://example.org/list,official_directory,2026-10-10,VERIFIED_OFFICIAL',
      'Broken Row,Eng,WRONG,10,0755-4100002,Zone Office,https://example.org/list,official_directory,2026-10-10,',
    ].join('\n')
    await user.click(await screen.findByLabelText('CSV text'))
    await user.paste(csv)
    const prev = await screen.findByTestId('csv-preview')
    expect(prev.textContent).toMatch(/1 valid row\(s\), 1 error\(s\)/)
    expect(prev.textContent).toMatch(/always UNVERIFIED/)
    await user.click(within(prev).getByRole('button', { name: /Import 1 valid row/ }))
    await waitFor(() => expect(directory.officers().some((o) => o.full_name === 'Import Person One')).toBe(true))
    expect(directory.officers().find((o) => o.full_name === 'Import Person One')!.verification_status).toBe('UNVERIFIED')
  })

  it('zones reject a malformed boundary and accept a valid one', async () => {
    const user = userEvent.setup()
    signInDemo('administrator')
    open('/admin')
    await user.type(await screen.findByLabelText('Zone id'), '77')
    await user.type(screen.getByLabelText('Zone name'), 'Test zone')
    await user.click(screen.getByLabelText('Zone boundary'))
    await user.paste('[[1,2],[3,4]]')
    await user.click(screen.getByRole('button', { name: 'Save zone' }))
    expect((await screen.findAllByRole('alert')).some((a) => /at least 3/.test(a.textContent!))).toBe(true)
    expect(directory.zones()).toHaveLength(0)
    await user.clear(screen.getByLabelText('Zone boundary'))
    await user.click(screen.getByLabelText('Zone boundary'))
    await user.paste('[[23.2,77.4],[23.2,77.5],[23.3,77.5]]')
    await user.click(screen.getByRole('button', { name: 'Save zone' }))
    await waitFor(() => expect(directory.zones()).toHaveLength(1))
  })
})
