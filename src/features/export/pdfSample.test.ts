// Optional visual check: PDF_OUT=/path/to/out.pdf npx vitest run src/features/export/pdfSample.test.ts
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderLogbookPdf } from './pdfRender';
import { buildDocument } from '../../domain/pdfLayout';
import { flight } from '../../domain/testFactories';
import { emptyExperience } from '../../domain/experience';
import type { FstdSession, Person } from '../../domain/types';

describe('sample PDF', () => {
  it('writes a realistic sample when PDF_OUT is set', async () => {
    const out = process.env.PDF_OUT;
    if (!out) return;
    const persons: Person[] = [
      { id: 'self', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 },
      { id: 'j', name: 'Jean-Baptiste Vandenbroucke', nameKey: 'j', isSelf: false, createdAt: 1, updatedAt: 1 },
    ];
    const regs = ['OO-ABC', 'OO-SKY', 'PH-LDF'];
    const flights = Array.from({ length: 30 }, (_, i) => {
      const dep = Date.parse('2025-03-01T08:00:00Z') + i * 2 * 86_400_000 + (i % 5) * 3_600_000;
      const mins = 45 + (i * 7) % 90;
      const day = new Date(dep).toISOString().slice(0, 10);
      return flight(day, {
        depTimeUtc: dep, arrTimeUtc: dep + mins * 60_000, totalMin: mins, spSeMin: mins, registration: regs[i % 3]!,
        aircraftMake: i % 3 === 2 ? 'Piper' : 'Cessna', aircraftModel: i % 3 === 2 ? 'PA-28' : '172S', aircraftVariant: i % 3 === 2 ? 'Archer III' : 'Skyhawk SP',
        depPlace: i % 4 ? 'EBOS' : 'EBAW', arrPlace: i % 3 ? 'EBKT' : 'EHRD',
        picNameId: i % 6 === 5 ? 'j' : 'self', picMin: i % 6 === 5 ? 0 : mins, dualMin: i % 6 === 5 ? mins : 0,
        nightMin: i % 7 === 0 ? 20 : 0, ifrMin: i % 11 === 0 ? 15 : 0, landingsDay: 1 + (i % 3), landingsNight: i % 7 === 0 ? 1 : 0,
        isPicus: i === 3, remarks: i === 4 ? 'Navigation exercise to Rotterdam with a diversion because of weather, then a long taxi back and a very long note that will not fit' : i === 9 ? 'Check flight Łódź café' : '',
      });
    });
    const fstd: FstdSession[] = [0, 1, 2].map((i) => ({ id: `s${i}`, createdAt: 1, updatedAt: 1, date: `2025-0${i + 2}-10`, fstdType: 'FNPT II', totalMin: 60 + i * 15, remarks: i === 1 ? 'IFR procedures' : '' }));
    const experience = [{ id: 'e', createdAt: 1, updatedAt: 1, ...emptyExperience('2024-12-31'), totalMin: 6000 * 60 + 25, spSeMin: 6000 * 60 + 25, picMin: 4000 * 60, dualMin: 2000 * 60 + 25, nightMin: 300 * 60, ifrMin: 100 * 60, landingsDay: 2100, landingsNight: 110, fstdMin: 600 }];
    const { bytes, report } = await renderLogbookPdf(buildDocument({ flights, persons, fstd, experience, pilotName: 'Test Pilot', generatedOn: '2025-06-30' }));
    writeFileSync(out, bytes);
    console.log('report', report);
    expect(bytes.length).toBeGreaterThan(1000);
  });
});
