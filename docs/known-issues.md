# Known issues and limits

What FlightBook is known not to do, or to do imperfectly, as of 24 November 2026. Each entry says where it
lives in the code, so it can be picked up later. Fixed items are removed from this list, not struck through.

## Behaviour you may notice

- **Backups wait for a tap once the Google token has expired.** Google's token flow opens its sign-in window
  for every new token, so the app only asks from a tap. A token lasts about an hour and is kept in memory, so
  after that hour, or after reopening the app, an automatic backup stops at the banner "Your latest changes are
  not backed up yet… Sign in and back up". A read-only viewer keeps showing its last copy until **Refresh**.
  `src/drive/gis.ts`. Removing the tap would need Google's authorisation-code flow, which needs a server.

## By design

Chosen on purpose; listed so the consequence is not a surprise.

- **One Drive snapshot per day, by request.** A later backup replaces any earlier one from the same day
  (UTC), so a mistake made today can only be undone back to yesterday's last snapshot, not to earlier today. A
  "replace everything" restore still saves its own safety copy first. `src/domain/driveRules.ts`
  (`dailyRetentionPlan`).

## Limits not yet reached

- **Drive backups use the simple multipart upload, which Google caps at 5 MB.** A snapshot is plain JSON of the
  whole logbook. Attachments cannot be added in the app yet, so only a very large logbook would hit it; the
  backup would then fail with an error banner. Switching to the resumable upload removes the cap.
  `src/drive/driveApi.ts` (`createJson`).

## Regulatory limits

What the logbook cannot know or does not track is listed per rule in the `todo` of each entry in
`src/domain/rules.ts`, and shown on the matching card under "How this is calculated". That file is the source
of truth; the main ones:

- Every logged take-off and landing counts towards recent experience; the rule wants them as pilot flying, which is how the AMC logbook records landings, so log only the ones you flew.
- Simulator (FFS) take-offs and landings never count, although FCL.060 allows them. Approaches are not recorded.
- DUAL time stands in for the SEP/TMG refresher flight with an FI or CRI.
- SEP/TMG revalidation counts the selected class only; combined SEP/TMG or land/sea holdings are not modelled.
- Route sectors (FCL.010: take-off to landing with at least 15 minutes of cruise) count only when you mark
  them on the flight form: the logbook does not record the cruise. The one-sector-with-an-examiner
  alternative is not tracked, and for type ratings the 12-month window assumes the default 1-year validity
  rather than one set by the OSD.
- Not modelled: recent experience credited between similar types through the OSD (FCL.060(b)(4)), and the
  120-day extension in commercial air transport (FCL.060(c)).
- The app never works out a validity period itself (medical, type rating, language endorsement): you enter the
  date from your licence. Medical age-band edges are explained on the card but not checked.
- The figures are EASA's; a UK CAA licence follows different wording.

## Tooling

- **End-to-end tests cover the main flows, not every screen.** `e2e/` checks logging a flight, importing a backup,
  marking route sectors, removing a type rating, the IR waiver, and two layouts measured at phone and desktop
  width. How the other screens look is still checked by eye.
- **An `overrides` entry in `package.json` pins workbox-build's `glob` to 14.0.4.** workbox-build 7.4.1 asks for
  glob 11, which (with its minimatch 10) carries two moderate advisories; build-time only, never shipped. glob 14
  was checked to give the service worker the same 16 precached files. Remove the override once workbox-build
  depends on a fixed glob itself (`npm ls glob` shows it), and compare the precache list again.
