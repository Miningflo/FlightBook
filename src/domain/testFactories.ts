// Test-only factories (not imported by the app).
import type { ClassRating, Flight } from './types';

export function flight(date: string, o: Partial<Flight> = {}): Flight {
  const dep = Date.parse(`${date}T10:00:00Z`);
  return {
    id: `f-${date}-${Math.random().toString(36).slice(2, 8)}`, createdAt: 1, updatedAt: 1,
    date, depPlace: 'EBOS', depTimeUtc: dep, arrPlace: 'EBAW', arrTimeUtc: dep + 60 * 60_000,
    aircraftId: 'a', registration: 'OO-ABC', aircraftMake: 'Cessna', aircraftModel: '172', aircraftVariant: '',
    aircraftClass: 'SEP_LAND' as ClassRating,
    spSeMin: 60, spMeMin: 0, mpMin: 0, totalMin: 60, picNameId: 'p',
    takeoffsDay: 0, takeoffsNight: 0, landingsDay: 0, landingsNight: 0,
    nightMin: 0, ifrMin: 0, picMin: 60, copiMin: 0, dualMin: 0, instMin: 0,
    isPicus: false, isSpic: false, remarks: '', attachmentIds: [], overrides: {},
    ...o,
  };
}
