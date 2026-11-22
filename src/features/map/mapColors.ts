export interface MapScheme { route: string; dot: string; text: string }
export interface MapColor { id: string; label: string; light: MapScheme; dark: MapScheme }

/**
 * Colours of the airports (dot and the number inside it) and routes on the map, for light and dark mode.
 * The basemap colours they must stand out from live in styles.css (--map-land, --map-ocean).
 */
export const MAP_COLORS: readonly MapColor[] = [
  { id: 'blue', label: 'Blue', light: { route: '#1b5e8c', dot: '#1b5e8c', text: '#ffffff' }, dark: { route: '#9ccaff', dot: '#9ccaff', text: '#003256' } },
  { id: 'magenta', label: 'Aviation magenta', light: { route: '#b3157a', dot: '#a01270', text: '#ffffff' }, dark: { route: '#ff7ad9', dot: '#ff9de2', text: '#4a0033' } },
  { id: 'amber', label: 'Amber', light: { route: '#cf5f09', dot: '#b5530a', text: '#ffffff' }, dark: { route: '#ffb15c', dot: '#ffc27d', text: '#4a2500' } },
  { id: 'crimson', label: 'Crimson', light: { route: '#c62828', dot: '#b71c1c', text: '#ffffff' }, dark: { route: '#ff8a80', dot: '#ff9e96', text: '#4a0000' } },
  { id: 'ink', label: 'Ink', light: { route: '#2b3540', dot: '#1f2933', text: '#ffffff' }, dark: { route: '#e6edf3', dot: '#f1f5f9', text: '#111827' } },
  { id: 'teal', label: 'Teal', light: { route: '#0f8a6d', dot: '#0b7a5f', text: '#ffffff' }, dark: { route: '#5be3c0', dot: '#7aebd0', text: '#00382b' } },
];

export const DEFAULT_MAP_COLOR = 'blue';

export const mapColorById = (id: string | undefined): MapColor => MAP_COLORS.find((c) => c.id === id) ?? MAP_COLORS[0]!;

/** CSS value that picks the light or dark colour from the page's colour scheme. */
export const lightDark = (light: string, dark: string): string => `light-dark(${light}, ${dark})`;

/** Set the map colour variables on <html>. The default is left to the stylesheet. */
export function applyMapColor(id: string | undefined, root: HTMLElement = document.documentElement): void {
  const c = mapColorById(id);
  if (c.id === DEFAULT_MAP_COLOR) {
    for (const v of ['--map-route', '--map-dot', '--map-dot-text']) root.style.removeProperty(v);
    return;
  }
  root.style.setProperty('--map-route', lightDark(c.light.route, c.dark.route));
  root.style.setProperty('--map-dot', lightDark(c.light.dot, c.dark.dot));
  root.style.setProperty('--map-dot-text', lightDark(c.light.text, c.dark.text));
}
