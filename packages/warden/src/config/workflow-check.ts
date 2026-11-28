import { parse } from 'yaml';

/** Actions hardening (PRD §3, confirmed by the owner on 2026-11-27). A deterministic, offline check of one workflow file, run on every Warden
 *  workflow template by the test suite; zizmor runs the fuller audit in CI. It finds:
 *  - `pr-head-checkout`: a `pull_request_target` or `workflow_run` workflow that checks out or fetches the pull request's code. Those triggers run
 *    with the base repository's token and secrets, so PR code must never run there (GitHub Security Lab, "Preventing pwn requests").
 *  - `script-injection`: a `${{ }}` expression carrying event text (`github.event.*`, `github.head_ref`, `inputs.*`) inside a `run:` script or an
 *    `actions/github-script` script. Event text must reach scripts through `env:` instead (GitHub, "Security hardening for GitHub Actions").
 *  - `unpinned-action`: a remote action not pinned to a full-length commit SHA (a tag or branch can be moved).
 *  - `persisted-credentials`: `actions/checkout` without `persist-credentials: false`, which leaves the token in `.git/config`. */
export type WorkflowRule = 'invalid' | 'pr-head-checkout' | 'script-injection' | 'unpinned-action' | 'persisted-credentials';
export interface WorkflowFinding { rule: WorkflowRule; job?: string; step?: number; message: string }

interface Step { name?: string; uses?: string; run?: unknown; with?: Record<string, unknown> }
const PRIVILEGED_TRIGGERS = ['pull_request_target', 'workflow_run'];
/** Contexts an outside contributor can write: anything in the event payload, the PR's branch name, and dispatch inputs. */
const UNTRUSTED_EXPR = /\b(github\.event\b|github\.head_ref\b|inputs\.)/;
/** References to the pull request's code, in a checkout `ref`/`repository` input or in a script that fetches it. */
const PR_CODE_REF = /(github\.event\.pull_request\.head|github\.head_ref|github\.event\.workflow_run\.head|refs\/pull\/|\bpull\/[^\s]*\/(head|merge)\b|gh\s+pr\s+checkout)/;
const FULL_SHA = /@[0-9a-f]{40}$/;

const triggersOf = (on: unknown): string[] => (typeof on === 'string' ? [on] : Array.isArray(on) ? on.map(String) : on && typeof on === 'object' ? Object.keys(on) : []);
const expressions = (s: string): string[] => [...s.matchAll(/\$\{\{([\s\S]*?)\}\}/g)].map((m) => m[1].trim());

export function checkWorkflow(text: string): WorkflowFinding[] {
  let d: { on?: unknown; jobs?: Record<string, { steps?: Step[] }> };
  try { d = parse(text, { uniqueKeys: true }) as typeof d; } catch (e) { return [{ rule: 'invalid', message: `not valid YAML: ${String((e as Error).message).split('\n')[0]}` }]; }
  if (!d || typeof d !== 'object' || !d.jobs || typeof d.jobs !== 'object') return [{ rule: 'invalid', message: 'no jobs' }];
  const out: WorkflowFinding[] = [];
  const privileged = triggersOf(d.on).filter((t) => PRIVILEGED_TRIGGERS.includes(t));
  for (const [job, j] of Object.entries(d.jobs)) {
    (j?.steps ?? []).forEach((s, step) => {
      const at = { job, step };
      const label = s.name ?? s.uses ?? 'run step';
      const uses = typeof s.uses === 'string' ? s.uses : '';
      const scripts: string[] = [];
      if (typeof s.run === 'string') scripts.push(s.run);
      const ghScript = s.with?.script;
      if (/^actions\/github-script@/.test(uses) && typeof ghScript === 'string') scripts.push(ghScript);
      for (const sc of scripts)
        for (const ex of expressions(sc)) if (UNTRUSTED_EXPR.test(ex)) out.push({ rule: 'script-injection', ...at, message: `${job} / ${label}: \${{ ${ex} }} puts event text into a script; pass it through env: and quote the variable` });
      if (uses && !uses.startsWith('./') && !(uses.startsWith('docker://') && /@sha256:[0-9a-f]{64}$/.test(uses)) && !FULL_SHA.test(uses))
        out.push({ rule: 'unpinned-action', ...at, message: `${job} / ${label}: ${uses} is not pinned to a full commit SHA` });
      const checkout = /^actions\/checkout@/.test(uses);
      if (checkout && s.with?.['persist-credentials'] !== false) out.push({ rule: 'persisted-credentials', ...at, message: `${job} / ${label}: set persist-credentials: false so the token is not left in .git/config` });
      if (privileged.length) {
        const refText = checkout ? JSON.stringify({ ref: s.with?.ref, repository: s.with?.repository }) : '';
        if ((checkout && PR_CODE_REF.test(refText)) || scripts.some((sc) => PR_CODE_REF.test(sc)))
          out.push({ rule: 'pr-head-checkout', ...at, message: `${job} / ${label}: ${privileged.join(', ')} runs with write credentials and secrets, so it must never check out or fetch the pull request's code` });
      }
    });
  }
  return out;
}
