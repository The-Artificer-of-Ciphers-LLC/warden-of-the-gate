/** Minimal GitHub-shaped surface. Implemented by FakeStore (offline / sim backend) and HttpStore (real, credential-provider backed). */
export interface Comment { id: number; body: string; author: string; createdAt: string; updatedAt: string }
export interface Label { name: string; description: string }
export interface IssueState { number: number; assignees: string[]; labels: string[]; state: 'open' | 'closed'; title: string; body: string; author: string; isPr: boolean; draft?: boolean; head?: string; createdAt: string; updatedAt: string }
export interface IssueEvent { id: number; event: string; actor: string; label?: string; createdAt: string }

/** Read-only pull request snapshot input. `head` is the commit the review is bound to; `ci` is a coarse summary of checks on that head. */
export interface PullFile { path: string; status: string; patch?: string }
export interface PullInfo { number: number; head: string; base: string; title: string; author: string; draft: boolean; state: 'open' | 'closed'; ci: 'passing' | 'failing' | 'pending' | 'none'; files: PullFile[] }

export interface Store {
  readonly name: string;
  /** Server-corrected wall clock (ms). Lease expiry never trusts the local clock alone. */
  now(): number;
  /** Identity this store acts as (best known; used for authorship checks). */
  actor(): string;
  listComments(issue: number): Promise<Comment[]>;
  createComment(issue: number, body: string): Promise<Comment>;
  getComment(id: number): Promise<Comment>;
  updateComment(id: number, body: string): Promise<Comment>;
  deleteComment(id: number): Promise<void>;
  getIssue(n: number): Promise<IssueState>;
  /** Read-only. Throws a 404-shaped error when the item is not a pull request. */
  getPull(n: number): Promise<PullInfo>;
  listIssues(opts?: { state?: 'open' | 'closed' | 'all' }): Promise<IssueState[]>;
  addAssignee(n: number, login: string): Promise<void>;
  removeAssignee(n: number, login: string): Promise<void>;
  addLabel(n: number, label: string): Promise<void>;
  removeLabel(n: number, label: string): Promise<void>;
  listEvents(n: number): Promise<IssueEvent[]>;
  listLabels(): Promise<Label[]>;
  /** Atomic create-if-absent by label name. VERIFIED atomic on GitHub (P0); milestone titles are NOT. */
  createLabel(name: string, description: string, color?: string): Promise<Label | 'exists'>;
  updateLabel(name: string, description: string): Promise<Label>;
  deleteLabel(name: string): Promise<void>;
  createIssue(title: string, body: string): Promise<number>;
  closeIssue(n: number): Promise<void>;
}

/** Write methods of Store; used by ReadOnlyStore and tests. */
export const WRITE_METHODS = ['createComment', 'updateComment', 'deleteComment', 'addAssignee', 'removeAssignee', 'addLabel', 'removeLabel', 'createLabel', 'updateLabel', 'deleteLabel', 'createIssue', 'closeIssue'] as const;

export class ReadOnlyViolation extends Error { constructor(m: string) { super('READ-ONLY STORE: refused ' + m); } }
/** Dry-run guard: every mutation throws. Wraps any Store, so "no repository mutation" is enforced, not promised. */
export function readOnly(inner: Store): Store {
  return new Proxy(inner, {
    get(t, p, r) {
      if ((WRITE_METHODS as readonly string[]).includes(String(p))) return () => { throw new ReadOnlyViolation(String(p)); };
      const v = Reflect.get(t, p, r); return typeof v === 'function' ? v.bind(t) : v;
    },
  }) as Store;
}

/** Counts content-creating calls so a drain can respect GitHub's secondary content-creation limits (P0 finding). */
export class CountingStore {
  creates = 0; calls = 0;
}
export function counting(inner: Store, counter: CountingStore): Store {
  const creators = new Set(['createComment', 'createIssue', 'createLabel']);
  return new Proxy(inner, {
    get(t, p, r) {
      const v = Reflect.get(t, p, r);
      if (typeof v !== 'function') return v;
      return (...a: unknown[]) => { counter.calls++; if (creators.has(String(p))) counter.creates++; return (v as (...x: unknown[]) => unknown).apply(t, a); };
    },
  }) as Store;
}
