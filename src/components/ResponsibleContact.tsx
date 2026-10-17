import { BMC_CONTACTS } from '../lib/officers'
import type { ResponsibleMatch } from '../lib/routing'

const tel = (n: string) => `tel:${n.replace(/[^+\d]/g, '')}`

function Contacts() {
  return (
    <ul className="mt-2 space-y-1 text-sm" aria-label="BMC contacts">
      <li>
        {BMC_CONTACTS.helpline.label}: <a className="font-semibold text-accent-text underline" href={tel(BMC_CONTACTS.helpline.phone)}>{BMC_CONTACTS.helpline.phone}</a>
      </li>
      <li>
        {BMC_CONTACTS.support.label}: <a className="font-semibold text-accent-text underline" href={tel(BMC_CONTACTS.support.phone)}>{BMC_CONTACTS.support.phone}</a>
      </li>
      <li>
        {BMC_CONTACTS.office.label}: <a className="text-accent-text underline" href={tel(BMC_CONTACTS.office.phone)}>{BMC_CONTACTS.office.phone}</a>,{' '}
        <a className="text-accent-text underline" href={`mailto:${BMC_CONTACTS.office.email}`}>{BMC_CONTACTS.office.email}</a>
        <span className="block text-xs text-muted">{BMC_CONTACTS.office.address}</span>
      </li>
    </ul>
  )
}

/**
 * Who a complaint is likely to concern. Citizen view: department, a named officer ONLY when verified, otherwise the
 * BMC helplines. Staff view additionally lists unverified directory entries, clearly labelled.
 */
export default function ResponsibleContact({ match, staff = false }: { match: ResponsibleMatch | undefined; staff?: boolean }) {
  if (!match)
    return (
      <section className="rounded-lg border border-line bg-elevated p-4 text-sm" data-testid="responsible-contact" data-kind="legacy">
        <h3 className="font-semibold text-fg">Responsible department</h3>
        <p className="mt-1 text-muted">Routing was not recorded for this report (it was submitted before routing existed). Please contact BMC directly.</p>
        <Contacts />
      </section>
    )

  const officer = match.officer
  return (
    <section className="rounded-lg border border-line bg-elevated p-4 text-sm" data-testid="responsible-contact" data-kind={match.kind}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-fg">Responsible department</h3>
        <span className="rounded bg-info-bg px-2 py-0.5 text-xs font-medium text-info-fg">System suggestion (rule-based)</span>
      </div>

      <p className="mt-2 text-fg" data-testid="match-message">{match.message}</p>

      {officer && (
        <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]" data-testid="matched-officer">
          <dt className="text-muted">Name</dt>
          <dd className="font-medium text-fg">{officer.full_name}</dd>
          <dt className="text-muted">Designation</dt>
          <dd className="text-fg">{officer.designation}</dd>
          <dt className="text-muted">Assigned area</dt>
          <dd className="text-fg">{officer.zone}</dd>
          <dt className="text-muted">Office</dt>
          <dd className="text-fg">{officer.office_name}</dd>
          {officer.official_phone && (
            <>
              <dt className="text-muted">Phone</dt>
              <dd><a className="text-accent-text underline" href={tel(officer.official_phone)}>{officer.official_phone}</a></dd>
            </>
          )}
          <dt className="text-muted">Data status</dt>
          <dd className="text-fg">
            <span className="rounded bg-ok-bg px-2 py-0.5 text-xs font-medium text-ok-fg">{match.verification}</span>
            {match.lastVerifiedAt && <span className="ml-2 text-xs text-muted">verified {match.lastVerifiedAt}</span>}
            {match.sourceUrl && (
              <a className="ml-2 text-xs text-accent-text underline" href={match.sourceUrl} target="_blank" rel="noopener noreferrer">source</a>
            )}
          </dd>
        </dl>
      )}

      <p className="mt-3 text-xs text-muted" data-testid="match-explanation">Why: {match.explanation}</p>
      <p className="mt-2 rounded bg-warn-bg p-2 text-xs text-warn-fg">
        Submitting a report to JalRakshak AI does <strong>not</strong> register it with BMC. To lodge an official complaint, contact BMC using the details below.
      </p>
      <Contacts />

      {staff && match.staffCandidates.length > 0 && (
        <div className="mt-3 rounded border border-dashed border-line p-3" data-testid="staff-candidates">
          <p className="text-xs font-semibold text-fg">Directory listings that are NOT verified (staff only; do not treat as the responsible officer)</p>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {match.staffCandidates.map((c) => (
              <li key={c.officer_id}>
                <span className="font-medium text-fg">{c.full_name}</span>, {c.designation} <span className="rounded bg-warn-bg px-1.5 py-0.5 text-warn-fg">{c.verification_status}</span>
                <span className="block">{c.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
