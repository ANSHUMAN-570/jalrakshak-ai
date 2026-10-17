# JalRakshak AI (prototype)

Turns scattered citizen water-leak reports into prioritized, evidence-backed investigations.
React + Vite + Tailwind + Leaflet/OpenStreetMap. **All data is demo data stored in the browser's localStorage.** Nothing is sent to any government department.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # logic + report-form tests (vitest, jsdom)
npm run build      # type-check + production build
```

Deploy to Vercel as a static Vite app (`vercel.json` adds the SPA rewrite).

## What it does

| Page | Purpose |
|---|---|
| `/report` | Citizen form: photo, map pin or GPS, Hindi/English description, confirm detected issue type, consent, case ID |
| `/track` | Citizen looks up a case ID (public-safe status and timeline) |
| `/dashboard` | Map of incidents, ranked queue, score explanation, grouped reports, assign, evidence upload, status changes, audit trail |
| `/analytics` | Counts, response times, evidence completeness, duplicate-detection check, reset demo data |

## How it works (all transparent rules, no trained model)

- **Duplicates** (`src/lib/duplicates.ts`): two reports are linked when within 75 m and 72 h, and either share wording (Jaccard similarity >= 0.15) or the same specific issue type. Clusters via union-find.
- **Priority** (`src/lib/priority.ts`): `P = 0.35 S + 0.30 E + 0.20 R + 0.15 C`, every factor 0-100 and explained in the UI. S = max severity (never summed), E = evidence completeness, R = recency (48 h half-life), C = distinct reporters only, so duplicates and repeat submissions cannot inflate severity. This is an ordering heuristic, not a validated model and not proof a leak exists.
- **Verified closure** (`src/lib/rules.ts`): status can only move reported -> investigating -> inspected -> repaired -> closed. Repaired needs an after-photo; inspected needs a note; closed needs a before/citizen photo, note, after-photo and a named verifier. Cases marked repaired without that evidence show "evidence incomplete - not verified".
- **Language** (`src/lib/classify.ts`): English + Hindi keyword rules. The user confirms or edits the result before submitting. No API is required.

## Addresses

- On `/report`, picking a point (tap, drag the marker, search result, or "Use my location") reverse-geocodes it with OpenStreetMap **Nominatim** (no API key, no env vars) and shows the address with a loading state.
- "Enter Address Manually" offers line / locality / city / state / PIN (all optional). Typing never moves the map point; the point only changes when the user taps/drags/searches. Late geocoder answers for an old point are discarded and never overwrite typed text.
- If no address exists for a point, the UI shows "Address unavailable" plus the coordinates; nothing is invented. Coordinates are never derived from typed text.
- Saved on each report: `lat`, `lng`, `locationSource`, and optional `address: { source: 'auto' | 'manual', formatted, components }`. The field is optional, so reports saved before this change still load and show the fallback. Addresses are re-validated and cleaned in `store.submitReport` (PIN format, length, control characters).
- Shown on: report form, selected-point panel, review step, success screen, `/track`, dashboard queue cards, case detail, grouped reports and map tooltips.
- **Nominatim usage policy:** the public server is for light use (about 1 request/second, no bulk traffic). Lookups are debounced, aborted when superseded, and cached in memory (about 11 m grid, never persisted). For a real deployment, use a hosted/self-hosted geocoder behind a small server-side proxy (also keeps any paid key off the client).
- No database migration is needed for this prototype (localStorage). With Supabase later, add nullable columns `address_source text`, `address_formatted text`, `address_components jsonb` to the reports table; existing rows stay valid.

## Honest limits

- Prototype storage is localStorage; photos are downscaled data URLs. The only file that touches storage is `src/lib/store.ts`, which is where Supabase/PostgreSQL + Storage would plug in (not implemented).
- No authentication: the operator name is a self-entered label. Production needs real accounts and roles.
- "Independent reporters" is an anonymous per-browser id, which is easy to game; a pilot would need stronger signals.
- The duplicate-detection precision/recall shown on `/analytics` is measured on a tiny hand-made labelled sample (6 reports). It demonstrates the method, not field accuracy.
- No claim is made about water saved. That needs flow measurements and a pilot with a utility.
- Demo pins are in a fictional demo area placed on a real map; they are not real incidents.

## Suggested demo flow

1. `/dashboard`: two nearby burst-pipe reports are one incident (score 92) with the factor breakdown.
2. Open the "repaired, evidence incomplete" case and show why it is not verified; try to close it and see the checklist block you.
3. `/report`: submit a report next to an existing pin and watch it link; check the case ID on `/track`.
4. `/analytics`: duplicates consolidated, response times, evidence completeness.
