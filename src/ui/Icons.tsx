import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
};
export const PlusIcon = () => <svg {...base}><path d="M12 5v14M5 12h14" /></svg>;
export const BackIcon = () => <svg {...base}><path d="M19 12H5M12 19l-7-7 7-7" /></svg>;
export const SettingsIcon = () => (
  <svg {...base}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
);
export const EditIcon = () => <svg {...base}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 1 1 3 3L7 19l-4 1 1-4z" /></svg>;
export const MoonIcon = () => <svg {...base}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>;
export const ClockIcon = () => <svg {...base}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
export const LandingIcon = () => <svg {...base}><path d="M2 19h20M4 15l6-1 8-8a2 2 0 0 1 3 3l-6 8-1 5-3-1-1-3-5 2z" /></svg>;
export const CloudIcon = () => <svg {...base}><path d="M17.5 19H9a7 7 0 1 1 6.7-9h1.8a5 5 0 0 1 0 10z" /></svg>;

/** Filled aircraft silhouette used for placeholders and the route line. */
export const PlaneGlyph = (props: SVGProps<SVGSVGElement>) => (
  <svg width={24} height={24} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z" />
  </svg>
);
export const ListIcon = () => <svg {...base}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>;
export const ChartIcon = () => <svg {...base}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
export const ShieldIcon = () => <svg {...base}><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M9 12l2 2 4-4" /></svg>;
export const ChevronIcon = () => <svg {...base}><path d="M9 6l6 6-6 6" /></svg>;
export const MapIcon = () => <svg {...base}><path d="M9 3L3 5.5v15L9 18l6 3 6-2.5v-15L15 6 9 3zM9 3v15M15 6v15" /></svg>;
export const MinusIcon = () => <svg {...base}><path d="M5 12h14" /></svg>;
export const CloseIcon = () => <svg {...base}><path d="M6 6l12 12M18 6L6 18" /></svg>;
/** Four corner brackets: "show everything". */
export const FitIcon = () => <svg {...base}><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>;
