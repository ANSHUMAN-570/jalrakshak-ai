import { Component, lazy, Suspense, useState, type ReactNode } from 'react'
import { canUse3D, useIsVisible, usePrefersReducedMotion } from './hooks'

// Three.js is large: it is only downloaded when this component mounts and WebGL looks usable.
const Scene3D = lazy(() => import('./Scene3D'))

/** Static, lightweight stand-in. Also the placeholder shown until the 3D scene has painted its first frame. */
export function DropletFallback({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 400 400" className={className} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="jd-glow" cx="50%" cy="55%" r="55%">
          <stop offset="0" stopColor="#00C2D1" stopOpacity=".35" />
          <stop offset="1" stopColor="#00C2D1" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="jd-body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#45E6E0" />
          <stop offset="1" stopColor="#0B7BC4" />
        </linearGradient>
      </defs>
      <circle cx="200" cy="215" r="190" fill="url(#jd-glow)" />
      <ellipse cx="200" cy="215" rx="150" ry="52" fill="none" stroke="#45E6E0" strokeOpacity=".5" strokeWidth="3" transform="rotate(-18 200 215)" />
      <ellipse cx="200" cy="215" rx="125" ry="40" fill="none" stroke="#00C2D1" strokeOpacity=".4" strokeWidth="3" transform="rotate(24 200 215)" />
      <g className="motion-safe:animate-jal-float">
        <path d="M200 70C200 70 118 168 118 238a82 82 0 0 0 164 0C282 168 200 70 200 70Z" fill="url(#jd-body)" fillOpacity=".85" stroke="#EAFBFC" strokeOpacity=".6" strokeWidth="3" />
        <path d="M168 150c-22 30-38 62-34 92" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="8" strokeLinecap="round" />
      </g>
      {[[318, 130], [82, 250], [300, 318], [110, 120]].map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="6" fill={i === 0 ? '#38B878' : '#45E6E0'} />
          <circle cx={x} cy={y} r="13" fill="none" stroke="#45E6E0" strokeOpacity=".6" strokeWidth="2" />
        </g>
      ))}
    </svg>
  )
}

class Boundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function HeroVisual() {
  const reduced = usePrefersReducedMotion()
  const [ref, visible] = useIsVisible<HTMLDivElement>()
  const [enabled, setEnabled] = useState(() => canUse3D())
  const [ready, setReady] = useState(false)

  return (
    // Fixed aspect ratio: nothing moves when the 3D scene replaces the placeholder (no layout shift).
    <div ref={ref} className="relative mx-auto aspect-square w-full max-w-[520px]" data-testid="hero-visual" data-3d={enabled ? (ready ? 'ready' : 'loading') : 'fallback'}>
      <DropletFallback className={`absolute inset-0 h-full w-full transition-opacity duration-700 motion-reduce:transition-none ${ready ? 'opacity-0' : 'opacity-100'}`} />
      {enabled && (
        <Boundary onError={() => setEnabled(false)}>
          <Suspense fallback={null}>
            <div className={`absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none ${ready ? 'opacity-100' : 'opacity-0'}`}>
              <Scene3D active={visible} reduced={reduced} onReady={() => setReady(true)} onFail={() => setEnabled(false)} />
            </div>
          </Suspense>
        </Boundary>
      )}
      <p className="absolute inset-x-0 -bottom-1 text-center text-[11px] text-jal-mist">Illustrative visual, not live data</p>
    </div>
  )
}
