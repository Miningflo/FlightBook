import { DriveError, DriveUnreachableError, NeedsSignInError, type TokenProvider } from './types';

/** The small part of Google Identity Services (token model) that this app uses. */
interface GoogleTokenResponse { access_token?: string; expires_in?: number | string; error?: string; error_description?: string }
interface GoogleTokenClient { requestAccessToken(overrides?: { prompt?: string }): void }
export interface GoogleAccounts {
  oauth2: {
    initTokenClient(config: {
      client_id: string; scope: string;
      callback: (r: GoogleTokenResponse) => void;
      error_callback?: (e: { type?: string; message?: string }) => void;
    }): GoogleTokenClient;
    revoke(token: string, done?: () => void): void;
  };
}

const GIS_URL = 'https://accounts.google.com/gsi/client';

export function loadGisScript(doc: Document = document): Promise<void> {
  if ((window as unknown as { google?: { accounts?: unknown } }).google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = doc.createElement('script');
    s.src = GIS_URL; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new DriveUnreachableError('Google sign-in could not be loaded. Check your connection.')); };
    doc.head.appendChild(s);
  });
}

interface GisDeps {
  loadScript?: () => Promise<void>;
  accounts?: () => GoogleAccounts;
  now?: () => number;
  /** How long to wait for the sign-in popup before giving up. */
  timeoutMs?: number;
}

/**
 * Access tokens through Google Identity Services' token flow (no backend, no refresh token). A token lives
 * about an hour and is kept in memory only. Getting a new one needs Google's popup; browsers allow that only
 * from a tap, so a background call that cannot be silent reports NeedsSignInError and the UI shows a button.
 */
export class GisTokenProvider implements TokenProvider {
  private token: { value: string; expiresAt: number } | null = null;
  private inflight: Promise<string> | null = null;
  private readonly deps: Required<GisDeps>;

  constructor(private readonly clientId: string, private readonly scope: string, deps: GisDeps = {}) {
    this.deps = {
      loadScript: deps.loadScript ?? (() => loadGisScript()),
      accounts: deps.accounts ?? (() => (window as unknown as { google: { accounts: GoogleAccounts } }).google.accounts),
      now: deps.now ?? Date.now,
      timeoutMs: deps.timeoutMs ?? 90_000,
    };
  }

  async getToken(opts: { interactive?: boolean } = {}): Promise<string> {
    if (this.token && this.token.expiresAt - this.deps.now() > 60_000) return this.token.value;
    // concurrent callers share one popup
    this.inflight ??= this.fetchToken(!!opts.interactive).finally(() => { this.inflight = null; });
    return this.inflight;
  }

  private async fetchToken(interactive: boolean): Promise<string> {
    await this.deps.loadScript();
    return new Promise<string>((resolve, reject) => {
      const fail = (e: Error) => { clearTimeout(timer); reject(e); };
      const timer = setTimeout(() => fail(interactive ? new DriveError('Google sign-in timed out.') : new NeedsSignInError()), this.deps.timeoutMs);
      const client = this.deps.accounts().oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: (r) => {
          if (r.error || !r.access_token) {
            const silent = r.error === 'interaction_required' || r.error === 'login_required' || r.error === 'consent_required';
            return fail(silent && !interactive ? new NeedsSignInError() : new DriveError(r.error === 'access_denied' ? 'Access to Google Drive was not granted.' : `Google sign-in failed${r.error ? `: ${r.error}` : ''}.`));
          }
          clearTimeout(timer);
          this.token = { value: r.access_token, expiresAt: this.deps.now() + Number(r.expires_in ?? 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => {
          // popup blocked / closed without choosing
          if (interactive && e.type === 'popup_closed') return fail(new DriveError('The Google sign-in window was closed.'));
          fail(interactive ? new DriveError(`Google sign-in could not open (${e.type ?? 'unknown'}). Allow pop-ups for this site and try again.`) : new NeedsSignInError());
        },
      });
      client.requestAccessToken({ prompt: '' });
    });
  }

  invalidate(): void { this.token = null; }

  async revoke(): Promise<void> {
    const t = this.token?.value;
    this.token = null;
    if (!t) return;
    await this.deps.loadScript();
    await new Promise<void>((resolve) => this.deps.accounts().oauth2.revoke(t, () => resolve()));
  }
}
