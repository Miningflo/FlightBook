import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GisTokenProvider, type GoogleAccounts } from './gis';
import { DriveError, NeedsSignInError } from './types';

type Cfg = Parameters<GoogleAccounts['oauth2']['initTokenClient']>[0];

function setup(behaviour: (cfg: Cfg, call: number) => void) {
  let calls = 0;
  const revoked: string[] = [];
  let now = 1_000_000;
  const accounts: GoogleAccounts = {
    oauth2: {
      initTokenClient: (cfg) => ({ requestAccessToken: () => { behaviour(cfg, ++calls); } }),
      revoke: (t, done) => { revoked.push(t); done?.(); },
    },
  };
  const provider = new GisTokenProvider('cid', 'scope-x', { loadScript: async () => {}, accounts: () => accounts, now: () => now, timeoutMs: 5000 });
  return { provider, calls: () => calls, revoked, advance: (ms: number) => { now += ms; } };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('GisTokenProvider', () => {
  it('requests the drive.file scope for its client and returns the token', async () => {
    let seen: Cfg | null = null;
    const t = setup((cfg) => { seen = cfg; cfg.callback({ access_token: 'abc', expires_in: 3600 }); });
    expect(await t.provider.getToken({ interactive: true })).toBe('abc');
    expect(seen!.client_id).toBe('cid');
    expect(seen!.scope).toBe('scope-x');
  });
  it('reuses the token until a minute before it expires, then asks again', async () => {
    const t = setup((cfg, n) => cfg.callback({ access_token: `tok${n}`, expires_in: 3600 }));
    expect(await t.provider.getToken({ interactive: true })).toBe('tok1');
    t.advance(3000 * 1000);
    expect(await t.provider.getToken()).toBe('tok1');
    t.advance(541 * 1000); // within the last 60 s
    expect(await t.provider.getToken({ interactive: true })).toBe('tok2');
    expect(t.calls()).toBe(2);
  });
  it('concurrent callers share one popup', async () => {
    let cb: Cfg['callback'] | null = null;
    const t = setup((cfg) => { cb = cfg.callback; });
    const a = t.provider.getToken({ interactive: true }), b = t.provider.getToken({ interactive: true });
    await vi.waitFor(() => expect(cb).not.toBeNull());
    cb!({ access_token: 'one', expires_in: 3600 });
    expect(await Promise.all([a, b])).toEqual(['one', 'one']);
    expect(t.calls()).toBe(1);
  });
  it('a background request that cannot be silent asks for sign-in instead of failing noisily', async () => {
    const popup = setup((cfg) => cfg.error_callback?.({ type: 'popup_failed_to_open' }));
    await expect(popup.provider.getToken({ interactive: false })).rejects.toBeInstanceOf(NeedsSignInError);
    const needs = setup((cfg) => cfg.callback({ error: 'interaction_required' }));
    await expect(needs.provider.getToken({ interactive: false })).rejects.toBeInstanceOf(NeedsSignInError);
  });
  it('the same problems are explained to the user when they tapped the button', async () => {
    const blocked = setup((cfg) => cfg.error_callback?.({ type: 'popup_failed_to_open' }));
    await expect(blocked.provider.getToken({ interactive: true })).rejects.toThrow(/Allow pop-ups/);
    const closed = setup((cfg) => cfg.error_callback?.({ type: 'popup_closed' }));
    await expect(closed.provider.getToken({ interactive: true })).rejects.toThrow(/closed/);
    const denied = setup((cfg) => cfg.callback({ error: 'access_denied' }));
    await expect(denied.provider.getToken({ interactive: true })).rejects.toThrow(/not granted/);
  });
  it('gives up after the timeout (silently when in the background)', async () => {
    const t = setup(() => { /* never answers */ });
    const p = t.provider.getToken({ interactive: false });
    const assertion = expect(p).rejects.toBeInstanceOf(NeedsSignInError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion;
    const u = setup(() => {});
    const q = u.provider.getToken({ interactive: true });
    const assertion2 = expect(q).rejects.toBeInstanceOf(DriveError);
    await vi.advanceTimersByTimeAsync(5001);
    await assertion2;
  });
  it('a failed request does not poison later ones', async () => {
    const t = setup((cfg, n) => (n === 1 ? cfg.callback({ error: 'access_denied' }) : cfg.callback({ access_token: 'ok', expires_in: 3600 })));
    await expect(t.provider.getToken({ interactive: true })).rejects.toBeInstanceOf(DriveError);
    expect(await t.provider.getToken({ interactive: true })).toBe('ok');
  });
  it('invalidate forgets the token; revoke tells Google', async () => {
    const t = setup((cfg, n) => cfg.callback({ access_token: `tok${n}`, expires_in: 3600 }));
    await t.provider.getToken({ interactive: true });
    t.provider.invalidate();
    expect(await t.provider.getToken({ interactive: true })).toBe('tok2');
    await t.provider.revoke();
    expect(t.revoked).toEqual(['tok2']);
    await t.provider.revoke(); // nothing to revoke: no second call
    expect(t.revoked).toEqual(['tok2']);
  });
});
