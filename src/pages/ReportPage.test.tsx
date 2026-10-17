// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real map (Leaflet) needs a layout engine; replace it with buttons that call onPick like a click/drag would.
vi.mock('../components/LazyMaps', () => ({
  LazyLocationPicker: ({ onPick }: { onPick: (lat: number, lng: number) => void }) => (
    <div>
      <button onClick={() => onPick(28.61, 77.2)}>pick A</button>
      <button onClick={() => onPick(28.7, 77.3)}>pick B</button>
    </div>
  ),
  LazyIncidentMap: () => null,
}))

// The real camera is covered in LiveCapture.test.tsx; here a stub stands in so the form logic can be tested.
vi.mock('../components/LiveCapture', async () => {
  const { TINY_JPEG } = await import('../lib/fixtures')
  return {
    default: ({ value, onChange }: { value: unknown; onChange: (p: unknown) => void }) => (
      <div>
        <button type="button" onClick={() => onChange({ dataUrl: TINY_JPEG, capturedAtClient: '2026-10-17T10:00:00.000Z', width: 1, height: 1, bytes: 160 })}>capture stub</button>
        {value ? <span data-testid="photo-ok" /> : null}
      </div>
    ),
  }
})

import { clearAddressCache } from '../lib/address'
import { store } from '../lib/store'
import ReportPage from './ReportPage'

const body = (road: string) => ({
  display_name: `${road}, Test Suburb, Test City, Delhi, 110001, India`,
  address: { road, suburb: 'Test Suburb', city: 'Test City', state: 'Delhi', postcode: '110001' },
})

type Resp = { ok: boolean; status: number; json: () => Promise<unknown> }
const resp = (data: unknown, status = 200): Resp => ({ ok: status < 400, status, json: async () => data })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)))
  return { promise, resolve, reject }
}

const capture = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByText('capture stub'))
const lastReport = () => store.allReports()[store.allReports().length - 1]
const setup = () => {
  const user = userEvent.setup()
  render(<MemoryRouter><ReportPage /></MemoryRouter>)
  return user
}
const describeProblem = (user: ReturnType<typeof userEvent.setup>) =>
  user.type(screen.getByLabelText(/3\. Describe/), 'Water gushing from a broken pipe near the market')

/** Fill the rest of the form and submit. */
async function finish(user: ReturnType<typeof userEvent.setup>) {
  await describeProblem(user)
  await capture(user)
  await user.click(screen.getByRole('button', { name: 'Check my report' }))
  await user.click(screen.getByRole('checkbox'))
  await user.click(screen.getByRole('button', { name: 'Submit report' }))
}

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  localStorage.clear()
  clearAddressCache()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('automatic address', () => {
  it('1. shows a loading indicator, then the detected address for the selected point', async () => {
    const d = deferred<Resp>()
    fetchMock.mockReturnValue(d.promise)
    const user = setup()
    await user.click(screen.getByText('pick A'))
    expect(await screen.findByText(/Finding the address/)).toBeTruthy()
    expect(screen.getByTestId('selected-point').textContent).toContain('28.61000, 77.20000')
    d.resolve(resp(body('Alpha Road')))
    const text = await screen.findByTestId('auto-address-text')
    expect(text.textContent).toContain('Alpha Road')
    expect(screen.queryByText(/Finding the address/)).toBeNull()
  })

  it('2. no readable address: shows "Address unavailable" and keeps the coordinates', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'Unable to geocode' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    const panel = await screen.findByTestId('auto-address')
    await waitFor(() => expect(panel.textContent).toContain('Address unavailable'))
    expect(panel.textContent).not.toMatch(/undefined|null/)
    expect(screen.getByTestId('selected-point').textContent).toContain('28.61000, 77.20000')
  })

  it('7. moving the marker (a new pick) updates the address and the coordinates', async () => {
    fetchMock.mockImplementation(async (url: string) => resp(body(url.includes('lat=28.7') ? 'Beta Road' : 'Alpha Road')))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    expect((await screen.findByTestId('auto-address-text')).textContent).toContain('Alpha Road')
    await user.click(screen.getByText('pick B'))
    await waitFor(() => expect(screen.getByTestId('auto-address-text').textContent).toContain('Beta Road'))
    expect(screen.getByTestId('selected-point').textContent).toContain('28.70000, 77.30000')
  })

  it('11. a failed lookup shows an error with a working retry; nothing is invented', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Could not look up the address')
    fetchMock.mockResolvedValue(resp(body('Retry Road')))
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect((await screen.findByTestId('auto-address-text')).textContent).toContain('Retry Road')
  })

  it('12a. out-of-order responses: a slow answer for an old point never replaces the newer one', async () => {
    const a = deferred<Resp>()
    const b = deferred<Resp>()
    fetchMock.mockImplementation((url: string) => (url.includes('lat=28.7') ? b.promise : a.promise))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await user.click(screen.getByText('pick B'))
    b.resolve(resp(body('Newer Road')))
    await waitFor(() => expect(screen.getByTestId('auto-address-text').textContent).toContain('Newer Road'))
    a.resolve(resp(body('Stale Road')))
    await new Promise((r) => setTimeout(r, 30))
    expect(screen.getByTestId('auto-address-text').textContent).toContain('Newer Road')
    expect(screen.getByTestId('auto-address-text').textContent).not.toContain('Stale Road')
  })
})

describe('manual address', () => {
  it('3. a complete manual address is saved with the map coordinates unchanged (8)', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'Unable to geocode' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/House no/), '12 Main Street')
    await user.type(screen.getByLabelText(/Locality/), 'Sector 5')
    await user.type(screen.getByLabelText(/City/), 'Noida')
    await user.type(screen.getByLabelText('State'), 'Uttar Pradesh')
    await user.type(screen.getByLabelText(/PIN/), '201301')
    await finish(user)
    await screen.findByTestId('case-id')
    const r = lastReport()
    expect(r.address).toEqual({
      source: 'manual',
      formatted: '12 Main Street, Sector 5, Noida, Uttar Pradesh 201301',
      components: { line: '12 Main Street', locality: 'Sector 5', city: 'Noida', state: 'Uttar Pradesh', pin: '201301' },
    })
    expect(r.lat).toBeCloseTo(28.61, 6)
    expect(r.lng).toBeCloseTo(77.2, 6)
    expect(store.track(r.caseId)!.report.address?.source).toBe('manual') // retrievable afterwards
  })

  it('4. only locality and city is accepted', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'Unable to geocode' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/Locality/), 'Karol Bagh')
    await user.type(screen.getByLabelText(/City/), 'Delhi')
    await finish(user)
    await screen.findByTestId('case-id')
    expect(lastReport().address?.formatted).toBe('Karol Bagh, Delhi')
  })

  it('5/6. switching modes keeps both values, and typing never moves the selected point', async () => {
    fetchMock.mockResolvedValue(resp(body('Alpha Road')))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await screen.findByTestId('auto-address-text')
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/Locality/), 'My Colony')
    expect(screen.getByTestId('selected-point').textContent).toContain('28.61000, 77.20000')
    await user.click(screen.getByRole('tab', { name: 'Detect automatically' }))
    expect(screen.getByTestId('auto-address-text').textContent).toContain('Alpha Road')
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    expect((screen.getByLabelText(/Locality/) as HTMLInputElement).value).toBe('My Colony')
  })

  it('12b. a late geocoding response never overwrites what the user typed', async () => {
    const d = deferred<Resp>()
    fetchMock.mockReturnValue(d.promise)
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/Locality/), 'Typed Colony')
    d.resolve(resp(body('Late Road')))
    await new Promise((r) => setTimeout(r, 30))
    expect((screen.getByLabelText(/Locality/) as HTMLInputElement).value).toBe('Typed Colony')
    await finish(user)
    await screen.findByTestId('case-id')
    expect(lastReport().address).toMatchObject({ source: 'manual', formatted: 'Typed Colony' })
  })

  it('an invalid PIN blocks the review step with a clear message', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'x' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/PIN/), '123')
    await describeProblem(user)
    await capture(user)
    await capture(user)
  await user.click(screen.getByRole('button', { name: 'Check my report' }))
    expect((await screen.findAllByText(/PIN code must be 6 digits/)).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Submit report' })).toBeNull()
  })

  it('coordinates are never invented from a typed address (submit needs a selected point)', async () => {
    const user = setup()
    await user.click(screen.getByRole('tab', { name: 'Enter Address Manually' }))
    await user.type(screen.getByLabelText(/City/), 'Delhi')
    await describeProblem(user)
    await capture(user)
    await capture(user)
  await user.click(screen.getByRole('button', { name: 'Check my report' }))
    expect((await screen.findByRole('alert')).textContent).toContain('select a location')
    expect(screen.queryByRole('button', { name: 'Submit report' })).toBeNull()
  })
})

describe('submission', () => {
  it('8. auto address persists with source "auto"; fallback is saved as coordinates only', async () => {
    fetchMock.mockResolvedValue(resp(body('Saved Road')))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await screen.findByTestId('auto-address-text')
    await finish(user)
    await screen.findByTestId('case-id')
    expect(lastReport().address).toMatchObject({ source: 'auto' })
    expect(lastReport().address?.formatted).toContain('Saved Road')
  })

  it('a double click on Submit creates exactly one report', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'x' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await describeProblem(user)
    await capture(user)
    await capture(user)
  await user.click(screen.getByRole('button', { name: 'Check my report' }))
    await user.click(screen.getByRole('checkbox'))
    const before = store.allReports().length
    const btn = screen.getByRole('button', { name: 'Submit report' })
    await user.dblClick(btn)
    await screen.findByTestId('case-id')
    expect(store.allReports().length).toBe(before + 1)
  })

  it('a storage failure keeps the typed data and lets the user retry', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'x' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await describeProblem(user)
    await capture(user)
    await capture(user)
  await user.click(screen.getByRole('button', { name: 'Check my report' }))
    await user.click(screen.getByRole('checkbox'))
    const spy = vi.spyOn(store, 'submitReport').mockImplementationOnce(() => {
      throw new Error('quota exceeded')
    })
    await user.click(screen.getByRole('button', { name: 'Submit report' }))
    expect((await screen.findByRole('alert')).textContent).toContain('quota exceeded')
    expect((screen.getByLabelText(/3\. Describe/) as HTMLTextAreaElement).value).toContain('broken pipe')
    await user.click(screen.getByRole('button', { name: 'Submit report' }))
    await screen.findByTestId('case-id')
    spy.mockRestore()
  })
})


describe('mandatory live photo and routing result', () => {
  it('11. cannot continue without a captured photo, and nothing typed is lost', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'x' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await describeProblem(user)
    await user.click(screen.getByRole('button', { name: 'Check my report' }))
    expect((await screen.findByRole('alert')).textContent).toContain('capture a live photo')
    expect(screen.queryByRole('button', { name: 'Submit report' })).toBeNull()
    expect((screen.getByLabelText(/3\. Describe/) as HTMLTextAreaElement).value).toContain('broken pipe')
    await capture(user)
    await user.click(screen.getByRole('button', { name: 'Check my report' }))
    expect(await screen.findByRole('button', { name: 'Submit report' })).toBeTruthy()
  })

  it('14. the report form has no file input, so a gallery image cannot be chosen', () => {
    setup()
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('1/3/4. the success screen shows the department, the BMC helplines, and the not-registered notice (no officer is named without verified data)', async () => {
    fetchMock.mockResolvedValue(resp({ error: 'x' }))
    const user = setup()
    await user.click(screen.getByText('pick A'))
    await finish(user)
    await screen.findByTestId('case-id')
    const box = screen.getByTestId('responsible-contact')
    expect(box.getAttribute('data-kind')).toBe('department')
    expect(screen.getByTestId('match-message').textContent).toBe('Your complaint appears to concern BMC Water Works. We could not verify the currently responsible zone-level officer. Please contact BMC at 155304 or 1800-233-0014.')
    expect(box.textContent).toContain('does not register it with BMC')
    expect(box.textContent).toContain('+91-755-2701222')
    expect(screen.queryByTestId('matched-officer')).toBeNull()
    expect(box.textContent).not.toContain('9826273768') // unverified directory phone numbers never reach citizens
    expect(lastReport().match?.kind).toBe('department')
    expect(lastReport().photoMeta?.source).toBe('browser_camera_client_claim')
  })
})
