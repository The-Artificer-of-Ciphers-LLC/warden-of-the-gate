import type { Comment, IssueEvent, IssueState, Label, Store } from './store.ts';
import { Faults, NetworkError, iso, jitter, sleep } from '../util.ts';

interface FakeIssue extends IssueState { events: IssueEvent[] }
export interface WorldSnapshot { nextId: number; nextEvent: number; nextIssue: number; comments: { issue: number; c: Comment }[]; labels: Label[]; issues: FakeIssue[]; clock?: number }

/** Shared in-memory "GitHub": monotonic comment ids, edit timestamps, atomic unique label create, labeled/unlabeled events with
 *  actors, randomized latency so concurrent callers really interleave. Serializable for the file-backed sim backend. */
export class FakeWorld {
  nextId = 1000; nextEvent = 1; nextIssue = 1;
  comments = new Map<number, { issue: number; c: Comment }>();
  labels = new Map<string, Label>();
  issues = new Map<number, FakeIssue>();
  nonAtomicCreate = false;
  maxLatency = 0;
  /** Optional controllable clock for deterministic expiry tests. */
  clock: number | null = null;
  /** Test knob: make every call fail (outage). */
  down = false;
  view(actor: string, faults = new Faults()): FakeStore { return new FakeStore(this, actor, faults); }
  now() { return this.clock ?? Date.now(); }
  addIssue(o: Partial<IssueState> & { title?: string } = {}): number {
    const n = this.nextIssue++; const t = iso(this.now());
    this.issues.set(n, { number: n, assignees: [], labels: [], state: 'open', title: o.title ?? `issue ${n}`, body: o.body ?? '', author: o.author ?? 'contributor1', isPr: o.isPr ?? false, draft: o.draft, head: o.head, createdAt: t, updatedAt: t, events: [], ...(o as object) } as FakeIssue);
    return n;
  }
  snapshot(): WorldSnapshot { return { nextId: this.nextId, nextEvent: this.nextEvent, nextIssue: this.nextIssue, comments: [...this.comments.values()], labels: [...this.labels.values()], issues: [...this.issues.values()], clock: this.clock ?? undefined }; }
  static restore(s: WorldSnapshot): FakeWorld {
    const w = new FakeWorld(); w.nextId = s.nextId; w.nextEvent = s.nextEvent; w.nextIssue = s.nextIssue; w.clock = s.clock ?? null;
    for (const x of s.comments) w.comments.set(x.c.id, x); for (const l of s.labels) w.labels.set(l.name, l); for (const i of s.issues) w.issues.set(i.number, i);
    return w;
  }
}

export class FakeStore implements Store {
  readonly name = 'fake';
  private w: FakeWorld; who: string; faults: Faults;
  onWrite?: () => void;
  constructor(w: FakeWorld, actor: string, faults: Faults) { this.w = w; this.who = actor; this.faults = faults; }
  now() { return this.w.now(); }
  actor() { return this.who; }
  private async lat() { if (this.w.down) throw new NetworkError('simulated outage'); if (this.w.maxLatency) await sleep(jitter(this.w.maxLatency)); }
  private async maybeLost(op: string) { if (this.faults.take('reply-lost:' + op)) throw new NetworkError('reply lost after ' + op); }
  private touch() { this.onWrite?.(); }

  async listComments(issue: number) { await this.lat(); return [...this.w.comments.values()].filter((x) => x.issue === issue).map((x) => ({ ...x.c })).sort((a, b) => a.id - b.id); }
  async createComment(issue: number, body: string) {
    await this.lat(); const id = this.w.nextId++; const t = iso(this.w.now());
    const c: Comment = { id, body, author: this.who, createdAt: t, updatedAt: t };
    this.w.comments.set(id, { issue, c }); this.touch(); await this.maybeLost('createComment'); return { ...c };
  }
  async getComment(id: number) { await this.lat(); const x = this.w.comments.get(id); if (!x) throw new Error('404 comment ' + id); return { ...x.c }; }
  async updateComment(id: number, body: string) {
    await this.lat(); const x = this.w.comments.get(id); if (!x) throw new Error('404 comment ' + id);
    x.c = { ...x.c, body, updatedAt: iso(this.w.now() + 1) }; this.touch(); await this.maybeLost('updateComment'); return { ...x.c };
  }
  async deleteComment(id: number) { await this.lat(); this.w.comments.delete(id); this.touch(); }
  private issue(n: number): FakeIssue { const i = this.w.issues.get(n); if (!i) { const e: Error & { status?: number } = new Error('404 issue ' + n); e.status = 404; throw e; } return i; }
  private view(i: FakeIssue): IssueState { const { events: _e, ...s } = i; return { ...s, assignees: [...i.assignees], labels: [...i.labels] }; }
  async getIssue(n: number) { await this.lat(); return this.view(this.issue(n)); }
  async listIssues(o: { state?: 'open' | 'closed' | 'all' } = {}) { await this.lat(); return [...this.w.issues.values()].filter((i) => !o.state || o.state === 'all' || i.state === o.state).map((i) => this.view(i)); }
  async addAssignee(n: number, login: string) { await this.lat(); const i = this.issue(n); if (!i.assignees.includes(login)) i.assignees.push(login); this.touch(); await this.maybeLost('addAssignee'); }
  async addLabel(n: number, label: string) {
    await this.lat(); const i = this.issue(n);
    if (!i.labels.includes(label)) { i.labels.push(label); i.events.push({ id: this.w.nextEvent++, event: 'labeled', actor: this.who, label, createdAt: iso(this.w.now()) }); }
    this.touch(); await this.maybeLost('addLabel');
  }
  async removeLabel(n: number, label: string) {
    await this.lat(); const i = this.issue(n);
    if (i.labels.includes(label)) { i.labels = i.labels.filter((l) => l !== label); i.events.push({ id: this.w.nextEvent++, event: 'unlabeled', actor: this.who, label, createdAt: iso(this.w.now()) }); }
    this.touch();
  }
  async listEvents(n: number) { await this.lat(); return [...this.issue(n).events]; }
  async listLabels() { await this.lat(); return [...this.w.labels.values()].map((l) => ({ ...l })); }
  async createLabel(name: string, description: string) {
    await this.lat();
    if (this.w.labels.has(name) && !this.w.nonAtomicCreate) return 'exists' as const;
    if (this.w.nonAtomicCreate) { const had = this.w.labels.has(name); await sleep(2 + jitter(4)); if (had) return 'exists' as const; }
    const l: Label = { name, description }; this.w.labels.set(name, l); this.touch(); await this.maybeLost('createLabel'); return { ...l };
  }
  async updateLabel(name: string, description: string) { await this.lat(); const l = this.w.labels.get(name); if (!l) throw new Error('404 label'); l.description = description; this.touch(); return { ...l }; }
  async deleteLabel(name: string) { await this.lat(); this.w.labels.delete(name); this.touch(); }
  async createIssue(title: string, body: string) { await this.lat(); const n = this.w.addIssue({ title, body, author: this.who }); this.touch(); return n; }
  async removeAssignee(n: number, login: string) { await this.lat(); const i = this.issue(n); i.assignees = i.assignees.filter((a) => a !== login); this.touch(); await this.maybeLost('removeAssignee'); }
  async closeIssue(n: number) { await this.lat(); this.issue(n).state = 'closed'; this.touch(); }
}
