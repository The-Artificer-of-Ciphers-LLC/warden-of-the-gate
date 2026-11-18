import { execFileSync } from 'node:child_process';
import type { Comment, IssueEvent, IssueState, Label, Store } from './store.ts';
import { Faults, NetworkError, sleep } from './util.ts';

export const SANDBOX = 'The-Artificer-of-Ciphers-LLC/warden-p0-sandbox';

export function resolveToken(): { token: string; source: string } {
  if (process.env.GITHUB_TOKEN) return { token: process.env.GITHUB_TOKEN, source: 'env:GITHUB_TOKEN' };
  return { token: execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim(), source: 'gh auth token' };
}

export interface ApiStats { calls: number; retries: number; rateLimited: number }

/** Live store. HARD GUARD: refuses any repository other than the disposable sandbox. */
export class GithubStore implements Store {
  readonly name = 'github';
  skew = 0; // serverTime - localTime (ms), from HTTP Date header
  stats: ApiStats = { calls: 0, retries: 0, rateLimited: 0 };
  private token: string; tokenSource: string; repo: string; faults: Faults;
  constructor(repo: string = process.env.WARDEN_P0_REPO ?? SANDBOX, faults: Faults = new Faults()) {
    this.repo = repo; this.faults = faults;
    if (repo !== SANDBOX) throw new Error(`refusing to operate on ${repo}: P0 proof is restricted to ${SANDBOX}`);
    const t = resolveToken(); this.token = t.token; this.tokenSource = t.source;
  }
  now() { return Date.now() + this.skew; }

  async req(method: string, path: string, body?: unknown, opts: { okStatuses?: number[]; query?: string; headers?: Record<string, string> } = {}): Promise<{ status: number; json: any; headers: Headers }> {
    const url = `https://api.github.com/repos/${this.repo}${path}${opts.query ? '?' + opts.query : ''}`;
    for (let attempt = 0; ; attempt++) {
      this.stats.calls++;
      let res: Response;
      try {
        res = await fetch(url, { method, headers: { authorization: `Bearer ${this.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'warden-p0-proof', ...(opts.headers ?? {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        if (method === 'GET' && attempt < 3) { this.stats.retries++; await sleep(300 * (attempt + 1)); continue; }
        throw new NetworkError(String(e));
      }
      const d = res.headers.get('date'); if (d) this.skew = Date.parse(d) - Date.now();
      if ((res.status === 403 || res.status === 429) && (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0' || /secondary rate/i.test(await res.clone().text()))) {
        this.stats.rateLimited++; this.stats.retries++;
        const ra = Number(res.headers.get('retry-after')) || Math.min(60, 5 * (attempt + 1));
        if (attempt >= 6) throw new Error('rate limited persistently');
        await sleep(ra * 1000); continue;
      }
      if (res.status >= 500 && attempt < 3 && method === 'GET') { this.stats.retries++; await sleep(500 * (attempt + 1)); continue; }
      const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      const ok = res.status < 300 || (opts.okStatuses ?? []).includes(res.status);
      if (!ok) { const err: any = new Error(`${method} ${path} -> ${res.status} ${typeof json === 'string' ? json : JSON.stringify(json)?.slice(0, 300)}`); err.status = res.status; err.json = json; throw err; }
      return { status: res.status, json, headers: res.headers };
    }
  }
  async paged(path: string, query = ''): Promise<any[]> {
    const out: any[] = [];
    for (let page = 1; page < 50; page++) {
      const r = await this.req('GET', path, undefined, { query: `per_page=100&page=${page}${query ? '&' + query : ''}` });
      out.push(...r.json); if (r.json.length < 100) break;
    }
    return out;
  }
  private lostCheck(op: string) { if (this.faults.take('reply-lost:' + op)) throw new NetworkError('reply lost after ' + op); }
  private toComment(c: any): Comment { return { id: c.id, body: c.body, author: c.user?.login ?? 'unknown', createdAt: c.created_at, updatedAt: c.updated_at }; }
  private toLabel(l: any): Label { return { name: l.name, description: l.description ?? '' }; }

  async listComments(issue: number) { return (await this.paged(`/issues/${issue}/comments`)).map((c) => this.toComment(c)).sort((a, b) => a.id - b.id); }
  async createComment(issue: number, body: string) { const r = await this.req('POST', `/issues/${issue}/comments`, { body }); this.lostCheck('createComment'); return this.toComment(r.json); }
  async getComment(id: number) { return this.toComment((await this.req('GET', `/issues/comments/${id}`)).json); }
  async updateComment(id: number, body: string) { const r = await this.req('PATCH', `/issues/comments/${id}`, { body }); this.lostCheck('updateComment'); return this.toComment(r.json); }
  async deleteComment(id: number) { await this.req('DELETE', `/issues/comments/${id}`); }
  async getIssue(n: number): Promise<IssueState> { const j = (await this.req('GET', `/issues/${n}`)).json; return { number: n, assignees: j.assignees.map((a: any) => a.login), labels: j.labels.map((l: any) => l.name), state: j.state }; }
  async addAssignee(n: number, login: string) { await this.req('POST', `/issues/${n}/assignees`, { assignees: [login] }); this.lostCheck('addAssignee'); }
  async addLabel(n: number, label: string) { await this.req('POST', `/issues/${n}/labels`, { labels: [label] }); this.lostCheck('addLabel'); }
  async removeLabel(n: number, label: string) { await this.req('DELETE', `/issues/${n}/labels/${encodeURIComponent(label)}`, undefined, { okStatuses: [404] }); }
  async listEvents(n: number): Promise<IssueEvent[]> {
    return (await this.paged(`/issues/${n}/events`)).map((e) => ({ id: e.id, event: e.event, actor: e.actor?.login ?? 'unknown', label: e.label?.name, createdAt: e.created_at }));
  }
  async listLabels() { return (await this.paged('/labels')).map((l) => this.toLabel(l)); }
  async createLabel(name: string, description: string) {
    try { const r = await this.req('POST', '/labels', { name, description, color: 'ededed' }); this.lostCheck('createLabel'); return this.toLabel(r.json); }
    catch (e: any) { if (e.status === 422 && /already_exists/.test(JSON.stringify(e.json))) return 'exists' as const; throw e; }
  }
  async updateLabel(name: string, description: string) { return this.toLabel((await this.req('PATCH', `/labels/${encodeURIComponent(name)}`, { description })).json); }
  async deleteLabel(name: string) { await this.req('DELETE', `/labels/${encodeURIComponent(name)}`, undefined, { okStatuses: [404] }); }
  async createIssue(title: string, body: string) { return (await this.req('POST', '/issues', { title, body })).json.number; }
  async closeIssue(n: number) { await this.req('PATCH', `/issues/${n}`, { state: 'closed' }); }
}
