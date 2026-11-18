import type { Comment, IssueEvent, IssueState, Label, Store } from './store.ts';
import { NetworkError, sleep } from '../util.ts';
import type { CredentialProvider, CredentialRequest } from '../credentials/types.ts';

/** Real GitHub REST store. Every request obtains a short-lived token from the CredentialProvider; there is no env/PAT fallback.
 *  CredentialUnavailable suspends the authenticated operation. Exercised by the sandbox App proof; full P1 live acceptance remains gated. */
export class HttpStore implements Store {
  readonly name = 'github';
  skew = 0; private who: string; private repo: string; private creds: CredentialProvider; private credReq: CredentialRequest; private apiBase: string;
  constructor(repo: string, creds: CredentialProvider, credReq: CredentialRequest, actor: string, apiBase = 'https://api.github.com') { this.who = actor; this.repo = repo; this.creds = creds; this.credReq = credReq; this.apiBase = apiBase; }
  now() { return Date.now() + this.skew; }
  actor() { return this.who; }
  private async req(method: string, path: string, body?: unknown, o: { okStatuses?: number[]; query?: string } = {}): Promise<{ status: number; json: any }> {
    const url = `${this.apiBase}/repos/${this.repo}${path}${o.query ? '?' + o.query : ''}`;
    for (let attempt = 0; ; attempt++) {
      const token = await this.creds.token(this.credReq);
      let res: Response;
      try { res = await fetch(url, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'warden-core' }, body: body === undefined ? undefined : JSON.stringify(body) }); }
      catch (e) { if (method === 'GET' && attempt < 3) { await sleep(300 * (attempt + 1)); continue; } throw new NetworkError(String(e)); }
      const d = res.headers.get('date'); if (d) this.skew = Date.parse(d) - Date.now();
      const limited = (res.status === 403 || res.status === 429) && (res.headers.get('retry-after') || res.headers.get('x-ratelimit-remaining') === '0' || /secondary rate/i.test(await res.clone().text()));
      if (res.status === 401) this.creds.reportUnauthorized?.(this.credReq);
      if (limited) { if (attempt >= 6) throw new Error('rate limited persistently'); await sleep((Number(res.headers.get('retry-after')) || Math.min(60, 5 * (attempt + 1))) * 1000); continue; }
      if (res.status >= 500 && method === 'GET' && attempt < 3) { await sleep(500 * (attempt + 1)); continue; }
      const text = await res.text(); let json: any = null; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
      if (!(res.status < 300 || (o.okStatuses ?? []).includes(res.status))) { const err: Error & { status?: number; json?: unknown } = new Error(`${method} ${path} -> ${res.status}`); err.status = res.status; err.json = json; throw err; }
      return { status: res.status, json };
    }
  }
  private async paged(path: string, query = ''): Promise<any[]> {
    const out: any[] = [];
    for (let page = 1; page < 50; page++) { const r = await this.req('GET', path, undefined, { query: `per_page=100&page=${page}${query ? '&' + query : ''}` }); out.push(...r.json); if (r.json.length < 100) break; }
    return out;
  }
  private cm = (c: any): Comment => ({ id: c.id, body: c.body, author: c.user?.login ?? 'unknown', createdAt: c.created_at, updatedAt: c.updated_at });
  private is = (j: any): IssueState => ({ number: j.number, assignees: (j.assignees ?? []).map((a: any) => a.login), labels: (j.labels ?? []).map((l: any) => (typeof l === 'string' ? l : l.name)), state: j.state, title: j.title, body: j.body ?? '', author: j.user?.login ?? 'unknown', isPr: !!j.pull_request, draft: j.draft, head: j.head?.sha, createdAt: j.created_at, updatedAt: j.updated_at });
  async listComments(issue: number) { return (await this.paged(`/issues/${issue}/comments`)).map(this.cm).sort((a, b) => a.id - b.id); }
  async createComment(issue: number, body: string) { return this.cm((await this.req('POST', `/issues/${issue}/comments`, { body })).json); }
  async getComment(id: number) { return this.cm((await this.req('GET', `/issues/comments/${id}`)).json); }
  async updateComment(id: number, body: string) { return this.cm((await this.req('PATCH', `/issues/comments/${id}`, { body })).json); }
  async deleteComment(id: number) { await this.req('DELETE', `/issues/comments/${id}`); }
  async getIssue(n: number) { return this.is((await this.req('GET', `/issues/${n}`)).json); }
  async listIssues(o: { state?: 'open' | 'closed' | 'all' } = {}) { return (await this.paged('/issues', `state=${o.state ?? 'open'}`)).map(this.is); }
  async addAssignee(n: number, login: string) { await this.req('POST', `/issues/${n}/assignees`, { assignees: [login] }); }
  async removeAssignee(n: number, login: string) { await this.req('DELETE', `/issues/${n}/assignees`, { assignees: [login] }); }
  async addLabel(n: number, label: string) { await this.req('POST', `/issues/${n}/labels`, { labels: [label] }); }
  async removeLabel(n: number, label: string) { await this.req('DELETE', `/issues/${n}/labels/${encodeURIComponent(label)}`, undefined, { okStatuses: [404] }); }
  async listEvents(n: number): Promise<IssueEvent[]> { return (await this.paged(`/issues/${n}/events`)).map((e) => ({ id: e.id, event: e.event, actor: e.actor?.login ?? 'unknown', label: e.label?.name, createdAt: e.created_at })); }
  async listLabels(): Promise<Label[]> { return (await this.paged('/labels')).map((l) => ({ name: l.name, description: l.description ?? '' })); }
  async createLabel(name: string, description: string, color = 'ededed') {
    try { const r = await this.req('POST', '/labels', { name, description, color }); return { name: r.json.name, description: r.json.description ?? '' }; }
    catch (e) { const x = e as { status?: number; json?: unknown }; if (x.status === 422 && /already_exists/.test(JSON.stringify(x.json))) return 'exists' as const; throw e; }
  }
  async updateLabel(name: string, description: string) { const r = await this.req('PATCH', `/labels/${encodeURIComponent(name)}`, { description }); return { name: r.json.name, description: r.json.description ?? '' }; }
  async deleteLabel(name: string) { await this.req('DELETE', `/labels/${encodeURIComponent(name)}`, undefined, { okStatuses: [404] }); }
  async createIssue(title: string, body: string) { return (await this.req('POST', '/issues', { title, body })).json.number; }
  async closeIssue(n: number) { await this.req('PATCH', `/issues/${n}`, { state: 'closed' }); }
}
