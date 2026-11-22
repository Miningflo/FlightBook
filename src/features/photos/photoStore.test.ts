import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LogbookDB } from '../../db/db';
import { OnlinePhotoStore } from './photoStore';
import type { PhotoCacheEntry } from '../../domain/types';

let n = 0;
let db: LogbookDB;
const found = (reg: string, t: number): PhotoCacheEntry => ({ registration: reg, status: 'found', lookupVersion: 2, fetchedAt: t, imageUrl: 'https://upload.wikimedia.org/a.jpg', pageUrl: 'https://commons.wikimedia.org/wiki/File:a.jpg' });

beforeEach(() => { db = new LogbookDB(`photo-${++n}`); });
afterEach(async () => { db.close(); await db.delete(); });

describe('OnlinePhotoStore', () => {
  it('looks up once, caches, and serves later calls from the cache', async () => {
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async (r: string, _f: unknown, now: number) => { calls++; return found(r, now); }) as never);
    const a = await s.resolve('OO-ABC', { allowNetwork: true, now: 1000 });
    const b = await s.resolve('OO-ABC', { allowNetwork: true, now: 2000 });
    expect(a?.status).toBe('found');
    expect(b?.fetchedAt).toBe(1000);
    expect(calls).toBe(1);
  });
  it('shares one network call between concurrent requests', async () => {
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async (r: string, _f: unknown, now: number) => { calls++; await new Promise((x) => setTimeout(x, 10)); return found(r, now); }) as never);
    await Promise.all([1, 2, 3, 4].map(() => s.resolve('OO-ABC', { allowNetwork: true, now: 1 })));
    expect(calls).toBe(1);
  });
  it('never touches the network when it is not allowed', async () => {
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async () => { calls++; return found('X', 0); }) as never);
    expect(await s.resolve('OO-ABC', { allowNetwork: false })).toBeUndefined();
    expect(calls).toBe(0);
  });
  it('does not cache a failed lookup as "no photo", and does not retry within the session', async () => {
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async () => { calls++; throw new Error('offline'); }) as never);
    expect(await s.resolve('OO-ABC', { allowNetwork: true })).toBeUndefined();
    expect(await s.resolve('OO-ABC', { allowNetwork: true })).toBeUndefined();
    expect(calls).toBe(1);
    expect(await db.photoCache.count()).toBe(0);
  });
  it('keeps showing a stale photo when the refresh fails', async () => {
    const old = found('OO-ABC', 0);
    await db.photoCache.put(old);
    const s = new OnlinePhotoStore(db, (async () => { throw new Error('offline'); }) as never);
    const r = await s.resolve('OO-ABC', { allowNetwork: true, now: 400 * 86_400_000 });
    expect(r).toEqual(old);
  });
  it('re-checks a "none" result only after two weeks', async () => {
    await db.photoCache.put({ registration: 'OO-ABC', status: 'none', lookupVersion: 2, fetchedAt: 0 });
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async (r: string, _f: unknown, now: number) => { calls++; return found(r, now); }) as never);
    expect(await s.resolve('OO-ABC', { allowNetwork: true, now: 13 * 86_400_000 })).toMatchObject({ status: 'none' });
    expect(calls).toBe(0);
    expect(await s.resolve('OO-ABC', { allowNetwork: true, now: 15 * 86_400_000 })).toMatchObject({ status: 'found' });
    expect(calls).toBe(1);
  });
  it('re-checks entries written by older lookup logic, even recent ones', async () => {
    await db.photoCache.put({ registration: 'OO-ABC', status: 'none', fetchedAt: 1000 }); // no lookupVersion = v1
    let calls = 0;
    const s = new OnlinePhotoStore(db, (async (r: string, _f: unknown, now: number) => { calls++; return found(r, now); }) as never);
    expect(await s.resolve('OO-ABC', { allowNetwork: true, now: 2000 })).toMatchObject({ status: 'found' });
    expect(calls).toBe(1);
  });
});
