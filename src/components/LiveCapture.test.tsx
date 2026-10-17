// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LiveCapture, { cameraSupport, type CapturedPhoto } from './LiveCapture'

/** A fake MediaStream whose tracks record stop() calls. */
function fakeStream() {
  const tracks = [{ stop: vi.fn(), readyState: 'live' }, { stop: vi.fn(), readyState: 'live' }]
  return { tracks, stream: { getTracks: () => tracks } as unknown as MediaStream }
}

let getUserMedia: ReturnType<typeof vi.fn>
const streams: ReturnType<typeof fakeStream>[] = []

function Harness({ initial = null }: { initial?: CapturedPhoto | null }) {
  const [photo, setPhoto] = useState<CapturedPhoto | null>(initial)
  return (
    <div>
      <LiveCapture value={photo} onChange={setPhoto} />
      <output data-testid="photo-state">{photo ? 'has-photo' : 'no-photo'}</output>
    </div>
  )
}

beforeEach(() => {
  streams.length = 0
  getUserMedia = vi.fn(async () => {
    const f = fakeStream()
    streams.push(f)
    return f.stream
  })
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  // jsdom has no video decoding or canvas; provide just enough for a capture.
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', { configurable: true, get: () => 480 })
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined)
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({ drawImage: vi.fn() })) as never
  HTMLCanvasElement.prototype.toDataURL = vi.fn(() => 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=')
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const allStopped = (f: ReturnType<typeof fakeStream>) => f.tracks.every((t) => t.stop.mock.calls.length > 0)

describe('live camera capture', () => {
  it('does not request the camera until the user presses the button', () => {
    render(<Harness />)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Capture Live Photo' })).toBeTruthy()
  })

  it('has no file input anywhere (no gallery path)', () => {
    render(<Harness />)
    expect(document.querySelector('input[type=file]')).toBeNull()
  })

  it('12. shows a live preview, captures a still, shows the preview image, and 13. stops every camera track', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: expect.anything(), audio: false })
    const video = await screen.findByLabelText('Live camera preview')
    expect((video as HTMLVideoElement).srcObject).toBe(streams[0].stream)
    expect(streams[0].tracks.some((t) => t.stop.mock.calls.length)).toBe(false) // still running while previewing

    await user.click(screen.getByRole('button', { name: 'Take photo' }))
    expect(screen.getByTestId('photo-state').textContent).toBe('has-photo')
    expect(await screen.findByAltText(/Photo you captured/)).toBeTruthy()
    expect(allStopped(streams[0])).toBe(true) // camera released right after capture
    expect(screen.getByText(/not independently verified/)).toBeTruthy()
  })

  it('12. recapture: clears the photo, opens a fresh stream, and the second capture replaces the first', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))
    await user.click(screen.getByRole('button', { name: 'Retake photo' }))
    expect(screen.getByTestId('photo-state').textContent).toBe('no-photo')
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))
    expect(screen.getByTestId('photo-state').textContent).toBe('has-photo')
    expect(streams.every(allStopped)).toBe(true)
  })

  it('13. cancel stops the tracks and leaves no photo', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await screen.findByLabelText('Live camera preview')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(allStopped(streams[0])).toBe(true)
    expect(screen.getByTestId('photo-state').textContent).toBe('no-photo')
    expect(screen.getByRole('button', { name: 'Capture Live Photo' })).toBeTruthy()
  })

  it('13. unmounting while the camera is live (e.g. navigating away) stops the tracks', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await screen.findByLabelText('Live camera preview')
    unmount()
    expect(allStopped(streams[0])).toBe(true)
  })

  it('13. hiding the tab while live releases the camera', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await screen.findByLabelText('Live camera preview')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    expect(allStopped(streams[0])).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
  })

  it('10. permission denied: clear message, can try again, nothing else is lost', async () => {
    const user = userEvent.setup()
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('denied'), { name: 'NotAllowedError' }))
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/permission was denied/i)
    expect(screen.getByTestId('photo-state').textContent).toBe('no-photo')
    // retry succeeds after the user allows access
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    expect(await screen.findByLabelText('Live camera preview')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('no camera on the device: a specific message, not a crash', async () => {
    const user = userEvent.setup()
    getUserMedia.mockRejectedValueOnce(Object.assign(new Error('none'), { name: 'NotFoundError' }))
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/No usable camera/)
  })

  it('capture before the video has dimensions is refused instead of saving a blank image', async () => {
    const user = userEvent.setup()
    Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', { configurable: true, get: () => 0 })
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))
    expect(screen.getByTestId('photo-state').textContent).toBe('no-photo')
    expect(await screen.findByRole('alert')).toBeTruthy()
  })

  it('records client-provided metadata only (and says so)', async () => {
    const user = userEvent.setup()
    let captured: CapturedPhoto | null = null
    render(<LiveCapture value={null} onChange={(p) => { captured = p }} />)
    await user.click(screen.getByRole('button', { name: 'Capture Live Photo' }))
    await user.click(await screen.findByRole('button', { name: 'Take photo' }))
    await waitFor(() => expect(captured).not.toBeNull())
    const c = captured as unknown as CapturedPhoto
    expect(Object.keys(c).sort()).toEqual(['bytes', 'capturedAtClient', 'dataUrl', 'height', 'width'])
    expect(c.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(Number.isNaN(Date.parse(c.capturedAtClient))).toBe(false)
  })
})

describe('when live capture is not possible', () => {
  it('insecure (non-HTTPS) context: explains, offers no button and no fallback', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    render(<Harness />)
    expect(screen.getByTestId('camera-unavailable').textContent).toMatch(/HTTPS/)
    expect(screen.queryByRole('button', { name: 'Capture Live Photo' })).toBeNull()
    expect(document.querySelector('input[type=file]')).toBeNull()
    expect(cameraSupport()).toEqual({ ok: false, reason: 'insecure' })
  })

  it('browser without getUserMedia: explains, offers no button and no fallback', () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined })
    render(<Harness />)
    expect(screen.getByTestId('camera-unavailable').textContent).toMatch(/does not support live camera/)
    expect(screen.queryByRole('button', { name: 'Capture Live Photo' })).toBeNull()
    expect(document.querySelector('input[type=file]')).toBeNull()
    expect(cameraSupport()).toEqual({ ok: false, reason: 'unsupported' })
  })
})
