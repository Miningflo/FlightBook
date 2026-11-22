import type { DriveFile, TokenProvider } from './types';
import { DriveError, DriveUnreachableError } from './types';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FIELDS = 'id,name,createdTime,modifiedTime,size,appProperties';
export const FOLDER_MIME = 'application/vnd.google-apps.folder';

export interface DriveOptions {
  interactive?: boolean;
}

interface ClientDeps {
  tokens: TokenProvider;
  fetchFn?: typeof fetch;
  /** Injected so tests do not really wait. */
  sleep?: (ms: number) => Promise<void>;
}

/** Escape a value for a Drive `q` string literal. */
export const qs = (v: string): string => `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function toFile(r: Record<string, unknown>): DriveFile {
  return {
    id: String(r.id), name: String(r.name ?? ''), createdTime: String(r.createdTime ?? ''),
    modifiedTime: r.modifiedTime ? String(r.modifiedTime) : undefined, size: r.size !== undefined ? Number(r.size) : undefined,
    appProperties: (r.appProperties as Record<string, string> | undefined) ?? undefined,
  };
}

/**
 * READ-ONLY Drive access: only GET requests are ever made. The viewer is given one of these, so it has no
 * way to create, change or delete a file. (DriveWriter, below, adds the write operations for the master.)
 * Scope is drive.file: only files created by this app's OAuth client are visible, which is why one client ID
 * is shared by every hosting origin.
 */
export class DriveReader {
  protected readonly tokens: TokenProvider;
  protected readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: ClientDeps) {
    this.tokens = deps.tokens;
    this.fetchFn = deps.fetchFn ?? ((...a) => fetch(...a));
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** One authorised request with a retry on an expired token (once) and on rate limits / server errors (twice). */
  protected async request(method: string, url: string, body: BodyInit | undefined, headers: Record<string, string>, opts: DriveOptions): Promise<Response> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.tokens.getToken({ interactive: opts.interactive });
      let res: Response;
      try {
        res = await this.fetchFn(url, { method, body, headers: { ...headers, Authorization: `Bearer ${token}` } });
      } catch {
        throw new DriveUnreachableError();
      }
      if (res.ok) return res;
      if (res.status === 401 && !refreshed) { refreshed = true; this.tokens.invalidate(); continue; }
      if ((res.status === 429 || res.status >= 500) && attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
      let detail = '';
      try { detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* no body */ }
      if (res.status === 401) this.tokens.invalidate();
      throw new DriveError(`Google Drive said ${res.status}${detail ? `: ${detail}` : ''}`, res.status);
    }
  }

  /** The "Logbook backups" folder, or null. If several exist (should not happen) the oldest is used. */
  async findFolder(name: string, opts: DriveOptions = {}): Promise<string | null> {
    const q = `mimeType = '${FOLDER_MIME}' and name = ${qs(name)} and trashed = false`;
    const res = await this.request('GET', `${API}/files?${new URLSearchParams({ q, fields: `files(${FIELDS})`, orderBy: 'createdTime', pageSize: '10' })}`, undefined, {}, opts);
    const files = ((await res.json()) as { files?: Record<string, unknown>[] }).files ?? [];
    return files[0] ? String(files[0].id) : null;
  }

  /** Every file in the folder, across pages, newest first by creation time. */
  async listFolder(folderId: string, opts: DriveOptions = {}): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({ q: `${qs(folderId)} in parents and trashed = false`, fields: `nextPageToken,files(${FIELDS})`, orderBy: 'createdTime desc', pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const json = (await (await this.request('GET', `${API}/files?${params}`, undefined, {}, opts)).json()) as { files?: Record<string, unknown>[]; nextPageToken?: string };
      out.push(...(json.files ?? []).map(toFile));
      pageToken = json.nextPageToken;
    } while (pageToken);
    return out;
  }

  async downloadText(fileId: string, opts: DriveOptions = {}): Promise<string> {
    return (await this.request('GET', `${API}/files/${encodeURIComponent(fileId)}?alt=media`, undefined, {}, opts)).text();
  }
}

function multipart(metadata: object, json: string): { body: string; contentType: string } {
  const boundary = `fb${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/json\r\n\r\n${json}\r\n--${boundary}--`;
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

/** Read AND write access, for the master device only. */
export class DriveWriter extends DriveReader {
  async createFolder(name: string, opts: DriveOptions = {}): Promise<string> {
    const res = await this.request('POST', `${API}/files?fields=id`, JSON.stringify({ name, mimeType: FOLDER_MIME }), { 'Content-Type': 'application/json' }, opts);
    return String(((await res.json()) as { id: string }).id);
  }

  async createJson(args: { folderId: string; name: string; json: string; appProperties?: Record<string, string> }, opts: DriveOptions = {}): Promise<DriveFile> {
    const { body, contentType } = multipart({ name: args.name, parents: [args.folderId], mimeType: 'application/json', appProperties: args.appProperties }, args.json);
    const res = await this.request('POST', `${UPLOAD}/files?uploadType=multipart&fields=${FIELDS}`, body, { 'Content-Type': contentType }, opts);
    return toFile((await res.json()) as Record<string, unknown>);
  }

  async updateJson(fileId: string, json: string, appProperties?: Record<string, string>, opts: DriveOptions = {}): Promise<DriveFile> {
    const { body, contentType } = multipart({ appProperties }, json);
    const res = await this.request('PATCH', `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=multipart&fields=${FIELDS}`, body, { 'Content-Type': contentType }, opts);
    return toFile((await res.json()) as Record<string, unknown>);
  }

  async deleteFile(fileId: string, opts: DriveOptions = {}): Promise<void> {
    await this.request('DELETE', `${API}/files/${encodeURIComponent(fileId)}`, undefined, {}, opts);
  }
}
