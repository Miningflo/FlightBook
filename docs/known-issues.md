# Known issues and limits

What FlightBook is known not to do, or to do imperfectly, as of 24 November 2026. Each entry says where it
lives in the code, so it can be picked up later. Fixed items are removed from this list, not struck through.

## Behaviour you may notice

- **Backups wait for a tap once the Google token has expired.** Google's token flow opens its sign-in window
  for every new token, so the app only asks from a tap. A token lasts about an hour and is kept in memory, so
  after that hour, or after reopening the app, an automatic backup stops at the banner "Your latest changes are
  not backed up yet… Sign in and back up". A read-only viewer keeps showing its last copy until **Refresh**.
  `src/drive/gis.ts`. Removing the tap would need Google's authorisation-code flow, which needs a server.
- **Only one Drive snapshot per day is kept.** A later backup replaces any earlier one from the same day
  (UTC), so a mistake made today can only be undone back to yesterday's last snapshot, not to earlier today. A
  "replace everything" restore still saves its own safety copy first. `src/domain/driveRules.ts`
  (`dailyRetentionPlan`).
- **Fixing a flight without a type rating does not take you back to the list.** The Currency card lists those
  flights and opens each one's edit form, but saving shows the flight; you return to Currency yourself for the
  next one. `src/features/currency/CurrencyScreen.tsx` (`StrandedFlightList`), `src/features/flights/FlightFormScreen.tsx`.
- **Expiry dates are compared to today's UTC date.** For an hour or two after local midnight in Europe, a
  medical, rating or endorsement that expired the day before still shows "0 days left". `utcDateOf(Date.now())`
  in `src/features/currency/CurrencyScreen.tsx` and `src/pwa/alertCheck.ts`.

## Limits not yet reached

- **Drive backups use the simple multipart upload, which Google caps at 5 MB.** A snapshot is plain JSON of the
  whole logbook. Attachments cannot be added in the app yet, so only a very large logbook would hit it; the
  backup would then fail with an error banner. Switching to the resumable upload removes the cap.
  `src/drive/driveApi.ts` (`createJson`).
- **Aircraft created by an import do not remember their type rating.** Flights keep theirs, but the aircraft
  record made for a new registration has none, so typing that registration on the flight form does not pre-fill
  the rating. `src/domain/records.ts` (`aircraftFromFlight`).

## Regulatory limits

What the logbook cannot know or does not track is listed per rule in the `todo` of each entry in
`src/domain/rules.ts`, and shown on the matching card under "How this is calculated". That file is the source
of truth; the main ones:

- There is no "pilot flying" flag, so every logged take-off and landing counts towards recent experience.
- Simulator (FFS) take-offs and landings never count, although FCL.060 allows them. Approaches are not recorded.
- DUAL time stands in for the SEP/TMG refresher flight with an FI or CRI.
- SEP/TMG revalidation counts the selected class only; combined SEP/TMG or land/sea holdings are not modelled.
- "Route sector" is not defined in Part-FCL, so both readings are shown and the stricter one sets the status.
  The one-sector-with-an-examiner alternative is not tracked, and for type ratings the 12-month window assumes
  the default 1-year validity rather than one set by the OSD.
- The app never works out a validity period itself (medical, type rating, language endorsement): you enter the
  date from your licence. Medical age-band edges are explained on the card but not checked.
- The figures are EASA's; a UK CAA licence follows different wording.

## Tooling

- **No UI tests.** Vitest runs in Node without a DOM, so screens are checked by hand in a browser.
- **ESLint is not installed**, although the code carries `eslint-disable react-hooks` comments; the hooks rules
  are never actually checked.
- **`scripts/make-screenshots.mjs`** says to run `npx vite preview` without `VITE_BASE`; it must be
  `VITE_BASE=/FlightBook/ npx vite preview …`, or the page loads blank.
- **`npm audit`** reports 4 moderate issues, all in build-time tooling (minimatch via vite-plugin-pwa). The
  suggested fix downgrades vite-plugin-pwa, so they are left until upstream updates.
