import { describe, expect, it } from 'vitest';
import { escapeTextCell, toCsv, unescapeTextCell } from './csvWrite';
import { parseCsv } from './csv';

describe('toCsv', () => {
  it('writes CRLF rows with a BOM, quoting only where needed', () => {
    expect(toCsv([['a', 'b,c', 'd"e', 'line\nbreak', ' pad ', '']])).toBe('﻿a,"b,c","d""e","line\nbreak"," pad ",\r\n');
    expect(toCsv([['x']], { bom: false })).toBe('x\r\n');
  });
  it('is read back exactly by the CSV reader', () => {
    const rows = [['id', 'text'], ['1', 'a,b'], ['2', 'say "hi"'], ['3', 'two\nlines'], ['4', ' spaced '], ['5', ''], ['6', "'quoted"], ['7', 'ünï😀']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('formula-injection protection', () => {
  it('prefixes cells a spreadsheet would execute', () => {
    for (const s of ['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx']) expect(escapeTextCell(s)).toBe(`'${s}`);
    expect(escapeTextCell('plain')).toBe('plain');
    expect(escapeTextCell('')).toBe('');
    expect(escapeTextCell('a=b')).toBe('a=b');
  });
  it('is exactly reversible, including text that already starts with an apostrophe', () => {
    for (const s of ['=1+1', "'=x", "'abc", "''", "'", '-', '@', 'plain', '', "a'b", "'-1"]) expect(unescapeTextCell(escapeTextCell(s))).toBe(s);
  });
  it('text from a file that was not written by this app comes back unchanged (no apostrophe is invented or removed)', () => {
    for (const s of ['-leading dash', '=1+1', '+31 6', '@home', 'plain']) expect(unescapeTextCell(s)).toBe(s);
  });
  it('leaves a hand-written apostrophe alone when it does not protect anything', () => {
    expect(unescapeTextCell("'hello")).toBe("'hello");
    expect(unescapeTextCell("don't")).toBe("don't");
  });
});
