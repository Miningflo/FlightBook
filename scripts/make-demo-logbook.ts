/**
 * Writes a demo logbook as a FlightBook JSON backup, for the README screenshots.
 *
 *   npx vite-node scripts/make-demo-logbook.ts -- /tmp/demo.json
 *
 * The logbook is invented: the pilot, the flights, the times, the remarks and the people never existed.
 * Only the airports and the four registrations are real (chosen because Wikimedia Commons has a photo of
 * each). Everything is derived from a fixed seed, so re-running this produces byte-identical output and the
 * screenshots stay reproducible.
 *
 * Dates are relative to DEMO_TODAY, not to the real clock, so the currency and rating cards always show the
 * same mix of green, amber, red and expired.
 */
import { writeFileSync } from 'node:fs';
import { buildSnapshot, serializeSnapshot, type Snapshot } from '../src/domain/snapshot';
import type { Aircraft, ClassRating, EngineClass, Flight, FstdSession, Person, PreviousExperience } from '../src/domain/types';
import { emptyExperience } from '../src/domain/experience';

/** The "today" the screenshots are taken at. */
export const DEMO_TODAY = '2026-11-23';

const day = 86_400_000;
const at = (iso: string, hhmm: string) => Date.parse(`${iso}T${hhmm}:00Z`);
const minus = (days: number) => new Date(Date.parse(`${DEMO_TODAY}T00:00:00Z`) - days * day).toISOString().slice(0, 10);

// a tiny deterministic PRNG, so "random-looking" stays identical between runs
let seed = 20261123;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;

const ts = Date.parse(`${DEMO_TODAY}T09:00:00Z`);
const base = (id: string) => ({ id, createdAt: ts, updatedAt: ts });

const persons: Person[] = [
  { ...base('p-self'), name: 'SELF', nameKey: 'self', isSelf: true },
  { ...base('p-dm'), name: 'Dirk Maertens', nameKey: 'dirk maertens', isSelf: false },
  { ...base('p-lv'), name: 'Lieve Vandenberghe', nameKey: 'lieve vandenberghe', isSelf: false },
];

const fleet: { reg: string; make: string; model: string; variant: string; cls: ClassRating; eng: EngineClass }[] = [
  { reg: 'OO-CEU', make: 'Cessna', model: '172S', variant: 'Skyhawk SP', cls: 'SEP_LAND', eng: 'SP-SE' },
  { reg: 'OO-ILS', make: 'Piper', model: 'PA-28-181', variant: 'Archer III', cls: 'SEP_LAND', eng: 'SP-SE' },
  { reg: 'OO-ROB', make: 'Robin', model: 'DR400', variant: '180 Régent', cls: 'SEP_LAND', eng: 'SP-SE' },
  { reg: 'OO-SEN', make: 'Piper', model: 'PA-34-200T', variant: 'Seneca II', cls: 'MEP_LAND', eng: 'SP-ME' },
];
const aircraft: Aircraft[] = fleet.map((a, i) => ({
  ...base(`ac-${i}`), registration: a.reg, make: a.make, model: a.model, variant: a.variant, engineClass: a.eng, classRating: a.cls,
}));

const AIRFIELDS = ['EBKT', 'EBOS', 'EBAW', 'EBGB', 'EHRD', 'EHSE', 'LFQQ', 'EBZW'] as const;
const REMARKS = [
  '', '', '', 'Local circuits', 'Navigation exercise', 'Cross-country to Rotterdam', 'Dual check with instructor',
  'Night currency', 'Sightseeing along the coast', 'Fuel stop at Lille', '',
];

/** 52 flights over the last ~26 months, the most recent 9 days ago. */
function makeFlights(): Flight[] {
  const out: Flight[] = [];
  let d = 790; // days before DEMO_TODAY for the oldest flight
  for (let i = 0; i < 52; i++) {
    const a = i % 11 === 10 ? fleet[3]! : pick(fleet.slice(0, 3));
    const acIndex = fleet.indexOf(a);
    const date = minus(d);
    const depH = 7 + Math.floor(rnd() * 11);
    const mins = 35 + Math.floor(rnd() * 100);
    const dep = at(date, `${String(depH).padStart(2, '0')}:${rnd() < 0.5 ? '00' : '30'}`);
    const from = pick(AIRFIELDS);
    const to = rnd() < 0.3 ? from : pick(AIRFIELDS);
    // a few night flights, and the most recent night landing is deliberately old (night currency lapsed)
    const night = d > 150 && i % 9 === 4;
    const dual = i % 8 === 3;
    const isMe = a.eng === 'SP-ME';
    out.push({
      ...base(`f-${i}`), createdAt: ts - (52 - i) * 1000, date,
      depPlace: from, depTimeUtc: dep, arrPlace: to, arrTimeUtc: dep + mins * 60_000,
      aircraftId: `ac-${acIndex}`, registration: a.reg, aircraftMake: a.make, aircraftModel: a.model,
      aircraftVariant: a.variant, aircraftClass: a.cls,
      spSeMin: isMe ? 0 : mins, spMeMin: isMe ? mins : 0, mpMin: 0, totalMin: mins,
      picNameId: dual ? 'p-dm' : 'p-self',
      takeoffsDay: night ? 0 : 1, takeoffsNight: night ? 1 : 0,
      landingsDay: night ? 0 : 1 + (rnd() < 0.2 ? 2 : 0), landingsNight: night ? 2 : 0,
      nightMin: night ? Math.round(mins * 0.7) : 0, ifrMin: i % 13 === 0 ? 20 : 0,
      picMin: dual ? 0 : mins, copiMin: 0, dualMin: dual ? mins : 0, instMin: 0,
      isPicus: false, isSpic: dual && i % 16 === 3,
      remarks: pick(REMARKS), attachmentIds: [], overrides: {},
    });
    d -= Math.max(3, Math.round(790 / 52 - 4 + rnd() * 16));
    if (d < 9) d = 9;
  }
  return out.sort((x, y) => x.depTimeUtc - y.depTimeUtc);
}

const fstdSessions: FstdSession[] = [
  { ...base('s-1'), date: minus(420), fstdType: 'FNPT II', totalMin: 90, remarks: 'IFR procedures' },
  { ...base('s-2'), date: minus(240), fstdType: 'FNPT II', totalMin: 60, remarks: '' },
  { ...base('s-3'), date: minus(45), fstdType: 'BITD', totalMin: 75, remarks: 'Emergency drills' },
];

const previousExperience: PreviousExperience[] = [{
  ...base('e-1'), ...emptyExperience(minus(800)),
  source: 'Paper logbook vol. 1', note: 'Training and early hours, 2019–2024',
  periodFrom: '2019-04-01', periodTo: minus(800),
  totalMin: 181 * 60 + 25, spSeMin: 181 * 60 + 25,
  picMin: 96 * 60, dualMin: 85 * 60 + 25,
  nightMin: 6 * 60 + 10, ifrMin: 11 * 60 + 40,
  takeoffsDay: 412, takeoffsNight: 14, landingsDay: 412, landingsNight: 14,
  fstdMin: 14 * 60,
}];

const snapshot: Snapshot = buildSnapshot({
  exportedAt: `${DEMO_TODAY}T09:00:00.000Z`,
  deviceId: 'demo-device', deviceName: 'Demo phone',
  settings: {
    pilotName: 'Jonas Verhaeghe',
    licenceNumber: 'BE.FCL.PPL.014782',
    address: 'Leopoldlaan 24\n8500 Kortrijk, Belgium',
    // SEP (land) valid but revalidation not yet met; MEP expiring inside the check window; SET long expired
    sepLandExpiry: minus(-95),
    classExpiry: { MEP_LAND: minus(-48), SET_LAND: minus(190) },
  },
  aircraft, persons, flights: makeFlights(), fstdSessions, previousExperience, attachments: [],
});

const out = process.argv[2] ?? 'demo-logbook.json';
writeFileSync(out, serializeSnapshot(snapshot));
console.log(`${out}: ${snapshot.flights.length} flights, ${snapshot.fstdSessions.length} sessions, today = ${DEMO_TODAY}`);
