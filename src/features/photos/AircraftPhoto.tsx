import { useState, type ReactNode } from 'react';
import { PlaneGlyph } from '../../ui/Icons';
import { type PhotoState, useAircraftPhoto } from './usePhoto';

/** Stable hue from the registration, so each aircraft gets its own placeholder colour. */
export function hueOf(registration: string): number {
  let h = 0;
  for (const c of registration) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function PhotoFrame({
  registration, photo, className, children,
}: { registration: string; photo: PhotoState; className: string; children?: ReactNode }) {
  const [broken, setBroken] = useState<string | null>(null);
  const src = photo.kind === 'online' ? photo.src : null;
  const showImg = src !== null && broken !== src;
  const hue = hueOf(registration);
  return (
    <div className={`photo ${className}`} style={{ ['--hue' as string]: hue }}>
      {showImg ? (
        <img src={src} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(src)} />
      ) : (
        <div className="photo-fallback" aria-hidden="true"><PlaneGlyph /></div>
      )}
      {children}
    </div>
  );
}

export function AircraftThumb({ registration }: { registration: string }) {
  const photo = useAircraftPhoto(registration);
  return <PhotoFrame registration={registration} photo={photo} className="thumb" />;
}

export function PhotoCreditLine({ photo }: { photo: PhotoState }) {
  if (photo.kind !== 'online') return null;
  const { credit } = photo;
  return (
    <p className="photo-credit">
      Photo{credit.artist ? ` by ${credit.artist}` : ''}{credit.license ? ` · ${credit.license}` : ''} ·{' '}
      <a href={credit.pageUrl} target="_blank" rel="noopener noreferrer">{credit.source === 'planespotters' ? 'Planespotters.net' : 'Wikimedia Commons'}</a>
    </p>
  );
}
