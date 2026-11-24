/**
 * Credits for the third-party photos in the README screenshots. Pure functions, used by
 * make-screenshots.mjs and checked by photo-credits.test.mjs.
 *
 * Attribution is a licence condition, not a courtesy: the screenshots show aircraft photos from Wikimedia
 * Commons, and each one has to be credited (title, author, licence, source) wherever the image is shared.
 * So the credits are produced by the same run that takes the screenshots, from what was actually on screen,
 * and the run refuses to finish when a photo cannot be credited. Nothing here is written by hand.
 */

import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const START = '<!-- photo-credits:start -->';
export const END = '<!-- photo-credits:end -->';

/**
 * Licences whose photos may be combined in one screenshot shared under CC BY-SA 4.0. Each earlier version's
 * §4(b) lets an adaptation be distributed under "a later version of this License with the same License
 * Elements". Anything else stops the run: whether another licence can be mixed in is a question for a
 * person, not for this script.
 */
const SHARE_ALIKE = new Map([
  ['CC BY-SA 2.0', 'https://creativecommons.org/licenses/by-sa/2.0'],
  ['CC BY-SA 2.5', 'https://creativecommons.org/licenses/by-sa/2.5'],
  ['CC BY-SA 3.0', 'https://creativecommons.org/licenses/by-sa/3.0'],
  ['CC BY-SA 4.0', 'https://creativecommons.org/licenses/by-sa/4.0'],
]);
const TARGET = 'CC BY-SA 4.0';

const norm = (s) => String(s ?? '').trim().replace(/\s+/g, ' ');
/** "Keiheuvel Cessna 172S Skyhawk OO-CEU 02.JPG" -> "Keiheuvel Cessna 172S Skyhawk OO-CEU 02" */
const titleOf = (t) => norm(t).replace(/^File:/i, '').replace(/\.(jpe?g|png|gif|tiff?|webp)$/i, '');

export class CreditError extends Error {}

/**
 * Which photo appears in which screenshot, with its credit.
 * @param {{ file: string, imageUrls: string[] }[]} shots  the images visible in each screenshot, in order
 * @param {object[]} cache  the app's photo cache entries (status 'found'), from every browser context used
 * @returns {{ registration: string, title: string, artist: string, license: string, licenseUrl: string,
 *   pageUrl: string, imageUrl: string, files: string[] }[]}  one entry per photo, by registration
 */
export function buildCredits(shots, cache) {
  const byUrl = new Map(cache.filter((c) => c.status === 'found' && c.imageUrl).map((c) => [c.imageUrl, c]));
  const photos = new Map();
  for (const { file, imageUrls } of shots) {
    for (const url of imageUrls) {
      const c = byUrl.get(url);
      if (!c) throw new CreditError(`${file}: shows a photo the app's cache has no credit for (${url})`);
      if (c.source !== 'commons') throw new CreditError(`${file}: the photo of ${c.registration} is not from Wikimedia Commons; it cannot be credited and must not be committed`);
      for (const k of ['title', 'artist', 'license', 'pageUrl']) {
        if (!norm(c[k])) throw new CreditError(`${file}: the photo of ${c.registration} has no ${k}, so it cannot be credited`);
      }
      const license = norm(c.license);
      if (!SHARE_ALIKE.has(license)) throw new CreditError(`${file}: the photo of ${c.registration} is under "${license}", which this script does not know to combine under ${TARGET}; decide by hand`);
      const p = photos.get(url) ?? {
        registration: norm(c.registration), title: titleOf(c.title), artist: norm(c.artist), license,
        licenseUrl: SHARE_ALIKE.get(license), pageUrl: norm(c.pageUrl), imageUrl: url, files: [],
      };
      if (!p.files.includes(file)) p.files.push(file);
      photos.set(url, p);
    }
  }
  return [...photos.values()].sort((a, b) => a.registration.localeCompare(b.registration) || a.title.localeCompare(b.title));
}

const NUMBER = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
const list = (xs) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);
const code = (f) => `\`docs/screenshots/${f}\``;

/** The README's credits section, between the START and END markers. */
export function renderCredits(credits) {
  const out = [START, `<!-- Written by scripts/make-screenshots.mjs from docs/screenshots/photo-credits.json. Do not edit by hand: re-run the screenshots. -->`];
  if (credits.length === 0) {
    out.push('No third-party photos appear in the screenshots.', END);
    return out.join('\n');
  }
  const files = [...new Set(credits.flatMap((c) => c.files))];
  const perFile = files.map((f) => `${list(credits.filter((c) => c.files.includes(f)).map((c) => c.registration))} in ${code(f)}`);
  const n = NUMBER[credits.length] ?? String(credits.length);
  out.push(
    `${n} third-party photo${credits.length === 1 ? '' : 's'} appear${credits.length === 1 ? 's' : ''} in the screenshots: ${list(perFile)}. The app looked each one up on Wikimedia Commons by registration and shows the author and licence itself on the flight screen. In the screenshots they are cropped and scaled to fit the app's cards, and shown inside the app's screen.`,
    '',
    '| Photo | Author | Licence | Source | Appears in |',
    '|---|---|---|---|---|',
    ...credits.map((c) => `| "${c.title}" | ${c.artist} | [${c.license}](${c.licenseUrl}) | [Wikimedia Commons](${c.pageUrl}) | ${c.files.map((f) => `\`${f}\``).join(', ')} |`),
    '',
    `Because ${files.length === 1 ? 'that screenshot contains' : 'those screenshots contain'} the photos in changed form, **${list(files.map(code))} ${files.length === 1 ? 'is' : 'are'} shared under [${TARGET}](${SHARE_ALIKE.get(TARGET)})**. This applies to ${files.length === 1 ? 'that image file' : 'those image files'} only, not to the FlightBook code or to the other screenshots, none of which contain a third-party photo.`,
  );
  const earlier = [...new Set(credits.map((c) => c.license))].filter((l) => l !== TARGET).sort();
  if (earlier.length > 0) {
    out.push('', `${list(earlier.map((l) => `${l} ([§4(b)](${SHARE_ALIKE.get(l)}/legalcode))`))} let${earlier.length === 1 ? 's' : ''} an adaptation be distributed under "a later version of this License with the same License Elements", and ${TARGET} is exactly that (Attribution, ShareAlike), so it is the one licence that covers the mixture.`);
  }
  out.push(END);
  return out.join('\n');
}

/** The README with its credits section replaced. Refuses a README without the markers rather than guessing where they go. */
export function replaceCredits(readme, block) {
  const nl = readme.includes('\r\n') ? '\r\n' : '\n';
  const i = readme.indexOf(START), j = readme.indexOf(END);
  if (i < 0 || j < i) throw new CreditError(`README.md has no ${START} … ${END} section for the photo credits`);
  return readme.slice(0, i) + block.replace(/\n/g, nl) + readme.slice(j + END.length);
}

/**
 * The last step of a screenshot run: credit every photo, and only then publish. The screenshots are taken
 * into `stage`; they are copied to `out`, with photo-credits.json and the README's credits section, only if
 * every photo in them can be credited. Otherwise this throws CreditError and nothing in `out` or the README
 * is touched, so an uncredited photo can never be committed.
 * @returns the credits written
 */
export function publish({ shots, cache, stage, out, readmePath }) {
  const credits = buildCredits(shots, cache);
  const readme = replaceCredits(readFileSync(readmePath, 'utf8'), renderCredits(credits)); // fails before any copy if the markers are gone
  for (const { file } of shots) copyFileSync(join(stage, file), join(out, file));
  writeFileSync(join(out, 'photo-credits.json'), `${JSON.stringify({ generatedBy: 'scripts/make-screenshots.mjs', photos: credits }, null, 2)}\n`);
  writeFileSync(readmePath, readme);
  return credits;
}

/** The credits section currently in the README, line endings normalised, or null. */
export function creditsIn(readme) {
  const s = readme.replace(/\r\n/g, '\n');
  const i = s.indexOf(START), j = s.indexOf(END);
  return i < 0 || j < i ? null : s.slice(i, j + END.length);
}
