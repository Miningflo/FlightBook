import { useEffect, useState } from 'react';
import { useApp } from '../../AppContext';

export interface PhotoCredit {
  title?: string;
  artist?: string;
  license?: string;
  pageUrl: string;
  source: 'planespotters' | 'commons';
}
export type PhotoState =
  | { kind: 'loading' }
  | { kind: 'fallback' }
  | { kind: 'online'; src: string; credit: PhotoCredit };

/**
 * Online photo (if enabled) with its credit, else a generated placeholder. Nothing image-sized is stored locally.
 * Nothing is looked up until `wanted` is true (a list passes "the card is near the screen").
 */
export function useAircraftPhoto(registration: string, wanted = true): PhotoState {
  const { onlinePhotos, data } = useApp();
  const allowOnline = data.settings.fetchAircraftPhotos;
  const [state, setState] = useState<PhotoState>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    if (!wanted) return;
    if (!allowOnline) {
      setState({ kind: 'fallback' });
      return;
    }
    void onlinePhotos
      .resolve(registration, { allowNetwork: navigator.onLine })
      .then((online) => {
        if (cancelled) return;
        if (online?.status === 'found' && online.imageUrl && online.pageUrl) {
          setState({ kind: 'online', src: online.imageUrl, credit: { title: online.title, artist: online.artist, license: online.license, pageUrl: online.pageUrl, source: online.source ?? 'commons' } });
        } else {
          setState({ kind: 'fallback' });
        }
      })
      .catch(() => { if (!cancelled) setState({ kind: 'fallback' }); });
    return () => { cancelled = true; };
  }, [onlinePhotos, registration, allowOnline, wanted]);

  return state;
}
