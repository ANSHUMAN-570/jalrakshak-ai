import { useEffect, useRef, useState } from 'react'

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    if (typeof matchMedia === 'undefined') return
    const mq = matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduced(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduced
}

/** True once the element has entered the viewport (stays true). Always true when IntersectionObserver is missing. */
export function useInView<T extends Element>(rootMargin = '0px 0px -10% 0px') {
  const ref = useRef<T>(null)
  const [seen, setSeen] = useState(typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = ref.current
    if (!el || seen) return
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true)
          io.disconnect()
        }
      },
      { rootMargin },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen, rootMargin])
  return [ref, seen] as const
}

/** Live visibility of an element (true while on screen). Used to pause the 3D render loop off-screen. */
export function useIsVisible<T extends Element>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return [ref, visible] as const
}

/**
 * WebGL is available, hardware accelerated, and the device is not obviously low powered.
 * `?3d=off` / `?3d=on` in the URL overrides detection (useful for testing and demos).
 */
export function canUse3D(): boolean {
  try {
    if (typeof document === 'undefined') return false
    const force = new URLSearchParams(location.search).get('3d')
    if (force === 'off') return false
    const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } }
    if (force !== 'on') {
      if (nav.connection?.saveData) return false
      if ((nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency ?? 8) <= 2) return false
    }
    const c = document.createElement('canvas')
    // failIfMajorPerformanceCaveat makes browsers refuse software (CPU) rendering, which would stall the page.
    const attrs = { failIfMajorPerformanceCaveat: force !== 'on' }
    const gl = (c.getContext('webgl2', attrs) || c.getContext('webgl', attrs)) as WebGLRenderingContext | null
    if (!gl) return false
    if (force !== 'on') {
      // Some browsers still hand out a CPU rasteriser without flagging it; detect it by name.
      const info = gl.getExtension('WEBGL_debug_renderer_info')
      const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : ''
      if (/swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer)) return false
    }
    return true
  } catch {
    return false
  }
}
