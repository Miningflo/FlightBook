// Test-only: an in-memory Google Drive v3 that understands exactly the requests the app makes.
// It also emulates the drive.file scope: a client only ever sees files that its own client ID created.

export interface FakeFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  content: string;
  createdTime: string;
  appProperties?: Record<string, string>;
  trashed: boolean;
  clientId: string;
}

export interface FakeRequestLog {
  method: string;
  path: string;
  clientId: string;
}

export interface FakeDrive {
  fetch: typeof fetch;
  files: Map<string, FakeFile>;
  requests: FakeRequestLog[];
  /** Tokens are "tok:<clientId>:<n>". Bumping the epoch makes all earlier tokens answer 401. */
  expireTokens(): void;
  tokenFor(clientId: string): string;
  /** Make the next `count` requests fail with this status. */
  failNext(status: number, count?: number): void;
  /** Make the next requests fail as if offline. */
  goOffline(on: boolean): void;
  setClock(iso: () => string): void;
}

const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function createFakeDrive(): FakeDrive {
  const files = new Map<string, FakeFile>();
  const requests: FakeRequestLog[] = [];
  let epoch = 0;
  let nextId = 1;
  let tick = 0;
  let failures: { status: number; left: number } | null = null;
  let offline = false;
  let clock = (): string => new Date(Date.UTC(2025, 0, 1, 0, 0, tick++)).toISOString();

  const view = (f: FakeFile) => ({ id: f.id, name: f.name, createdTime: f.createdTime, modifiedTime: f.createdTime, size: String(f.content.length), appProperties: f.appProperties, mimeType: f.mimeType });

  function parseMultipart(body: string): { meta: Record<string, unknown>; content: string } {
    const boundary = /^--(\S+)/.exec(body)![1]!;
    const parts = body.split(`--${boundary}`).filter((p) => p.trim() !== '' && p.trim() !== '--');
    const bodyOf = (p: string) => p.slice(p.indexOf('\r\n\r\n') + 4).replace(/\r\n$/, '');
    return { meta: JSON.parse(bodyOf(parts[0]!)) as Record<string, unknown>, content: bodyOf(parts[1]!) };
  }

  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if (offline) throw new TypeError('Failed to fetch');
    const url = new URL(String(input));
    const method = (init?.method ?? 'GET').toUpperCase();
    const auth = new Headers(init?.headers).get('Authorization') ?? '';
    const m = /^Bearer tok:([^:]+):(\d+)$/.exec(auth);
    const clientId = m?.[1] ?? '';
    requests.push({ method, path: url.pathname + (url.searchParams.get('alt') ? '?alt=' + url.searchParams.get('alt') : ''), clientId });
    if (!m || Number(m[2]) !== epoch) return json(401, { error: { message: 'Invalid Credentials' } });
    if (failures && failures.left > 0) { failures.left--; return json(failures.status, { error: { message: `injected ${failures.status}` } }); }

    const mine = (f: FakeFile) => f.clientId === clientId && !f.trashed;
    const path = url.pathname;
    const body = typeof init?.body === 'string' ? init.body : '';

    if (method === 'GET' && path === '/drive/v3/files') {
      const q = url.searchParams.get('q') ?? '';
      const parent = /'((?:[^'\\]|\\.)+)' in parents/.exec(q)?.[1];
      const name = /name = '((?:[^'\\]|\\.)*)'/.exec(q)?.[1]?.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
      const mime = /mimeType = '([^']+)'/.exec(q)?.[1];
      let list = [...files.values()].filter(mine).filter((f) => (parent ? f.parents.includes(parent) : true) && (name !== undefined ? f.name === name : true) && (mime ? f.mimeType === mime : true));
      const order = url.searchParams.get('orderBy') ?? '';
      list.sort((a, b) => (order.includes('desc') ? b.createdTime.localeCompare(a.createdTime) : a.createdTime.localeCompare(b.createdTime)));
      const size = Number(url.searchParams.get('pageSize') ?? 100);
      const start = Number(url.searchParams.get('pageToken') ?? 0);
      const page = list.slice(start, start + size);
      return json(200, { files: page.map(view), nextPageToken: start + size < list.length ? String(start + size) : undefined });
    }
    const one = /^\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (one) {
      const f = files.get(decodeURIComponent(one[1]!));
      if (!f || !mine(f)) return json(404, { error: { message: 'File not found' } });
      if (method === 'GET' && url.searchParams.get('alt') === 'media') return new Response(f.content, { status: 200 });
      if (method === 'DELETE') { files.delete(f.id); return new Response(null, { status: 204 }); }
    }
    if (method === 'POST' && path === '/drive/v3/files') {
      const meta = JSON.parse(body) as { name: string; mimeType: string };
      const f: FakeFile = { id: `id${nextId++}`, name: meta.name, mimeType: meta.mimeType, parents: [], content: '', createdTime: clock(), trashed: false, clientId };
      files.set(f.id, f);
      return json(200, view(f));
    }
    if (path === '/upload/drive/v3/files' && method === 'POST') {
      const { meta, content } = parseMultipart(body);
      const parents = (meta.parents as string[] | undefined) ?? [];
      for (const p of parents) if (!files.get(p) || !mine(files.get(p)!)) return json(404, { error: { message: 'Parent not found' } });
      const f: FakeFile = { id: `id${nextId++}`, name: String(meta.name), mimeType: String(meta.mimeType ?? 'application/json'), parents, content, createdTime: clock(), appProperties: meta.appProperties as Record<string, string> | undefined, trashed: false, clientId };
      files.set(f.id, f);
      return json(200, view(f));
    }
    const upd = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(path);
    if (upd && method === 'PATCH') {
      const f = files.get(decodeURIComponent(upd[1]!));
      if (!f || !mine(f)) return json(404, { error: { message: 'File not found' } });
      const { meta, content } = parseMultipart(body);
      f.content = content;
      if (meta.appProperties) f.appProperties = meta.appProperties as Record<string, string>;
      return json(200, view(f));
    }
    return json(400, { error: { message: `fake drive: unsupported ${method} ${path}` } });
  }) as typeof fetch;

  return {
    fetch: fakeFetch, files, requests,
    expireTokens: () => { epoch++; },
    tokenFor: (clientId) => `tok:${clientId}:${epoch}`,
    failNext: (status, count = 1) => { failures = { status, left: count }; },
    goOffline: (on) => { offline = on; },
    setClock: (c) => { clock = c; },
  };
}

/** Token provider backed by the fake: always returns a currently valid token for one client ID. */
export function fakeTokens(drive: FakeDrive, clientId: string, opts: { allowSilent?: boolean } = {}) {
  let signedIn = opts.allowSilent ?? true;
  const calls: { interactive: boolean }[] = [];
  return {
    calls,
    signOut: () => { signedIn = false; },
    async getToken(o?: { interactive?: boolean }) {
      calls.push({ interactive: !!o?.interactive });
      if (!signedIn) {
        if (!o?.interactive) { const { NeedsSignInError } = await import('../types'); throw new NeedsSignInError(); }
        signedIn = true;
      }
      return drive.tokenFor(clientId);
    },
    invalidate() { /* the fake always hands out the current epoch's token */ },
  };
}
