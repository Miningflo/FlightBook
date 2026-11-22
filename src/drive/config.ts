/** Build-time configuration. The OAuth client ID is not a secret (it identifies the app, it grants nothing). */
export const GOOGLE_CLIENT_ID: string = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim() ?? '';
/** Only files this app created are visible to it; it cannot see the rest of the user's Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const driveConfigured = (): boolean => GOOGLE_CLIENT_ID !== '';
