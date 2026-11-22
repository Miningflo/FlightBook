import { describe, expect, it } from 'vitest';
import { parseCsv } from './csv';

describe('parseCsv', () => {
  it('parses plain rows, CRLF and a trailing newline', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('a,b\n1,2')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles quoted commas, doubled quotes and newlines inside quotes', () => {
    expect(parseCsv('"a,b","say ""hi""","line1\nline2"\n')).toEqual([['a,b', 'say "hi"', 'line1\nline2']]);
  });
  it('keeps empty fields, including at the end of a row', () => {
    expect(parseCsv('1,,3,\n,,\n')).toEqual([['1', '', '3', ''], ['', '', '']]);
  });
  it('strips a UTF-8 BOM and ignores blank lines', () => {
    expect(parseCsv('﻿a,b\n\n1,2\n')).toEqual([['a', 'b'], ['1', '2']]);
  });
  it('handles an empty quoted field', () => {
    expect(parseCsv('"",x\n')).toEqual([['', 'x']]);
  });
  it('rejects an unterminated quoted field instead of silently swallowing data', () => {
    expect(() => parseCsv('a,"oops\n1,2\n')).toThrow(/quoted/);
  });
  it('returns nothing for empty input', () => {
    expect(parseCsv('')).toEqual([]);
  });
});
