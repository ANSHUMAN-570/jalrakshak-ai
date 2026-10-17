/** JalRakshak AI mark: a water drop whose centre is a location-pin target. */
export function LogoMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true" focusable="false">
      <path d="M32 6C32 6 14 27 14 40a18 18 0 0 0 36 0C50 27 32 6 32 6Z" fill="#00C2D1" />
      <path d="M32 6C32 6 14 27 14 40a18 18 0 0 0 5 12.4C14 41 25 21 32 6Z" fill="#45E6E0" opacity=".55" />
      <circle cx="32" cy="39" r="8" fill="#071B2C" />
      <circle cx="32" cy="39" r="3.2" fill="#45E6E0" />
    </svg>
  )
}

export function Logo({ dark = true, className = '' }: { dark?: boolean; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-jal-navy'}`}>
        JalRakshak <span className="text-jal-aqua">AI</span>
      </span>
    </span>
  )
}
