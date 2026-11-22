/**
 * CSV writer (RFC 4180: CRLF line ends, fields quoted when needed, quotes doubled) plus the
 * protection against spreadsheet formula injection.
 *
 * A text cell that starts with = + - @ tab or CR would be run as a formula by Excel/Sheets, so it is
 * written with a leading apostrophe. A text cell that already starts with an apostrophe also gets one,
 * which keeps the escaping reversible: on import ONE leading apostrophe is removed when the next
 * character is one of those. Text therefore round-trips exactly.
 */

const DANGEROUS = new Set(['=', '+', '-', '@', '\t', '\r', "'"]);

export function escapeTextCell(s: string): string {
  return s !== '' && DANGEROUS.has(s[0]!) ? `'${s}` : s;
}

export function unescapeTextCell(s: string): string {
  return s.length >= 2 && s[0] === "'" && DANGEROUS.has(s[1]!) ? s.slice(1) : s;
}

function quote(field: string): string {
  return /[",\r\n]/.test(field) || field !== field.trim() ? `"${field.replace(/"/g, '""')}"` : field;
}

/** Rows to CSV text with a UTF-8 byte-order mark (so Excel opens accents correctly). */
export function toCsv(rows: string[][], opts: { bom?: boolean } = {}): string {
  return (opts.bom === false ? '' : '﻿') + rows.map((r) => r.map(quote).join(',')).join('\r\n') + '\r\n';
}
