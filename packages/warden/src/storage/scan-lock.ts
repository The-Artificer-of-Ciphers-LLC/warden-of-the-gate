import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';

/** PRD section 14 [R]: at most one scan per instance at a time, enforced by a local lock. The lock is a file created exclusively (`wx`), so two starts cannot both win; one left by a process that no
 *  longer exists (a crash, or a host that slept and was restarted) is reclaimed instead of blocking forever. */
export class ScanLocked extends Error {
  holder: { pid: number; task: string; since: string };
  constructor(holder: { pid: number; task: string; since: string }) { super(`another scan is already running (pid ${holder.pid}, task ${holder.task}, since ${holder.since})`); this.holder = holder; }
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

export function acquireScanLock(path: string, me: { pid: number; task: string; now: string }, isAlive: (pid: number) => boolean = alive): () => void {
  const mine = JSON.stringify({ pid: me.pid, task: me.task, since: me.now });
  for (let attempt = 0; attempt < 2; attempt++) {
    try { writeFileSync(path, mine, { flag: 'wx', mode: 0o600 }); return () => { try { if (readFileSync(path, 'utf8') === mine) unlinkSync(path); } catch { /* already gone */ } }; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      let holder: { pid: number; task: string; since: string } | null = null; try { holder = JSON.parse(readFileSync(path, 'utf8')); } catch { /* unreadable: treat as stale */ }
      if (holder && Number.isInteger(holder.pid) && holder.pid !== me.pid && isAlive(holder.pid)) throw new ScanLocked(holder);
      try { unlinkSync(path); } catch { /* someone else reclaimed it; the next attempt decides */ }   // stale or unreadable: reclaim and try once more
    }
  }
  throw new Error('could not take the scan lock');
}
