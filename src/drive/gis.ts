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
 * about an hour and is kept in memory only.
 *
 * Getting a token ALWAYS opens Google's window, even with prompt '' and consent already given: there is no
 * silent refresh in this flow. So a background call (a scheduled backup, a viewer refresh) never asks for
 * one. Without a valid token it reports NeedsSignInError straight away and the UI shows a button; the
 * window opens only from a tap. Asking from the background made the window flash up and vanish on every
 * scheduled backup, and, because a popup that does not come from a tap is usually blocked and so yields no
 * token, again on every retry (each save, each time the connection came back).
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
    if (!opts.interactive) {
      // a sign-in the user already started is fine to wait for; starting one is not (see above)
      if (this.inflight) return this.inflight;
      throw new NeedsSignInError();
    }
    // concurrent callers share one window
    this.inflight ??= this.fetchToken().finally(() => { this.inflight = null; });
    return this.inflight;
  }

  /** Opens Google's window. Only ever reached from a tap. */
  private async fetchToken(): Promise<string> {
    await this.deps.loadScript();
    return new Promise<string>((resolve, reject) => {
      const fail = (e: Error) => { clearTimeout(timer); reject(e); };
      const timer = setTimeout(() => fail(new DriveError('Google sign-in timed out.')), this.deps.timeoutMs);
      const client = this.deps.accounts().oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        callback: (r) => {
          if (r.error || !r.access_token) {
            return fail(new DriveError(r.error === 'access_denied' ? 'Access to Google Drive was not granted.' : `Google sign-in failed${r.error ? `: ${r.error}` : ''}.`));
          }
          clearTimeout(timer);
          this.token = { value: r.access_token, expiresAt: this.deps.now() + Number(r.expires_in ?? 3600) * 1000 };
          resolve(r.access_token);
        },
        error_callback: (e) => {
          if (e.type === 'popup_closed') return fail(new DriveError('The Google sign-in window was closed.'));
          fail(new DriveError(`Google sign-in could not open (${e.type ?? 'unknown'}). Allow pop-ups for this site and try again.`));
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
