import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CreditError, buildCredits, creditsIn, publish, renderCredits, replaceCredits } from './photo-credits.mjs';

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
      // Vitest's expect takes a failure message as its second argument
      // oxlint-disable-next-line vitest/valid-expect
      for (const k of ['title', 'artist', 'license', 'pageUrl']) expect(p[k], `${p.registration} ${k}`).toBeTruthy();
      expect(p.files.length).toBeGreaterThan(0);
      // oxlint-disable-next-line vitest/valid-expect -- the message names the missing screenshot
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

describe('publish: the end of a screenshot run', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'credits-test-'));
    const stage = join(root, 'stage'), out = join(root, 'out'), readmePath = join(root, 'README.md');
    mkdirSync(stage); mkdirSync(out);
    for (const { file } of shots) writeFileSync(join(stage, file), `new ${file}`);
    writeFileSync(join(out, 'logbook.png'), 'old logbook.png');
    writeFileSync(readmePath, '# R\n### Photo credits\n<!-- photo-credits:start -->\nold\n<!-- photo-credits:end -->\n## Setup\n');
    return { root, stage, out, readmePath, done: () => rmSync(root, { recursive: true, force: true }) };
  };
  it('copies the screenshots and writes the credits when every photo can be credited', () => {
    const t = setup();
    try {
      const credits = publish({ shots, cache: [cessna, piper], ...t });
      expect(readdirSync(t.out).sort()).toEqual(['flight.png', 'logbook.png', 'photo-credits.json', 'totals.png']);
      expect(readFileSync(join(t.out, 'logbook.png'), 'utf8')).toBe('new logbook.png');
      expect(JSON.parse(readFileSync(join(t.out, 'photo-credits.json'), 'utf8')).photos).toEqual(credits);
      expect(creditsIn(readFileSync(t.readmePath, 'utf8'))).toBe(renderCredits(credits));
    } finally { t.done(); }
  });
  it('refuses and changes nothing when one photo cannot be credited', () => {
    const t = setup();
    try {
      const before = readFileSync(t.readmePath, 'utf8');
      expect(() => publish({ shots, cache: [cessna, { ...piper, artist: '' }], ...t })).toThrow(CreditError);
      expect(readdirSync(t.out)).toEqual(['logbook.png']);
      expect(readFileSync(join(t.out, 'logbook.png'), 'utf8')).toBe('old logbook.png'); // the old image, untouched
      expect(readFileSync(t.readmePath, 'utf8')).toBe(before);
    } finally { t.done(); }
  });
  it('refuses before copying anything when the README has lost its credits section', () => {
    const t = setup();
    try {
      writeFileSync(t.readmePath, '# R\n');
      expect(() => publish({ shots, cache: [cessna, piper], ...t })).toThrow(/no <!-- photo-credits:start -->/);
      expect(readdirSync(t.out)).toEqual(['logbook.png']);
    } finally { t.done(); }
  });
});
