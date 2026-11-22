import { describe, expect, it } from 'vitest';
import { commonsQueryUrl, htmlToText, lookupCommonsPhoto, pickCommonsPhoto, type CommonsResponse } from './commons';

const page = (title: string, over: Record<string, unknown> = {}) => ({
  title,
  imageinfo: [{
    thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/x.jpg/900px-x.jpg',
    descriptionurl: 'https://commons.wikimedia.org/wiki/File:x.jpg',
    mime: 'image/jpeg',
    extmetadata: { Artist: { value: '<a href="https://example.org">Jane &amp; Co</a>' }, LicenseShortName: { value: 'CC BY-SA 2.0' } },
    ...over,
  }],
});
const res = (...pages: ReturnType<typeof page>[]): CommonsResponse => ({ query: { pages: Object.fromEntries(pages.map((p, i) => [String(i), p])) } });

describe('pickCommonsPhoto', () => {
  it('accepts a result whose file name contains the registration', () => {
    const p = pickCommonsPhoto('OO-SSA', res(page('File:Brussels Airlines, OO-SSA, Airbus A319.jpg')), 5)!;
    expect(p.status).toBe('found');
    expect(p.registration).toBe('OO-SSA');
    expect(p.artist).toBe('Jane & Co');
    expect(p.license).toBe('CC BY-SA 2.0');
    expect(p.fetchedAt).toBe(5);
  });
  it('skips unrelated results the fuzzy search returned and takes the first real match', () => {
    const p = pickCommonsPhoto('OO-SSA', res(page('File:Taxiing to gate.jpg'), page('File:Meridiana EI-DFP.jpg'), page('File:OO-SSA Airbus A319.jpg')), 0)!;
    expect(p.title).toBe('OO-SSA Airbus A319.jpg');
  });
  it('matches without the hyphen but not inside a longer token', () => {
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OOSSA at EBBR.jpg')), 0)).not.toBeNull();
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSAB test.jpg')), 0)).toBeNull();
    expect(pickCommonsPhoto('OO-SSA', res(page('File:XOO-SSA.jpg')), 0)).toBeNull();
  });
  it('returns null when nothing matches, the response is empty, or the registration is too short', () => {
    expect(pickCommonsPhoto('OO-ABC', res(page('File:Other.jpg')), 0)).toBeNull();
    expect(pickCommonsPhoto('OO-ABC', {}, 0)).toBeNull();
    expect(pickCommonsPhoto('A', res(page('File:A.jpg')), 0)).toBeNull();
  });
  it('rejects image or page URLs outside Wikimedia', () => {
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSA.jpg', { thumburl: 'https://evil.example/x.jpg' })), 0)).toBeNull();
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSA.jpg', { descriptionurl: 'https://evil.example/p' })), 0)).toBeNull();
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSA.jpg', { thumburl: 'http://upload.wikimedia.org/x.jpg' })), 0)).toBeNull();
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSA.jpg', { thumburl: 'javascript:alert(1)' })), 0)).toBeNull();
  });
  it('rejects non-image media', () => {
    expect(pickCommonsPhoto('OO-SSA', res(page('File:OO-SSA.ogv', { mime: 'video/ogg' })), 0)).toBeNull();
  });
});

describe('htmlToText', () => {
  it('strips tags and decodes common entities, never leaving markup', () => {
    expect(htmlToText('<b>A</b> &lt;script&gt; &amp; B')).toBe('A <script> & B');
    expect(htmlToText(undefined)).toBeUndefined();
    expect(htmlToText('<br>')).toBeUndefined();
  });
});

describe('lookupCommonsPhoto', () => {
  it('queries by registration and maps "no match" to a none entry', async () => {
    let url = '';
    const f = (async (u: string) => { url = u; return new Response(JSON.stringify({}), { status: 200 }); }) as unknown as typeof fetch;
    const r = await lookupCommonsPhoto('OO-ABC', f, 9);
    expect(r).toEqual({ registration: 'OO-ABC', status: 'none', fetchedAt: 9 });
    expect(url).toBe(commonsQueryUrl('OO-ABC'));
    expect(url).toContain('origin=*');
  });
  it('throws on HTTP errors instead of caching a failure as "none"', async () => {
    const f = (async () => new Response('x', { status: 503 })) as unknown as typeof fetch;
    await expect(lookupCommonsPhoto('OO-ABC', f)).rejects.toThrow(/503/);
  });
});
