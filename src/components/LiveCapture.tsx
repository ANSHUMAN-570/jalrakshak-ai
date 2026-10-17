import { useCallback, useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n'

/** A photo taken with the live camera in this browser. Everything here is CLIENT-PROVIDED, not independently verified. */
export interface CapturedPhoto {
  dataUrl: string
  capturedAtClient: string
  width: number
  height: number
  bytes: number
}

type Phase = 'idle' | 'starting' | 'live' | 'captured' | 'denied' | 'error'

const MAX_EDGE = 1280

export function cameraSupport(): { ok: boolean; reason?: 'insecure' | 'unsupported' } {
  if (typeof window === 'undefined') return { ok: false, reason: 'unsupported' }
  if (window.isSecureContext === false) return { ok: false, reason: 'insecure' }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') return { ok: false, reason: 'unsupported' }
  return { ok: true }
}

/**
 * Live camera capture. The camera is only requested after the user presses "Capture Live Photo".
 * There is deliberately NO file input and no gallery fallback: the required evidence can only come from getUserMedia.
 * All tracks are stopped after capture, on cancel, when the tab is hidden, and on unmount.
 */
export default function LiveCapture({ value, onChange }: { value: CapturedPhoto | null; onChange: (p: CapturedPhoto | null) => void }) {
  const { t } = useLang()
  const [phase, setPhase] = useState<Phase>(value ? 'captured' : 'idle')
  const [message, setMessage] = useState('')
  const video = useRef<HTMLVideoElement>(null)
  const stream = useRef<MediaStream | null>(null)
  const support = cameraSupport()

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((tr) => tr.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }, [])

  useEffect(() => stop, [stop])

  // Release the camera if the user switches tab/app while it is live.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden' && stream.current) {
        stop()
        setPhase('idle')
      }
    }
    document.addEventListener('visibilitychange', onHide)
    return () => document.removeEventListener('visibilitychange', onHide)
  }, [stop])

  // Attach the stream once the <video> element exists.
  useEffect(() => {
    if (phase === 'live' && video.current && stream.current) {
      video.current.srcObject = stream.current
      void video.current.play?.().catch(() => {})
    }
  }, [phase])

  const start = async () => {
    setMessage('')
    stop()
    setPhase('starting')
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false })
      stream.current = s
      setPhase('live')
    } catch (e) {
      const name = (e as DOMException)?.name
      if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') setPhase('denied')
      else {
        setMessage(name === 'NotFoundError' || name === 'OverconstrainedError' ? t('camNoCamera') : t('camError'))
        setPhase('error')
      }
    }
  }

  const take = () => {
    const v = video.current
    if (!v || !v.videoWidth || !v.videoHeight) {
      setMessage(t('camNotReady'))
      return
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(v.videoWidth, v.videoHeight))
    const w = Math.round(v.videoWidth * scale)
    const h = Math.round(v.videoHeight * scale)
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')
    if (!ctx) {
      setMessage(t('camError'))
      return
    }
    ctx.drawImage(v, 0, 0, w, h)
    const dataUrl = c.toDataURL('image/jpeg', 0.8)
    stop()
    const bytes = Math.round(((dataUrl.length - dataUrl.indexOf(',') - 1) * 3) / 4)
    onChange({ dataUrl, capturedAtClient: new Date().toISOString(), width: w, height: h, bytes })
    setPhase('captured')
  }

  const cancel = () => {
    stop()
    setPhase(value ? 'captured' : 'idle')
    setMessage('')
  }

  const retake = () => {
    onChange(null)
    void start()
  }

  const btn = 'rounded px-4 py-2 font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent'

  if (!support.ok)
    return (
      <p role="alert" className="rounded bg-warn-bg p-3 text-sm text-warn-fg" data-testid="camera-unavailable">
        {support.reason === 'insecure' ? t('camInsecure') : t('camUnsupported')}
      </p>
    )

  return (
    <div className="space-y-3" data-testid="live-capture">
      {(phase === 'idle' || phase === 'denied' || phase === 'error') && (
        <div>
          <button type="button" className={`${btn} bg-accent text-on-accent`} onClick={start}>{t('captureBtn')}</button>
          <p className="mt-2 text-xs text-muted">{t('camWhy')}</p>
        </div>
      )}

      {phase === 'starting' && <p className="text-sm text-muted" role="status">{t('camStarting')}</p>}

      {phase === 'live' && (
        <div>
          <video ref={video} aria-label={t('camPreviewLabel')} className="aspect-[4/3] w-full max-w-md rounded-lg bg-black object-cover" autoPlay playsInline muted />
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={`${btn} bg-accent text-on-accent`} onClick={take}>{t('takePhoto')}</button>
            <button type="button" className={`${btn} border border-line text-fg`} onClick={cancel}>{t('camCancel')}</button>
          </div>
        </div>
      )}

      {phase === 'captured' && value && (
        <div>
          <img src={value.dataUrl} alt={t('capturedAlt')} width={value.width} height={value.height} className="h-auto max-h-64 w-auto max-w-full rounded-lg" decoding="async" />
          <p className="mt-1 text-xs text-ok" role="status">{t('photoCaptured')}</p>
          <p className="text-xs text-muted">{t('photoMetaNote')}</p>
          <button type="button" className={`${btn} mt-2 border border-line text-fg`} onClick={retake}>{t('retake')}</button>
        </div>
      )}

      <div aria-live="polite" className="text-sm">
        {phase === 'denied' && <p role="alert" className="rounded bg-danger-bg p-2 text-danger-fg">{t('camDenied')}</p>}
        {(phase === 'error' || (phase === 'live' && message)) && message && <p role="alert" className="rounded bg-danger-bg p-2 text-danger-fg">{message}</p>}
      </div>
    </div>
  )
}
