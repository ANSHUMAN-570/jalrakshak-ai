# JalRakshak AI (prototype)

Turns scattered citizen water-leak reports into prioritized, evidence-backed investigations.
React + Vite + Tailwind + Leaflet/OpenStreetMap. **All data is demo data stored in the browser's localStorage.** Nothing is sent to any government department.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # unit + UI tests (vitest, jsdom); also regenerates supabase/tests/parity.json
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

## Landing page

`/` is a public landing page (`src/landing/`); the application keeps its existing routes (`/dashboard`, `/report`, `/track`, `/analytics`) and every "open the app" button goes to `/dashboard` (single constant in `src/landing/config.ts`). The app logo links back to `/`, and unknown URLs redirect to `/`.

- **3D hero** (`Scene3D.tsx`): React Three Fiber + Three.js (v8 / React 18). A refractive droplet, flowing ribbons, particles and decorative map nodes. It is illustrative only, never live data. It is code-split and only downloaded when the browser has hardware WebGL; software renderers (SwiftShader/llvmpipe), Save-Data, and low-memory/low-core devices get a static SVG droplet instead. The render loop pauses when the hero is off-screen and stops entirely under `prefers-reduced-motion`.
- **Testing overrides:** `/?3d=on` forces the 3D scene, `/?3d=off` forces the static fallback.
- **Preview section** uses real screenshots of the app running on demo data (`public/preview-*.jpg`). Re-capture them if the UI changes.
- Brand colours are Tailwind tokens (`jal-navy`, `jal-aqua`, ...); the logo is `src/landing/Logo.tsx` and `public/favicon.svg`.
- The Three.js chunk is large (about 825 kB, 223 kB gzipped). It loads only for 3D-capable visitors, after the page is interactive.

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

## Roles, officer directory and routing

| Role | Can do |
|---|---|
| Citizen (no sign-in) | Report (live photo required), track a case by ID, see the routing suggestion and BMC contacts |
| Operator | See unassigned complaints and their own; **claim** a case; add inspection notes / evidence and change status **only on cases assigned to them** |
| Administrator | See everything; assign cases (recorded as *administrator-confirmed*); manage the officer directory, zones and the audit log at `/admin` |

**Routing is deterministic** (`src/lib/routing.ts`, mirrored in SQL by `match_responsible()` and checked for identical output on 135 generated scenarios). Category -> department by a fixed table (sewer and drainage are *not* Water Works); location -> zone **only** from administrator-entered zone boundaries; an officer is named only if exactly one **active, VERIFIED_OFFICIAL, currently verified (<= 180 days)** officer of that department covers that zone. Anything else shows the department and the BMC helplines. The AI/keyword classifier only suggests the category, which the citizen confirms. A report submitted here is **not** registered with BMC, and the app says so.

**Seeded officers** (`src/lib/officers.ts`): the four water-related records published by a third-party directory (`indiacustomercare.com`, page dated 28 Sep 2026) for Tanmay Vashisht Sharma, Udit Garg, J.A. Khan and H.C. Ladia. **All are UNVERIFIED**, with their source URL and a "not confirmed by BMC" note; unverified entries are shown to staff only, never to citizens, and never used as "the responsible officer". The head-office address, phone and e-mail come from the District Bhopal government directory (fetched and read). The helplines 155304 / 1800-233-0014 could not be read from the BMC portal (it is a JavaScript app), so they are flagged `NEEDS_REVIEW`. **No zone boundaries are bundled**, so out of the box every complaint falls back to department + helplines.

To get real officer matches: an administrator adds verified zone boundaries and verifies each officer record (source URL + note) at `/admin`. Verification is only reachable through the Verify action, editing a verified record sends it back to review, imports are always UNVERIFIED, and verification expires after 180 days.

## Live camera evidence

A new complaint requires a photo taken with `getUserMedia` (button -> permission request -> live preview -> capture -> preview -> retake). There is **no file input and no gallery fallback**. The camera is requested only after the button is pressed and every track is stopped after capture, on cancel, when the tab is hidden, and on unmount. Where capture is impossible (non-HTTPS, unsupported browser) the form says so and cannot be submitted. The data layer (and the SQL function) reject a missing, non-JPEG, oversized or malformed photo.

This does **not** prove the photo is genuine, recent, or taken at the reported location: the capture time is the citizen's device clock and is labelled client-provided everywhere. Old reports without a photo are kept and labelled "legacy".

## Dark / light theme

One token-based theme (`src/index.css` CSS variables, Tailwind colors such as `bg-surface`, `text-fg`) shared by the landing page and the app. First visit follows the system preference, the choice is saved, and an inline script in `index.html` applies it before first paint (no flash). Toggle in both headers. The spec accent `#007F91` is 4.49:1 on the light canvas, so *text* uses a slightly deeper `accent-text` (`#00788A`); fills keep the spec colour.

## Database (Supabase / PostgreSQL): written and tested, **not yet connected to the app**

Apply in order in the Supabase SQL editor (or `supabase db push`):

1. `0001_init.sql` - reports, cases, evidence, audit events, citizen functions
2. `0002_roles_officers_routing.sql` - roles, row-level security scoped to assigned cases, officers, zones, audit log, server-side routing, mandatory photo, assignment functions. Migrates `operators` into `user_roles`; legacy reports keep their rows (photo stays nullable).
3. `0003_storage.sql` - private `report-photos` bucket (JPEG, 1.5 MB) and access policies

Create the first administrator once, in the SQL editor: `insert into public.user_roles (user_id, role, display_name) values ('<auth user uuid>', 'administrator', 'Name');`

What the database enforces (none of it relies on the browser): role from `user_roles` via `auth.uid()`; operators see unassigned + own cases and can change only their own; assignment only through `claim_case` / `assign_case`; administrators only for roles, officers, zones, audit log; verification only through `verify_officer()` (plain UPDATE/INSERT cannot create a verified officer, even for the table owner); append-only audit log written by triggers; the public timeline contains no staff names or other citizens' case IDs; submissions need a JPEG that exists in the private bucket.

Verify locally (throwaway Postgres; Supabase roles, `auth.uid()` and the storage tables are stubbed, so Supabase Auth, the Storage HTTP API and gateway rate limiting are **not** tested):

```bash
pip install pgserver psycopg2-binary
npm test                              # regenerates supabase/tests/parity.json from the TypeScript engine
python supabase/tests/run_local.py    # 156 checks
```

Still to do for a real deployment: the Supabase client in the app (the data layer in `src/lib/store.ts` and `officers.ts` is synchronous localStorage today), real sign-in with Supabase Auth, uploading photos to the bucket, gateway-level rate limiting (the SQL throttle is per client-supplied reporter id and only stops accidents), and BMC verification of every officer and zone.

## Honest limits

- Prototype storage is localStorage; photos are JPEG data URLs. Each store (`src/lib/store.ts`, `officers.ts`) is the seam where Supabase would plug in.
- **Sign-in here is simulated** ("Continue as demo operator/administrator"). It lives in sessionStorage, so anyone can change it in the browser tools. It is a usability gate, **not a security boundary**; real enforcement exists only in the SQL layer and only once the app is connected to it.
- "Independent reporters" is an anonymous per-browser id, which is easy to game; a pilot would need stronger signals.
- The duplicate-detection precision/recall shown on `/analytics` is measured on a tiny hand-made labelled sample (6 reports). It demonstrates the method, not field accuracy.
- No claim is made about water saved. That needs flow measurements and a pilot with a utility.
- Demo pins are in a fictional demo area placed on a real map; they are not real incidents.

## Suggested demo flow

1. `/dashboard`: two nearby burst-pipe reports are one incident (score 92) with the factor breakdown.
2. Open the "repaired, evidence incomplete" case and show why it is not verified; try to close it and see the checklist block you.
3. `/report`: submit a report next to an existing pin and watch it link; check the case ID on `/track`.
4. `/analytics`: duplicates consolidated, response times, evidence completeness.
