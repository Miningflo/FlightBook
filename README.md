# FlightBook

Personal EASA pilot logbook (AMC1 FCL.050) as an installable, offline-first PWA.
The Android phone is the master logbook; the same app in a desktop browser is a read-only viewer (Drive sync arrives in phase 5). No backend.

**Status:** all five phases are implemented: scaffold, core flight logging (with aircraft photos), airports + automatic night time, totals + currency, export / import / PDF, and Google Drive backup with a read-only viewer. Drive needs a Google client ID before it does anything (see [docs/google-cloud-setup.md](docs/google-cloud-setup.md)); without one the app works fully offline and the Drive screens say so. Airports/night, totals/currency, export/import and Google Drive backup are later phases.

## Setup
```
npm install
npm run dev          # http://localhost:5173
npm test             # Vitest unit tests
npm run typecheck
npm run build        # type-check + production build into dist/
npm run preview      # serve dist/ locally (service worker active)
```
Copy `.env.example` to `.env.local` to override `VITE_BASE` (default `/`) or set `VITE_GOOGLE_CLIENT_ID` (phase 5).

## Deploy to GitHub Pages
1. Push to a GitHub repo, then Settings → Pages → Source: **GitHub Actions**.
2. `.github/workflows/deploy.yml` builds with `VITE_BASE=/<repo-name>/` and publishes `dist/` on every push to `main`.
3. The app uses hash routing (`#/flight/…`), so no rewrite rules are needed.
4. For phase 5, add `https://<user>.github.io` (origins carry no path) to the OAuth client's authorised JavaScript origins.

## Install on Android
Open the deployed HTTPS URL in Chrome → ⋮ menu → **Install app** (or "Add to Home screen"). It then starts full-screen and works offline.
On first start choose **This device is the master logbook**; the app then asks the browser for *persistent storage* so Android does not evict your data. Settings shows whether it was granted.

## Data safety
- Data lives in IndexedDB on the device (Dexie). Times are integer minutes / UTC timestamps; totals are never stored.
- Schema changes go through versioned Dexie migrations (see the rules in `src/db/db.ts`). Version 2 (photos) is covered by a test that upgrades a v1 database and checks nothing is lost.
- Deleting a flight asks for confirmation; unsaved form edits ask before being discarded.
- Service-worker updates are never applied automatically; the app shows an "Update" prompt.
- Until the Drive backup phase exists, **there is no off-device backup**. Don't clear site data.

## Google Drive backup and the read-only viewer
Setup: [docs/google-cloud-setup.md](docs/google-cloud-setup.md) (consent screen in Testing mode, you as test user, every hosting origin as an authorised JavaScript origin). The client ID goes in `VITE_GOOGLE_CLIENT_ID`.
- **Device roles are explicit** (Settings → "This device is the master logbook"), never inferred from screen size. Only the master can edit, and only the master writes to Drive. A viewer is built with a read-only Drive client that has no write operations at all.
- **One master only.** The master keeps `master.json` (device id, name, claim time) in the "Logbook backups" folder. Taking the role from another device shows who holds it and requires explicit confirmation. If Drive holds a *newer snapshot from another device*, the dialog recommends restoring it first, because taking over with older data would make the older data the newest backup. Before every backup the master re-reads `master.json`; if another device has taken over, nothing is written and a banner offers "Take over again" or "Make this device a viewer".
- **Backups** are timestamped JSON snapshots carrying the schema version (`flightbook-snapshot-YYYYMMDDTHHMMSSZ.json`); the latest 30 are kept and only files with that exact naming are ever deleted. They run on app open (if the last success is over 24 h old), about 20 s after you save changes (a burst of edits makes one backup), when the connection returns, and from "Backup now". The last successful time is shown in Settings. If Google needs a sign-in that cannot be silent, a banner offers "Sign in and back up".
- **Restore** (master): pick a snapshot, see exactly what would be added, changed and removed, then either replace everything or only add what is missing. Replacing first saves a copy of what is on the device to Drive (`flightbook-prerestore-…`, last 5 kept) and is one all-or-nothing transaction.
- **Viewer**: loads the newest snapshot, runs schema migrations in memory, and shows the list, totals, currency and PDF/CSV export with all editing hidden. A banner reads "Read-only — snapshot from <time>, <device>" with Refresh. The last downloaded snapshot is cached on the device so it opens instantly and offline. The viewer never writes to Drive or changes a snapshot.
- **Limits**: access tokens last about an hour and the pop-up that renews them needs a tap (see the guide); in Testing mode Google may ask you to approve again about weekly. This was verified against a fake Google and Drive in two browsers plus a third device; the first real run with your client ID is the part only you can do.

## Export, import and backup (Settings → Export, import & backup)
- **PDF logbook**: A4 landscape, the AMC1 FCL.050 column structure, per-page totals, totals brought forward (page 1 starts from your previous experience), to-date totals, and a signature/date line. The layout is a pure specification (`src/domain/pdfLayout.ts`: columns, widths, pagination, totals) that the renderer (`src/features/export/pdfRender.ts`) only draws; its printed totals are tested against the Totals screen. Characters the built-in PDF font cannot show are replaced (accents dropped, `Ł`→`L`, otherwise `?`) and cut-off text is shortened; both are counted and reported after creation, and the full text stays in the CSV/JSON. pdf-lib is loaded only when a PDF is created.
  - `TODO(verify)`: the column set was written from memory of AMC1 FCL.050. Compare it with the current text or your paper logbook. Open choices: FSTD sessions are a separate section; PICUS/SPIC are printed in the remarks; landings are printed, take-offs are not.
- **CSV** (flights, simulator sessions, previous experience; one file each): spreadsheet-friendly and **round-trip exact** (tested with hostile text). Durations are `H:MM`, times are UTC ISO 8601, booleans `yes`/`no`, overrides `;`-separated. Text beginning with `= + - @` is written with a leading apostrophe so a spreadsheet cannot execute it, and the apostrophe is removed again on import. Import accepts files from elsewhere too (required columns: `date, dep_place, dep_time_utc, arr_place, arr_time_utc, registration, make, model, class, total, pic_name`); missing ids and timestamps are generated, a missing single/multi-pilot split is taken as single-pilot SE, and unused columns are listed, never silently dropped. Attachments cannot be held by CSV.
- **JSON backup**: everything in the logbook plus a schema version (`SNAPSHOT_SCHEMA_VERSION`, with an in-memory migration chain used for restore now and by the viewer in phase 5). It excludes the airports database, the photo cache and device settings (device name, master role, theme). A backup from a newer app version is refused, not guessed at.
- **Import and restore never overwrite silently.** Every record is classified before anything is written: *new*, *already there* (identical), *duplicate* (same flight under another id, or repeated in the file: skipped) or *conflict* (same id, different content: you choose to keep yours, the default, or replace). Invalid rows are listed with their line number and why; they block the import until you agree to skip them. The whole import is one transaction: if anything fails, nothing is written. Aircraft and people are matched by registration and name (ids are not carried across devices); restored settings only fill in values that are still empty.

## Map (bottom bar → Map)
Airports are circles with the number of flights that started or ended there (a local flight counts once); lines are the great-circle routes between airports, in either direction, thicker when flown more often. Tap an airport for its name and connections; drag, pinch or scroll to move and zoom; "show all" re-frames everything. A date range (all time, this year, 12 months, 90 days) filters it. Flights whose airport is not in the airports database cannot be drawn as routes; they are listed, and any airport that is known is still counted.
- Drawn by the app itself (Web Mercator, `src/domain/mapProjection.ts` and `mapData.ts`), so it works offline with no map library. The airports come from the OurAirports database (Settings), which a read-only viewer may import too since it is reference data.
- **Optional background**: "Show map background" loads OpenStreetMap tiles behind the routes. It is off by default because it sends the visible map area and your IP address to OpenStreetMap; tiles you have viewed stay cached for a week. The projection and tile numbering are the same as OpenStreetMap's, so airports line up exactly.

## Totals and currency
- **Totals** (bottom bar → Totals): flight time, simulator time, role breakdown (PIC / COPI / DUAL / INS with percentages of total flight time), single-pilot SE/ME, multi-pilot, PICUS, SPIC, night, IFR, take-offs and landings day/night, and per class. Date ranges: all time, this year, last 12 months, last 90 days, or custom. Everything is computed from the records; nothing is stored.
- **Simulator sessions** and **previous experience** (carry-in) are entered from the Totals screen. Previous experience is a list of records (one per paper logbook volume or period) with every category and optional per-class figures. A record is a lump sum, so a date range that cuts through its period leaves it out (the screen says so).
- **Currency** (bottom bar → Currency): passengers (3 take-offs + 3 landings in 90 days), passengers at night, and SEP (land) revalidation by experience with progress bars. Status is green / amber / red (never colour alone: icon and word too). Currency counts dated flights only, per aircraft class.
- **All regulatory numbers live in `src/domain/rules.ts` and are UNVERIFIED** (marked `TODO(verify)`, shown as an "Unverified rule" label on every card). Check them against the current EASA text, then set `verified: true`. Notable open points: the number of night take-offs/landings (3 is assumed, stricter than I believe EASA requires, so the app can only err towards "not current"), whether the logbook can prove the "sole manipulator" condition (it records no such flag), and the DUAL-time stand-in for the training flight with an instructor.
- Day-count boundaries are conservative (an event counts on its own day and the 89 days after). The amber and "urgent" thresholds (14 and 60 days) are app choices, not regulation.

## Airports and night time
1. **Settings → Airports database** (master only): download the public OurAirports `airports.csv` (about 13 MB) or choose a file you downloaded yourself. About 44,000 airports with a 4-character ICAO/GPS code are kept; closed airports and fields without a code are skipped and counted. Import only adds and updates, and a bad file is rejected before anything is written. The data is reference data: not part of backups, re-importable any time.
2. **Night time** = the part of the block time during which the sun's centre is more than 6° below the horizon (end of evening to start of morning civil twilight). The position moves along the great circle from the departure to the arrival airport at constant speed over the block time; each whole minute is classified by the sun's altitude at its midpoint. The result is an integer, never exceeds the block time, and adjacent flights add up exactly.
3. **Take-offs and landings** are marked day or night from the time and place at each end (off-blocks at the departure airport, on-blocks at the arrival airport). The calculation assumes one take-off and one landing; change the counts for circuits. Near twilight the real take-off/landing differs from the block times by a few minutes, so check borderline cases.
4. **Overrides**: any value you change by hand is kept, flagged "Overridden" (shown on the form and in the flight detail), and never replaced by a later recalculation; "Use computed" restores it. Opening an existing flight **never rewrites stored values**: values that differ from the computed ones are kept and marked as overridden.
5. If an airport is not in the database (or you have not imported it yet), enter night time and counts by hand.

**Sun position**: the app computes the sun's *geometric* altitude itself (Meeus, as in the NOAA solar calculator, `src/domain/sun.ts`). The `suncalc` library is not used at runtime: its `getPosition()` returns *apparent* altitude (refraction added, about 0.48° at every below-horizon angle), so testing it against -6° would make every twilight boundary about three minutes late. It is a dev-only dependency used by the tests as an independent cross-check (its `getTimes().dusk/dawn` agree with this code to within seconds).
`TODO(verify)`: confirm the regulatory wording of "night" (instructions.md definition) against the current EASA text; see `src/domain/night.ts`.

## Aircraft photos
Photos are decoration only, and the app stores no image data. Each aircraft shows:
1. **An online photo**, if *Settings → Look up aircraft photos online* is on (default): **Planespotters.net** first (the public API that flight-tracking sites embed), then **Wikimedia Commons**. Only the registration is sent (plus your IP address, as with any website). Commons results are accepted only if the file name contains the exact registration, so a wrong aircraft is never shown. The photographer and a link back are displayed. Only the image URL and credit text are cached on the device; the service worker caches the image itself for offline viewing and can drop it at any time.
2. **A generated placeholder**, coloured from the registration, when there is no photo, no network, or the setting is off.

There is deliberately no way to upload your own photos. The cache is device-local metadata and is never backed up, so it is not part of the logbook data.
The Planespotters response format follows its public documentation but could not be tested from the development environment (its bot protection blocks automated clients); see the `TODO(verify)` in `src/features/photos/planespotters.ts`. If it misbehaves, the app falls back to Commons, then a placeholder.

## Dependencies (each justified)
| Package | Why |
|---|---|
| react, react-dom | UI |
| dexie | IndexedDB with versioned schema migrations |
| vite, @vitejs/plugin-react, typescript | build tooling, strict TS |
| vite-plugin-pwa | manifest + service worker |
| pdf-lib | writes the PDF logbook (no native code, works offline; loaded on demand) |
| vitest, fake-indexeddb | unit tests, including database tests without a browser |
| @types/node | types for `vite.config.ts` |

| suncalc (dev only) | independent cross-check of the sun calculation in tests |

No UI library: Material 3 styling is plain CSS tokens in `src/styles.css`.

## Layout
`src/domain` pure logic (types, time, roles, form rules, suggestions) · `src/db` Dexie schema and repository · `src/features` screens · `src/ui` shared components · `src/pwa` service worker and storage helpers · `scripts/make-icons.mjs` regenerates the PNG icons.
