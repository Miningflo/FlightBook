import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { renderLogbookPdf } from './pdfRender';
import { buildDocument, PAGE, rowsPerPage } from '../../domain/pdfLayout';
import { flight } from '../../domain/testFactories';
import { emptyExperience } from '../../domain/experience';
import type { Person } from '../../domain/types';

const self: Person = { id: 'p', name: 'SELF', nameKey: 'self', isSelf: true, createdAt: 1, updatedAt: 1 };
const model = (n: number, o = {}) => buildDocument({
  flights: Array.from({ length: n }, (_, i) => flight(`2025-03-${String((i % 27) + 1).padStart(2, '0')}`, { depTimeUtc: Date.parse('2025-03-01T08:00:00Z') + i * 3_600_000, ...o })),
  persons: [self], fstd: [], experience: [], pilotName: 'A. Pilot', generatedOn: '2025-06-30',
});

describe('renderLogbookPdf', () => {
  it('produces a valid PDF with one A4 landscape page per layout page', async () => {
    const m = model(rowsPerPage() * 2 + 3);
    const { bytes, report } = await renderLogbookPdf(m);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
    expect(report.pages).toBe(3);
    for (const p of doc.getPages()) {
      expect(p.getWidth()).toBeCloseTo(PAGE.width, 1);
      expect(p.getHeight()).toBeCloseTo(PAGE.height, 1);
    }
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
  });
  it('renders an empty logbook as one blank page', async () => {
    const { bytes } = await renderLogbookPdf(model(0));
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
  });
  it('keeps a flight and a simulator session on one page, as AMC1 FCL.050 does', async () => {
    const m = buildDocument({ flights: [flight('2025-03-01')], persons: [self], fstd: [{ id: 's', createdAt: 1, updatedAt: 1, date: '2025-03-02', fstdType: 'FNPT II', totalMin: 60, remarks: '' }], experience: [{ id: 'e', createdAt: 1, updatedAt: 1, ...emptyExperience('2024-12-31') }], pilotName: '', generatedOn: '2025-06-30' });
    expect(m.pages).toHaveLength(1);
    expect((await PDFDocument.load((await renderLogbookPdf(m)).bytes)).getPageCount()).toBe(1);
  });
  it('never cuts a long PIC name: NAME(S) OF PIC is a required AMC column', async () => {
    const long = { id: 'v', name: 'Jean-Baptiste Vandenbroucke', nameKey: 'v', isSelf: false, createdAt: 1, updatedAt: 1 };
    const m = buildDocument({
      flights: [flight('2025-03-01', { picNameId: 'v', remarks: '' })], persons: [self, long], fstd: [], experience: [],
      pilotName: 'SELF', generatedOn: '2025-06-30',
    });
    expect(m.pages[0]!.rows[0]!.picName).toBe('Jean-Baptiste Vandenbroucke');
    expect((await renderLogbookPdf(m)).report.truncatedCells).toBe(0);
  });
  it('draws the holder block without truncating a normal name, licence number and address', async () => {
    const m = buildDocument({
      flights: [flight('2025-03-01')], persons: [self], fstd: [], experience: [],
      pilotName: 'Alex Example Pilot', licenceNumber: 'BE.FCL.PPL.123456', address: 'Grote Markt 1\n9000 Gent, Belgium',
      generatedOn: '2025-06-30',
    });
    const { report } = await renderLogbookPdf(m);
    expect(report.truncatedCells).toBe(0);
  });
  it('reports characters the PDF font cannot show instead of failing or hiding it', async () => {
    const m = buildDocument({ flights: [flight('2025-03-01', { remarks: 'Łódź Café 日本' })], persons: [self], fstd: [], experience: [], pilotName: 'Zoë', generatedOn: '2025-06-30' });
    const { report } = await renderLogbookPdf(m);
    expect(report.replacedCharacters).toBeGreaterThan(0); // Ł, 日, 本 (é and ë are in the font)
  });
  it('writes common non-decomposing letters out in plain Latin and counts them', async () => {
    const m = buildDocument({ flights: [flight('2025-03-01', { remarks: 'Łódź' })], persons: [self], fstd: [], experience: [], pilotName: '', generatedOn: '2025-06-30' });
    const { report } = await renderLogbookPdf(m);
    expect(report.replacedCharacters).toBe(2); // Ł and ź; the PDF shows "Lodz"
  });
  it('does not alter Latin-1 text (accents are fine)', async () => {
    const m = buildDocument({ flights: [flight('2025-03-01', { remarks: 'Café déjà vu, Müller' })], persons: [self], fstd: [], experience: [], pilotName: 'Zoë Brontë', generatedOn: '2025-06-30' });
    expect((await renderLogbookPdf(m)).report.replacedCharacters).toBe(0);
  });
  it('reports remarks that had to be cut to fit, and handles an unbroken very long word', async () => {
    const m = buildDocument({ flights: [flight('2025-03-01', { remarks: 'x'.repeat(400) }), flight('2025-03-02', { remarks: 'short' })], persons: [self], fstd: [], experience: [], pilotName: '', generatedOn: '2025-06-30' });
    expect((await renderLogbookPdf(m)).report.truncatedCells).toBe(1);
  });
  it('is deterministic for the same input (same bytes)', async () => {
    const a = (await renderLogbookPdf(model(5))).bytes;
    const b = (await renderLogbookPdf(model(5))).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});
