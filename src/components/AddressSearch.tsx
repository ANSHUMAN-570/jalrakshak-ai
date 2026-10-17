import { useEffect, useRef, useState } from 'react'
import { useLang } from '../i18n'
import { createLatest, searchAddress, type SearchHit } from '../lib/address'

export const SEARCH_DEBOUNCE_MS = 500

/** Debounced address search. Older requests are aborted and their late responses ignored. */
export default function AddressSearch({ onSelect }: { onSelect: (hit: SearchHit) => void }) {
  const { t } = useLang()
  const [q, setQ] = useState('')
  const [state, setState] = useState<{ status: 'idle' | 'loading' | 'done' | 'error'; hits: SearchHit[] }>({ status: 'idle', hits: [] })
  const latest = useRef(createLatest())
  const abort = useRef<AbortController | null>(null)

  useEffect(() => {
    const query = q.trim()
    abort.current?.abort()
    if (query.length < 3) {
      latest.current.invalidate()
      setState({ status: 'idle', hits: [] })
      return
    }
    const token = latest.current.next()
    const timer = setTimeout(() => {
      const ctl = new AbortController()
      abort.current = ctl
      setState({ status: 'loading', hits: [] })
      searchAddress(query, { signal: ctl.signal })
        .then((hits) => latest.current.isCurrent(token) && setState({ status: 'done', hits }))
        .catch((e: unknown) => {
          if ((e as Error)?.name === 'AbortError' || !latest.current.isCurrent(token)) return
          setState({ status: 'error', hits: [] })
        })
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      abort.current?.abort()
    }
  }, [q])

  return (
    <div>
      <label className="block text-sm font-medium" htmlFor="addr-search">{t('addrSearchLabel')}</label>
      <input
        id="addr-search"
        type="search"
        autoComplete="off"
        maxLength={150}
        className="mt-1 w-full rounded border p-2"
        value={q}
        placeholder={t('addrSearchPlaceholder')}
        onChange={(e) => setQ(e.target.value)}
      />
      <div aria-live="polite" className="text-sm">
        {state.status === 'loading' && <p className="mt-1 text-slate-500">{t('addrSearching')}</p>}
        {state.status === 'error' && <p className="mt-1 text-red-700">{t('addrSearchError')}</p>}
        {state.status === 'done' && state.hits.length === 0 && <p className="mt-1 text-slate-500">{t('addrNoResults')}</p>}
        {state.hits.length > 0 && (
          <ul className="mt-1 divide-y rounded border bg-white">
            {state.hits.map((h, i) => (
              <li key={`${h.lat},${h.lng},${i}`}>
                <button
                  type="button"
                  className="w-full p-2 text-left hover:bg-sky-50"
                  onClick={() => {
                    setState({ status: 'idle', hits: [] })
                    setQ('')
                    onSelect(h)
                  }}
                >
                  {h.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
