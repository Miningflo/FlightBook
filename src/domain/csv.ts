/**
 * RFC 4180 CSV reader: quoted fields, doubled quotes, commas and newlines inside quotes,
 * CRLF or LF line endings, optional UTF-8 BOM. Lazy, so a 12 MB file can be consumed in chunks.
 * (Also reused by the CSV import in phase 4.)
 */
export function* csvRows(text: string): Generator<string[]> {
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let started = false; // distinguishes a trailing newline from a final empty field
  while (i < n) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === '') { quoted = true; started = true; i++; continue; }
    if (c === ',') { row.push(field); field = ''; started = true; i++; continue; }
    if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (started || field !== '' || row.length > 0) { row.push(field); yield row; }
      row = []; field = ''; started = false;
      continue;
    }
    field += c; started = true; i++;
  }
  if (quoted) throw new Error('CSV ended inside a quoted field');
  if (started || field !== '' || row.length > 0) { row.push(field); yield row; }
}

export function parseCsv(text: string): string[][] {
  return [...csvRows(text)];
}
