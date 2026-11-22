import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib';
import {
  type DocumentModel, type Page, type PlacedColumn, PAGE, dmy, formatCell, placeColumns, rowsPerPage, sumColumnIds, tableFor,
} from '../../domain/pdfLayout';

/**
 * Draws a DocumentModel (see domain/pdfLayout.ts) with pdf-lib. All decisions about columns,
 * pages and totals are made by the layout spec; this file only turns them into marks on paper.
 *
 * Fonts: the built-in PDF fonts cover Latin-1 text only. Characters outside that set are
 * replaced (accents are stripped where possible, otherwise '?') and COUNTED in the report so
 * the user is told. Text that does not fit its cell is shrunk, wrapped onto a second line, and
 * finally cut with an ellipsis; those cuts are counted too. The CSV/JSON exports always hold the full text.
 */

export interface PdfReport {
  pages: number;
  replacedCharacters: number;
  truncatedCells: number;
}

const INK = rgb(0.1, 0.1, 0.1);
const LINE = rgb(0.35, 0.35, 0.35);
const HEAD_FILL = rgb(0.9, 0.93, 0.96);
const TOTAL_FILL = rgb(0.95, 0.95, 0.95);
const LINE_W = 0.5;

/** Common letters that have no accent decomposition, written out in plain Latin. */
const TRANSLITERATE: Record<string, string> = {
  'Ł': 'L', 'ł': 'l', 'Ø': 'O', 'ø': 'o', 'Đ': 'D', 'đ': 'd', 'ß': 'ss', 'Æ': 'AE', 'æ': 'ae', 'Œ': 'OE', 'œ': 'oe',
  'Þ': 'Th', 'þ': 'th', 'Ð': 'D', 'ð': 'd', 'ı': 'i', 'İ': 'I', 'Ħ': 'H', 'ħ': 'h', 'Ŋ': 'N', 'ŋ': 'n',
};

class Fonts {
  replaced = 0;
  truncated = 0;
  private readonly supported: Set<number>;
  constructor(readonly regular: PDFFont, readonly bold: PDFFont) {
    this.supported = new Set(regular.getCharacterSet());
  }

  /** Make a string encodable in the PDF font, counting every substitution. */
  clean(text: string): string {
    let out = '';
    for (const ch of text.replace(/[\r\n\t]+/g, ' ')) {
      const cp = ch.codePointAt(0)!;
      if (this.supported.has(cp)) { out += ch; continue; }
      this.replaced++;
      const base = TRANSLITERATE[ch] ?? ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      out += base !== '' && [...base].every((c) => this.supported.has(c.codePointAt(0)!)) ? base : '?';
    }
    return out;
  }
}

/** Break text into at most `maxLines` lines of `width`; the last line ends with an ellipsis if text was cut. */
function wrap(text: string, font: PDFFont, size: number, width: number, maxLines: number): { lines: string[]; cut: boolean } {
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width;
  const lines: string[] = [];
  let line = '';
  const words = text.split(' ').filter((w) => w !== '');
  for (let i = 0; i < words.length; i++) {
    let w = words[i]!;
    // a single word wider than the cell is split by characters
    while (!fits(w) && w.length > 1) {
      let n = w.length - 1;
      while (n > 1 && !fits(w.slice(0, n))) n--;
      if (line) { lines.push(line); line = ''; }
      lines.push(w.slice(0, n));
      w = w.slice(n);
    }
    const next = line ? `${line} ${w}` : w;
    if (fits(next)) line = next;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return { lines, cut: false };
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!;
  while (last.length > 0 && !fits(`${last}…`.replace('…', '...'))) last = last.slice(0, -1);
  kept[maxLines - 1] = `${last}...`;
  return { lines: kept, cut: true };
}

function drawCell(page: PDFPage, f: Fonts, c: PlacedColumn, text: string, y: number, h: number, opts: { bold?: boolean } = {}): void {
  if (text === '') return;
  const font = opts.bold ? f.bold : f.regular;
  const pad = 2;
  const avail = c.w - 2 * pad;
  const clean = f.clean(text);
  let size = c.kind === 'text' ? 7 : 7.5;
  const multiline = c.kind === 'text' && c.w > 40;

  if (!multiline) {
    // numbers, times and short codes: shrink to fit; as a last resort cut with an ellipsis
    while (size > 5 && font.widthOfTextAtSize(clean, size) > avail) size -= 0.25;
    let t = clean;
    if (font.widthOfTextAtSize(t, size) > avail) {
      f.truncated++;
      while (t.length > 1 && font.widthOfTextAtSize(`${t}...`, size) > avail) t = t.slice(0, -1);
      t += '...';
    }
    const w = font.widthOfTextAtSize(t, size);
    const x = c.align === 'right' ? c.x + c.w - pad - w : c.align === 'center' ? c.x + (c.w - w) / 2 : c.x + pad;
    page.drawText(t, { x, y: y + (h - size) / 2 + 1, size, font, color: INK });
    return;
  }
  size = 6.5;
  const { lines, cut } = wrap(clean, font, size, avail, 2);
  if (cut) f.truncated++;
  const lh = size + 1;
  const top = y + h / 2 + ((lines.length - 1) * lh) / 2 - size / 2 + 1;
  lines.forEach((ln, i) => page.drawText(ln, { x: c.x + pad, y: top - i * lh, size, font, color: INK }));
}

function drawHeader(page: PDFPage, f: Fonts, p: Page, cols: PlacedColumn[], top: number): void {
  const table = tableFor(p.table);
  const gh = PAGE.groupH, ch = PAGE.colHeadH;
  let idx = 0;
  const label = (lines: string[], x: number, w: number, yTop: number, h: number) => {
    // one size for the whole label: 6 pt, shrunk (down to 4.5 pt) until the widest line fits the cell
    const cleaned = lines.map((ln) => f.clean(ln));
    let size = 6;
    while (size > 4.5 && Math.max(...cleaned.map((t) => f.bold.widthOfTextAtSize(t, size))) > w - 3) size -= 0.25;
    const lh = size + 1.2;
    const start = yTop - h / 2 + ((lines.length - 1) * lh) / 2 - size / 2 + 1;
    cleaned.forEach((t, i) => {
      const tw = f.bold.widthOfTextAtSize(t, size);
      page.drawText(t, { x: x + (w - tw) / 2, y: start - i * lh, size, font: f.bold, color: INK });
    });
  };
  for (const g of table.groups) {
    const gcols = cols.slice(idx, idx + g.columns.length);
    idx += g.columns.length;
    const x = gcols[0]!.x;
    const w = gcols.reduce((a, c) => a + c.w, 0);
    page.drawRectangle({ x, y: top - gh - ch, width: w, height: gh + ch, color: HEAD_FILL, borderColor: LINE, borderWidth: LINE_W });
    if (gcols.length === 1) {
      label(g.label, x, w, top, gh + ch);
    } else {
      label(g.label, x, w, top, gh);
      page.drawLine({ start: { x, y: top - gh }, end: { x: x + w, y: top - gh }, thickness: LINE_W, color: LINE });
      for (const c of gcols) {
        label(c.label, c.x, c.w, top - gh, ch);
        if (c !== gcols[0]) page.drawLine({ start: { x: c.x, y: top - gh }, end: { x: c.x, y: top - gh - ch }, thickness: LINE_W, color: LINE });
      }
    }
  }
}

function drawPage(doc: PDFDocument, f: Fonts, model: DocumentModel, p: Page): void {
  const page = doc.addPage([PAGE.width, PAGE.height]);
  const table = tableFor(p.table);
  const cols = placeColumns(table);
  const sums = sumColumnIds(table);
  const per = rowsPerPage();
  const left = PAGE.margin, right = PAGE.width - PAGE.margin;

  // title line
  const titleY = PAGE.height - PAGE.margin - 14;
  page.drawText(table.title, { x: left, y: titleY, size: 12, font: f.bold, color: INK });
  if (model.pilotName) {
    const t = f.clean(model.pilotName);
    const w = f.regular.widthOfTextAtSize(t, 9);
    page.drawText(t, { x: (PAGE.width - w) / 2, y: titleY + 1, size: 9, font: f.regular, color: INK });
  }
  const pg = `Page ${p.number} of ${p.of}`;
  page.drawText(pg, { x: right - f.regular.widthOfTextAtSize(pg, 8), y: titleY + 1, size: 8, font: f.regular, color: INK });

  const top = PAGE.height - PAGE.margin - PAGE.titleH;
  drawHeader(page, f, p, cols, top);

  // data rows (ruled lines are drawn for empty rows too, so a partly filled page still looks like a log)
  let y = top - PAGE.groupH - PAGE.colHeadH;
  for (let i = 0; i < per; i++) {
    const row = p.rows[i];
    y -= PAGE.rowH;
    for (const c of cols) {
      page.drawRectangle({ x: c.x, y, width: c.w, height: PAGE.rowH, borderColor: LINE, borderWidth: LINE_W });
      if (row) drawCell(page, f, c, formatCell(c.kind, row[c.id], { blankZero: true }), y, PAGE.rowH);
    }
  }

  // totals block
  const firstSum = cols.findIndex((c) => c.sum);
  const labelW = cols.slice(0, firstSum).reduce((a, c) => a + c.w, 0);
  const carry = p.includesCarryIn && sums.some((id) => (p.previous[id] ?? 0) > 0);
  const lines: [string, Page['thisPage']][] = [
    ['TOTAL THIS PAGE', p.thisPage],
    [carry ? 'BROUGHT FORWARD: PREVIOUS EXPERIENCE' : 'TOTAL FROM PREVIOUS PAGES', p.previous],
    ['TOTAL TIME (TO DATE)', p.toDate],
  ];
  for (const [text, totals] of lines) {
    y -= PAGE.totalRowH;
    page.drawRectangle({ x: left, y, width: right - left, height: PAGE.totalRowH, color: TOTAL_FILL, borderColor: LINE, borderWidth: LINE_W });
    const t = f.clean(text);
    const tw = f.bold.widthOfTextAtSize(t, 7);
    page.drawText(t, { x: left + labelW - tw - 4, y: y + (PAGE.totalRowH - 7) / 2 + 1, size: 7, font: f.bold, color: INK });
    for (const c of cols) {
      if (!c.sum) continue;
      page.drawRectangle({ x: c.x, y, width: c.w, height: PAGE.totalRowH, borderColor: LINE, borderWidth: LINE_W });
      drawCell(page, f, c, formatCell(c.kind, totals[c.id] ?? 0, { blankZero: false }), y, PAGE.totalRowH, { bold: true });
    }
  }

  // signature and date line, and generation note
  const sy = PAGE.margin + 8;
  page.drawText("Pilot's signature:", { x: left, y: sy, size: 8, font: f.regular, color: INK });
  page.drawLine({ start: { x: left + 72, y: sy - 2 }, end: { x: left + 300, y: sy - 2 }, thickness: LINE_W, color: INK });
  page.drawText('Date:', { x: left + 330, y: sy, size: 8, font: f.regular, color: INK });
  page.drawLine({ start: { x: left + 352, y: sy - 2 }, end: { x: left + 460, y: sy - 2 }, thickness: LINE_W, color: INK });
  const note = `Generated by FlightBook on ${dmy(model.generatedOn)}. Times UTC. Totals are computed from the records.`;
  page.drawText(note, { x: right - f.regular.widthOfTextAtSize(note, 6), y: sy - 1, size: 6, font: f.regular, color: rgb(0.4, 0.4, 0.4) });
}

export async function renderLogbookPdf(model: DocumentModel): Promise<{ bytes: Uint8Array; report: PdfReport }> {
  const doc = await PDFDocument.create();
  const when = new Date(`${model.generatedOn}T12:00:00Z`);
  doc.setTitle("Pilot's logbook");
  doc.setCreator('FlightBook');
  doc.setProducer('FlightBook (pdf-lib)');
  doc.setCreationDate(when);
  doc.setModificationDate(when);
  const fonts = new Fonts(await doc.embedFont(StandardFonts.Helvetica), await doc.embedFont(StandardFonts.HelveticaBold));
  for (const p of model.pages) drawPage(doc, fonts, model, p);
  const bytes = await doc.save();
  return { bytes, report: { pages: model.pages.length, replacedCharacters: fonts.replaced, truncatedCells: fonts.truncated } };
}
