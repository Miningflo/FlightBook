import { describe, expect, it } from 'vitest';
import { lookupOnlinePhoto } from './online';
import { pickPlanespottersPhoto, planespottersUrl } from './planespotters';

const psBody = (over: Record<string, unknown> = {}) => ({
  photos: [{
    id: '1',
    thumbnail: { src: 'https://t.plnspttrs.net/12345/small.jpg', size: { width: 200, height: 133 } },
    thumbnail_large: { src: 'https://t.plnspttrs.net/12345/large.jpg', size: { width: 420, height: 280 } },
    link: 'https://www.planespotters.net/photo/1/oo-abc-x',
    photographer: '  Jane   Doe ',
    ...over,
  }],
});
const commonsBody = {
  query: { pages: { '1': { title: 'File:OO-ABC Cessna.jpg', imageinfo: [{ thumburl: 'https://upload.wikimedia.org/a.jpg', descriptionurl: 'https://commons.wikimedia.org/wiki/File:a.jpg', mime: 'image/jpeg', extmetadata: {} }] } } },
};

/** Fake fetch routed by host. */
function router(handlers: { ps?: () => Response; commons?: () => Response }) {
  const calls: string[] = [];
  const f = (async (u: string) => {
    calls.push(u);
    const h = u.includes('planespotters') ? handlers.ps : handlers.commons;
    if (!h) throw new Error('network down');
    return h();
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (b: unknown, status = 200) => () => new Response(JSON.stringify(b), { status });

describe('pickPlanespottersPhoto', () => {
  it('uses the large thumbnail, the photo link and a cleaned-up photographer name', () => {
    const p = pickPlanespottersPhoto('oo-abc', psBody(), 7)!;
    expect(p).toMatchObject({ registration: 'OO-ABC', source: 'planespotters', imageUrl: 'https://t.plnspttrs.net/12345/large.jpg', pageUrl: 'https://www.planespotters.net/photo/1/oo-abc-x', artist: 'Jane Doe', fetchedAt: 7 });
  });
  it('falls back to the small thumbnail', () => {
    expect(pickPlanespottersPhoto('X', psBody({ thumbnail_large: undefined }), 0)?.imageUrl).toBe('https://t.plnspttrs.net/12345/small.jpg');
  });
  it('rejects foreign hosts, non-https and a missing attribution link', () => {
    expect(pickPlanespottersPhoto('X', psBody({ thumbnail_large: { src: 'https://evil.example/a.jpg' }, thumbnail: undefined }), 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', psBody({ thumbnail_large: { src: 'http://t.plnspttrs.net/a.jpg' }, thumbnail: undefined }), 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', psBody({ link: 'https://evil.example/p' }), 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', psBody({ link: undefined }), 0)).toBeNull();
  });
  it('tolerates empty and malformed responses', () => {
    expect(pickPlanespottersPhoto('X', { photos: [] }, 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', {}, 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', { photos: 'nope' } as never, 0)).toBeNull();
    expect(pickPlanespottersPhoto('X', null as never, 0)).toBeNull();
  });
  it('encodes the registration in the URL', () => {
    expect(planespottersUrl(' oo-abc ')).toBe('https://api.planespotters.net/pub/photos/reg/OO-ABC');
  });
});

describe('lookupOnlinePhoto', () => {
  it('prefers Planespotters and does not call Commons when it has a photo', async () => {
    const { f, calls } = router({ ps: json(psBody()), commons: json(commonsBody) });
    const r = await lookupOnlinePhoto('OO-ABC', f, 1);
    expect(r.source).toBe('planespotters');
    expect(r.lookupVersion).toBe(2);
    expect(calls).toHaveLength(1);
  });
  it('falls through to Commons when Planespotters has no photo', async () => {
    const { f } = router({ ps: json({ photos: [] }), commons: json(commonsBody) });
    expect((await lookupOnlinePhoto('OO-ABC', f, 1)).source).toBe('commons');
  });
  it('falls through to Commons when Planespotters fails (blocked, down, or HTTP error)', async () => {
    const blocked = router({ ps: json({ error: 'blocked' }, 403), commons: json(commonsBody) });
    expect((await lookupOnlinePhoto('OO-ABC', blocked.f, 1)).source).toBe('commons');
    const down = router({ commons: json(commonsBody) });
    expect((await lookupOnlinePhoto('OO-ABC', (async (u: string) => { if (u.includes('planespotters')) throw new Error('x'); return down.f(u); }) as never, 1)).source).toBe('commons');
  });
  it('reports "none" only when both sources answered with no photo', async () => {
    const { f } = router({ ps: json({ photos: [] }), commons: json({}) });
    expect(await lookupOnlinePhoto('OO-ABC', f, 5)).toEqual({ registration: 'OO-ABC', status: 'none', fetchedAt: 5, lookupVersion: 2 });
  });
  it('throws, rather than reporting "none", when a source failed and the other found nothing', async () => {
    const { f } = router({ ps: json({ error: 'blocked' }, 403), commons: json({}) });
    await expect(lookupOnlinePhoto('OO-ABC', f, 5)).rejects.toThrow();
    const both = router({});
    await expect(lookupOnlinePhoto('OO-ABC', both.f, 5)).rejects.toThrow();
  });
});
