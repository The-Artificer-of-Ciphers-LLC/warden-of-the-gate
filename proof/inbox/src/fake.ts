import type { Comment, IssueEvent, IssueState, Label, Store } from './store.ts';
import { Faults, NetworkError, iso, jitter, sleep } from './util.ts';

/** Shared in-memory "GitHub". Models: monotonic comment ids, edit timestamps, atomic unique milestone create,
 *  labeled/unlabeled events with actors, and randomized latency so concurrent callers really interleave. */
export class FakeWorld {
  nextId = 1000; nextEvent = 1;
  comments = new Map<number, { issue: number; c: Comment }>();
  labels = new Map<string, Label>();
  /** Negative-control knob: emulate a NON-atomic create-if-absent (check, yield, insert) like GitHub milestones. */
  nonAtomicCreate = false;
  issues = new Map<number, IssueState & { events: IssueEvent[] }>();
  maxLatency = 4;
  view(actor: string, faults = new Faults()): FakeStore { return new FakeStore(this, actor, faults); }
}

export class FakeStore implements Store {
  readonly name = 'fake';
  private w: FakeWorld; actor: string; faults: Faults;
  constructor(w: FakeWorld, actor: string, faults: Faults) { this.w = w; this.actor = actor; this.faults = faults; }
  now() { return Date.now(); }
  private async lat() { if (this.w.maxLatency) await sleep(jitter(this.w.maxLatency)); }
  private async maybeLost(op: string) { if (this.faults.take('reply-lost:' + op)) throw new NetworkError('reply lost after ' + op); }

  async listComments(issue: number) {
    await this.lat();
    return [...this.w.comments.values()].filter((x) => x.issue === issue).map((x) => ({ ...x.c }))
      .sort((a, b) => a.id - b.id);
  }
  async createComment(issue: number, body: string) {
    await this.lat();
    const id = this.w.nextId++; const t = iso(Date.now());
    const c: Comment = { id, body, author: this.actor, createdAt: t, updatedAt: t };
    this.w.comments.set(id, { issue, c });
    await this.maybeLost('createComment');
    return { ...c };
  }
  async getComment(id: number) { await this.lat(); const x = this.w.comments.get(id); if (!x) throw new Error('404 comment ' + id); return { ...x.c }; }
  async updateComment(id: number, body: string) {
    await this.lat(); const x = this.w.comments.get(id); if (!x) throw new Error('404 comment ' + id);
    x.c = { ...x.c, body, updatedAt: iso(Date.now() + 1) };
    await this.maybeLost('updateComment');
    return { ...x.c };
  }
  async deleteComment(id: number) { await this.lat(); this.w.comments.delete(id); }
  private issue(n: number) { let i = this.w.issues.get(n); if (!i) { i = { number: n, assignees: [], labels: [], state: 'open', events: [] }; this.w.issues.set(n, i); } return i; }
  async getIssue(n: number) { await this.lat(); const i = this.issue(n); return { number: n, assignees: [...i.assignees], labels: [...i.labels], state: i.state }; }
  async addAssignee(n: number, login: string) { await this.lat(); const i = this.issue(n); if (!i.assignees.includes(login)) i.assignees.push(login); await this.maybeLost('addAssignee'); }
  async addLabel(n: number, label: string) {
    await this.lat(); const i = this.issue(n);
    if (!i.labels.includes(label)) { i.labels.push(label); i.events.push({ id: this.w.nextEvent++, event: 'labeled', actor: this.actor, label, createdAt: iso(Date.now()) }); }
    await this.maybeLost('addLabel');
  }
  async removeLabel(n: number, label: string) {
    await this.lat(); const i = this.issue(n);
    if (i.labels.includes(label)) { i.labels = i.labels.filter((l) => l !== label); i.events.push({ id: this.w.nextEvent++, event: 'unlabeled', actor: this.actor, label, createdAt: iso(Date.now()) }); }
  }
  async listEvents(n: number) { await this.lat(); return [...this.issue(n).events]; }
  async listLabels() { await this.lat(); return [...this.w.labels.values()].map((l) => ({ ...l })); }
  async createLabel(name: string, description: string) {
    await this.lat();
    if (this.w.labels.has(name) && !this.w.nonAtomicCreate) return 'exists' as const;
    if (this.w.nonAtomicCreate) { const had = this.w.labels.has(name); await sleep(2 + jitter(4)); if (had) return 'exists' as const; } // check-then-insert with a gap: parallel creators all pass
    const l: Label = { name, description }; this.w.labels.set(name, l);
    await this.maybeLost('createLabel');
    return { ...l };
  }
  async updateLabel(name: string, description: string) { await this.lat(); const l = this.w.labels.get(name); if (!l) throw new Error('404 label'); l.description = description; return { ...l }; }
  async deleteLabel(name: string) { await this.lat(); this.w.labels.delete(name); }
  async createIssue(_t: string, _b: string) { const n = 100 + this.w.issues.size + 1; this.issue(n); return n; }
  async closeIssue(n: number) { await this.lat(); this.issue(n).state = 'closed'; }
}
