/** Minimal GitHub-shaped surface the proof needs. Implemented by FakeStore (offline) and GithubStore (live sandbox). */
export interface Comment { id: number; body: string; author: string; createdAt: string; updatedAt: string }
export interface Label { name: string; description: string }
export interface IssueState { number: number; assignees: string[]; labels: string[]; state: 'open' | 'closed' }
export interface IssueEvent { id: number; event: string; actor: string; label?: string; createdAt: string }

export interface Store {
  readonly name: string;
  /** Server-corrected wall clock (ms). Lease expiry never trusts the local clock alone. */
  now(): number;
  listComments(issue: number): Promise<Comment[]>; // ascending id
  createComment(issue: number, body: string): Promise<Comment>;
  getComment(id: number): Promise<Comment>;
  updateComment(id: number, body: string): Promise<Comment>;
  deleteComment(id: number): Promise<void>;
  getIssue(n: number): Promise<IssueState>;
  addAssignee(n: number, login: string): Promise<void>;
  addLabel(n: number, label: string): Promise<void>;
  removeLabel(n: number, label: string): Promise<void>;
  listEvents(n: number): Promise<IssueEvent[]>;
  listLabels(): Promise<Label[]>;
  /** Atomic create-if-absent by name. Returns 'exists' (HTTP 422 already_exists) when taken. VERIFIED atomic on GitHub; milestones are NOT. */
  createLabel(name: string, description: string): Promise<Label | 'exists'>;
  updateLabel(name: string, description: string): Promise<Label>;
  deleteLabel(name: string): Promise<void>;
  createIssue(title: string, body: string): Promise<number>;
  closeIssue(n: number): Promise<void>;
}
