/** "22 Nov 2026, 14:05" in the device's local time (the underlying values are UTC). */
export function formatWhen(iso: string | number): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const errorText = (e: unknown): string => (e instanceof Error ? e.message : String(e));
