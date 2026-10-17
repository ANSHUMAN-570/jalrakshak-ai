import { useSyncExternalStore, type ReactNode } from 'react'
import { Card } from './components/ui'
import type { Actor, Role } from './lib/officers'

/**
 * DEMO-MODE ACCESS CONTROL. This build has no backend: the session below lives in the browser (sessionStorage),
 * so anyone can open the developer tools and change it. It is a usability gate for the demo and is NOT a security boundary.
 *
 * Real enforcement is implemented in the database (supabase/migrations/0002_*.sql: roles table, Row Level Security,
 * SECURITY DEFINER functions, triggers) and verified by supabase/tests/run_local.py. It becomes effective only when the
 * app is connected to Supabase Auth + Postgres; until then, production use is NOT safe.
 */

export interface Session {
  role: Role
  name: string
}

const KEY = 'jalrakshak.session'
const CITIZEN: Session = { role: 'citizen', name: 'Citizen' }
const subs = new Set<() => void>()
let cached: { raw: string | null; value: Session } | null = null

function read(): Session {
  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(KEY)
  } catch { /* storage blocked */ }
  if (cached && cached.raw === raw) return cached.value
  let value = CITIZEN
  if (raw) {
    try {
      const s = JSON.parse(raw) as Session
      if ((s.role === 'operator' || s.role === 'administrator') && typeof s.name === 'string' && s.name.trim()) value = { role: s.role, name: s.name.trim().slice(0, 60) }
    } catch { /* ignore */ }
  }
  cached = { raw, value }
  return value
}

export function signInDemo(role: 'operator' | 'administrator') {
  const s: Session = { role, name: role === 'administrator' ? 'Demo administrator' : 'Demo operator' }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(s))
  } catch { /* ignore */ }
  subs.forEach((f) => f())
}

export function signOut() {
  try {
    sessionStorage.removeItem(KEY)
  } catch { /* ignore */ }
  subs.forEach((f) => f())
}

export function useSession(): Session & { actor: Actor; isStaff: boolean } {
  const s = useSyncExternalStore(
    (cb) => (subs.add(cb), () => void subs.delete(cb)),
    read,
    () => CITIZEN,
  )
  return { ...s, actor: { name: s.name, role: s.role }, isStaff: s.role !== 'citizen' }
}

export const ROLE_LABEL: Record<Role, string> = { citizen: 'Citizen', operator: 'Operator', administrator: 'Administrator' }

export function AccessGate({ need }: { need: Role[] }) {
  const { role } = useSession()
  const adminOnly = need.length === 1 && need[0] === 'administrator'
  return (
    <div className="mx-auto max-w-xl" data-testid="access-gate">
      <Card title={adminOnly ? 'Administrator access required' : 'Operator sign-in required'}>
        <p className="text-sm text-fg">
          {adminOnly
            ? 'This area manages the officer directory, zones and audit log, and is limited to administrators.'
            : 'The operator dashboard shows citizen complaints and case details, so it is limited to authorized municipal staff. Citizens can still report and track complaints.'}
        </p>
        {role !== 'citizen' && adminOnly && <p className="mt-2 text-sm text-muted">You are signed in as {ROLE_LABEL[role].toLowerCase()}, which cannot open this page.</p>}
        <p className="mt-3 rounded bg-warn-bg p-3 text-xs text-warn-fg">
          <strong>Demo mode.</strong> This build has no server, so there are no real accounts: the buttons below simulate a sign-in inside your browser and are <strong>not a security boundary</strong>. In a deployment connected to Supabase, sign-in is handled by Supabase Auth and access is enforced by database policies (see <code>supabase/migrations</code>).
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {!adminOnly && (
            <button type="button" className="rounded bg-accent px-4 py-2 font-medium text-on-accent" onClick={() => signInDemo('operator')}>Continue as demo operator</button>
          )}
          <button type="button" className={`rounded px-4 py-2 font-medium ${adminOnly ? 'bg-accent text-on-accent' : 'border border-line text-fg'}`} onClick={() => signInDemo('administrator')}>
            Continue as demo administrator
          </button>
        </div>
      </Card>
    </div>
  )
}

/** Renders children only when the session has one of the roles; otherwise the gate. (Demo-mode UI gate, see the note above.) */
export function RequireRole({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { role } = useSession()
  return roles.includes(role) ? <>{children}</> : <AccessGate need={roles} />
}
