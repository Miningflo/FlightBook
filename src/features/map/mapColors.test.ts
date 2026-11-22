import { describe, expect, it } from 'vitest';
import { contrast, luminance } from '../../domain/contrast';
import { DEFAULT_MAP_COLOR, MAP_COLORS, applyMapColor, lightDark, mapColorById } from './mapColors';

// the basemap colours from styles.css
const BASE = { light: { land: '#f4f2ed', ocean: '#d9e6ef' }, dark: { land: '#232d36', ocean: '#14202a' } } as const;

describe('contrast helper', () => {
  it('matches the WCAG reference values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1);
  });
  it('rejects malformed colours', () => {
    expect(() => luminance('red')).toThrow();
  });
});

describe('map colour options', () => {
  it('offers six options with unique ids and labels, starting with the current blue', () => {
    expect(MAP_COLORS).toHaveLength(6);
    expect(new Set(MAP_COLORS.map((c) => c.id)).size).toBe(6);
    expect(new Set(MAP_COLORS.map((c) => c.label)).size).toBe(6);
    expect(MAP_COLORS[0]!.id).toBe(DEFAULT_MAP_COLOR);
  });
  for (const c of MAP_COLORS) {
    for (const scheme of ['light', 'dark'] as const) {
      const s = c[scheme], b = BASE[scheme];
      it(`${c.label} (${scheme}): the number is readable on its circle (at least 4.5:1)`, () => {
        expect(contrast(s.text, s.dot)).toBeGreaterThanOrEqual(4.5);
      });
      it(`${c.label} (${scheme}): circles and routes stand out from land and sea (at least 3:1)`, () => {
        for (const bg of [b.land, b.ocean]) {
          expect(contrast(s.dot, bg)).toBeGreaterThanOrEqual(3);
          expect(contrast(s.route, bg)).toBeGreaterThanOrEqual(3);
        }
      });
    }
  }
  it('an unknown or missing id falls back to the default', () => {
    expect(mapColorById('nope').id).toBe(DEFAULT_MAP_COLOR);
    expect(mapColorById(undefined).id).toBe(DEFAULT_MAP_COLOR);
    expect(mapColorById('magenta').label).toBe('Aviation magenta');
  });
  it('builds a light-dark() value and applies / clears the CSS variables', () => {
    expect(lightDark('#111111', '#eeeeee')).toBe('light-dark(#111111, #eeeeee)');
    const style = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => style.set(k, v), removeProperty: (k: string) => style.delete(k) } } as unknown as HTMLElement;
    applyMapColor('magenta', root);
    expect(style.get('--map-route')).toBe('light-dark(#b3157a, #ff7ad9)');
    expect(style.get('--map-dot-text')).toBe('light-dark(#ffffff, #4a0033)');
    applyMapColor('blue', root);
    expect([...style.keys()]).toEqual([]);
    applyMapColor('crimson', root);
    applyMapColor(undefined, root);
    expect(style.size).toBe(0);
  });
});
