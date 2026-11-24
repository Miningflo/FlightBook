import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CreditError, buildCredits, creditsIn, renderCredits, replaceCredits } from './photo-credits.mjs';

const cessna = {
  registration: 'OO-CEU', status: 'found', source: 'commons', imageUrl: 'https://upload.wikimedia.org/a.jpg',
  title: 'Keiheuvel Cessna 172S Skyhawk OO-CEU 02.JPG', artist: 'Ad Meskens', license: 'CC BY-SA 4.0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:A.JPG',
};
const piper = {
  registration: 'OO-ILS', status: 'found', source: 'commons', imageUrl: 'https://upload.wikimedia.org/b.jpg',
  title: 'Piper PA28-181 OO-ILS (8439360388).jpg', artist: 'Alan Wilson', license: 'CC BY-SA 2.0',
  pageUrl: 'https://commons.wikimedia.org/wiki/File:B.jpg',
};
const shots = [
  { file: 'logbook.png', imageUrls: [cessna.imageUrl, piper.imageUrl] },
  { file: 'flight.png', imageUrls: [cessna.imageUrl] },
  { file: 'totals.png', imageUrls: [] },
];

describe('the committed screenshots are credited', () => {
  const json = JSON.parse(readFileSync('docs/screenshots/photo-credits.json', 'utf8'));
  it('the README credits are exactly what the screenshot run recorded (edit neither by hand)', () => {
    expect(creditsIn(readFileSync('README.md', 'utf8'))).toBe(renderCredits(json.photos));
  });
  it('every credited photo names its author, licence and source, and screenshots that exist', () => {
    for (const p of json.photos) {
      for (const k of ['title', 'artist', 'license', 'pageUrl']) expect(p[k], `${p.registration} ${k}`).toBeTruthy();
      expect(p.files.length).toBeGreaterThan(0);
      for (const f of p.files) expect(existsSync(`docs/screenshots/${f}`), f).toBe(true);
    }
  });
});

describe('buildCredits', () => {
  it('credits each photo once, with every screenshot it appears in', () => {
    const c = buildCredits(shots, [cessna, piper]);
    expect(c.map((p) => [p.registration, p.files])).toEqual([['OO-CEU', ['logbook.png', 'flight.png']], ['OO-ILS', ['logbook.png']]]);
    expect(c[0].title).toBe('Keiheuvel Cessna 172S Skyhawk OO-CEU 02'); // file extension dropped
  });
  it('refuses a photo it cannot credit, so it never reaches docs/', () => {
    const bad = (o) => () => buildCredits([{ file: 'x.png', imageUrls: [cessna.imageUrl] }], [{ ...cessna, ...o }]);
    expect(() => buildCredits([{ file: 'x.png', imageUrls: ['https://elsewhere/c.jpg'] }], [cessna])).toThrow(CreditError);
    expect(bad({ source: 'planespotters' })).toThrow(/not from Wikimedia Commons/);
    expect(bad({ artist: '' })).toThrow(/no artist/);
    expect(bad({ license: '  ' })).toThrow(/no license/);
    expect(bad({ pageUrl: undefined })).toThrow(/no pageUrl/);
    // a licence that may not be mixable under CC BY-SA 4.0 is a decision for a person
    expect(bad({ license: 'CC BY-NC-SA 4.0' })).toThrow(/decide by hand/);
    expect(bad({ license: 'CC BY 4.0' })).toThrow(/decide by hand/);
  });
  it('a screenshot without photos needs no credit', () => {
    expect(buildCredits([{ file: 'totals.png', imageUrls: [] }], [])).toEqual([]);
  });
});

describe('renderCredits', () => {
  const md = renderCredits(buildCredits(shots, [cessna, piper]));
  it('names every photo with title, author, licence, source and where it appears', () => {
    expect(md).toContain('| "Keiheuvel Cessna 172S Skyhawk OO-CEU 02" | Ad Meskens | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0) | [Wikimedia Commons](https://commons.wikimedia.org/wiki/File:A.JPG) | `logbook.png`, `flight.png` |');
    expect(md).toMatch(/^Two third-party photos appear in the screenshots: OO-CEU and OO-ILS in `docs\/screenshots\/logbook.png` and OO-CEU in `docs\/screenshots\/flight.png`\./m);
  });
  it('licenses exactly the screenshots with photos, and explains a mixture of versions', () => {
    expect(md).toContain('**`docs/screenshots/logbook.png` and `docs/screenshots/flight.png` are shared under [CC BY-SA 4.0]');
    expect(md).not.toContain('totals.png');
    expect(md).toMatch(/CC BY-SA 2\.0 \(\[§4\(b\)\]\(https:\/\/creativecommons\.org\/licenses\/by-sa\/2\.0\/legalcode\)\) lets an adaptation be distributed/);
    expect(renderCredits(buildCredits([shots[1]], [cessna]))).not.toMatch(/§4\(b\)/); // nothing to explain
  });
  it('says so when there are no photos at all', () => {
    expect(renderCredits([])).toContain('No third-party photos appear in the screenshots.');
  });
});

describe('replaceCredits', () => {
  it('replaces only the marked section, keeping the README\'s line endings', () => {
    const readme = 'a\r\n### Photo credits\r\n<!-- photo-credits:start -->\r\nold\r\n<!-- photo-credits:end -->\r\n## Setup\r\n';
    const out = replaceCredits(readme, renderCredits([]));
    expect(out.startsWith('a\r\n### Photo credits\r\n<!-- photo-credits:start -->\r\n')).toBe(true);
    expect(out.endsWith('<!-- photo-credits:end -->\r\n## Setup\r\n')).toBe(true);
    expect(out).not.toContain('old');
    expect(out.replace(/\r\n/g, '')).toBe(out.replace(/\r\n/g, '').replace(/\n/g, '')); // no bare \n introduced
  });
  it('refuses a README without the markers instead of guessing where the credits go', () => {
    expect(() => replaceCredits('# README\n', renderCredits([]))).toThrow(/no <!-- photo-credits:start -->/);
  });
});
