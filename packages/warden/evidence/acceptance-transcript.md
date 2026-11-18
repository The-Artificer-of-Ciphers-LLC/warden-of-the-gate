# P1 acceptance transcript

warden 0.1.0-p1, node v26.13.0, backend: **simulated GitHub** (`sim:`), generated 2026-11-18T18:39:50.893Z.
This is NOT a live GitHub result. Separate production CLI/App/Actions acceptance evidence and remaining trust-root/scheduled-execution gates are linked from the README.

## Disposable simulated world (inbox #1, control #2)

```
$ warden sim init
sim world <tmp>/world.json: inbox #1, control #2
[exit 0]
```

## setup: report only (nothing approved)

```
$ warden setup
ok      node: node 26.13.0 (needs >=22.18)
ok      platform: darwin: the MVP supports a prepared Mac only
ok      isolation: Seatbelt (sandbox-exec) available (P0 selected backend; deprecated CLI, no memory cap)
MISSING .github/warden.yml: not present; re-run with --create-config --repo <owner/name> --maintainers <a,b> to create the starter
MISSING .github/ORDERS.yaml: not present; re-run with --create-orders to create the starter

setup adopted no backlog and activated no live AI. Backlog adoption is a separate explicit step.
[exit 1]
```

## setup: approved starters, ceiling, labels

```
$ warden setup --create-config --repo acme/widgets --maintainers maint1,maint2 --create-orders --approve-ceiling --create-labels
ok      node: node 26.13.0 (needs >=22.18)
ok      platform: darwin: the MVP supports a prepared Mac only
ok      isolation: Seatbelt (sandbox-exec) available (P0 selected backend; deprecated CLI, no memory cap)
CREATED .github/warden.yml: starter written (review and commit it yourself)
CREATED .github/ORDERS.yaml: starter written (review and commit it yourself)
ok      config: warden.yml valid
ok      orders: ORDERS.yaml valid
ok      local-state: protected instance directory <tmp>/home/instances/acme-widgets-d782c874 (0700; files 0600)
CREATED authority-ceiling: operator-approved ceiling written: issues:write, metadata:read on this repository only
warn    credentials: simulated backend (no real credentials involved)
ok      inbox issue: #1 exists
ok      control issue: #2 exists
CREATED labels: created 16 labels

setup adopted no backlog and activated no live AI. Backlog adoption is a separate explicit step.
[exit 0]
```

## config validate

```
$ warden config validate
warning [inbox.global-control] no global control location configured: global stop is not available to this instance (instance stop only)

config valid (warden.yml schema v1, ORDERS.yaml schema v1); 1 warning(s)
[exit 0]
```

## seed a bug issue, a feature issue and a PR

```
$ warden sim issue --title Crash on save --body Steps to reproduce: open, save.
created #3
[exit 0]
```

## seed PR

```
$ warden sim issue --title Fix save crash --pr --as dev1
created #4
[exit 0]
```

## run --task intake --dry-run (no mutation)

```
$ warden run --task intake --dry-run
task intake (dry-run): 2 proposed transition(s), repository mutations: 0
  #3 issue: (new) -> needs-triage - metadata present; queue semantic triage
  #4 pr: (new) -> needs-review - new PR enters review queue
mutation protection: read-only store enforced; global dry-run control: absent; backend sim
[exit 0]
```

## run --task review --dry-run (explicitly unsupported)

```
$ warden run --task review --dry-run
task review: UNSUPPORTED: task "review" is not implemented yet (owned by P3); no result was fabricated
[exit 3]
```

## approvals request (merge, bound to revision/policy/evidence)

```
$ warden approvals request --item 4 --item-kind pr --action merge --revision rev1 --evidence-digest e1 --subject-author dev1 --drain
approval requested: apr_1c68696ac464 (intent op_1c68696ac46476248a6a4f1cc3cbfd3e). Maintainers decide on GitHub with the command the writer posts on #4.
[exit 0]
```

## approvals list

```
$ warden approvals list --item 4
apr_1c68696ac464 action/merge pending expires 2026-11-19T18:39:50.933Z
[exit 0]
```

## status

```
$ warden status
warden 0.1.0-p1 status for acme/widgets (instance acme-widgets-d782c874, mode shadow)
local stop: running
credentials: automation enabled; none issued yet; ceiling present
journal: 0 unacknowledged local operation(s)
decisions recorded locally: 0
remote: sim; stop off; global dry-run off; ack envs: none
inbox: 0 pending, 0 failed/quarantined
  #3 issue not-adopted
  #4 pr needs-review approvals apr_1c68696ac464:pending
last sweep: {"state":"none recorded (sweep lands in P2)"}
[exit 0]
```

## stop (local first, then shared, confirmed)

```
$ warden stop --reason evidence drill --as maint1
local: STOPPED (new local model/verification work is refused)
no in-flight local run to cancel
remote (instance): CONFIRMED - stop label in force on #2, attributed to an operator
writer acknowledgements: none yet (unconfirmed until a writer acknowledges)
stop requested and confirmed on GitHub; writers act on it before their next task/effect. Already-accepted external effects are not recalled; they are reconciled.
[exit 0]
```

## run while stopped (blocked)

```
$ warden run --task intake --dry-run
run blocked: local stop in force (since 2026-11-18T18:39:50.944Z, by maint1). No model or verification work starts. Use `warden resume --confirm`.
[exit 4]
```

## writer drain while stopped (halts before any effect, acknowledges)

```
$ warden writer drain
writer actions/writer-24983 epoch 0: 0 processed {}; pending after: 0; repairs 0; creates 1
HALTED (stop): instance: warden:stop present
[exit 5]
```

## status while stopped

```
$ warden status
warden 0.1.0-p1 status for acme/widgets (instance acme-widgets-d782c874, mode shadow)
local stop: STOPPED since 2026-11-18T18:39:50.944Z by maint1
credentials: automation enabled; none issued yet; ceiling present
journal: 0 unacknowledged local operation(s)
decisions recorded locally: 0
remote: sim; stop IN FORCE; global dry-run off; ack envs: actions
inbox: 0 pending, 0 failed/quarantined
  #3 issue not-adopted
  #4 pr needs-review approvals apr_1c68696ac464:pending
last sweep: {"state":"none recorded (sweep lands in P2)"}
[exit 0]
```

## resume without confirmation (refused)

```
$ warden resume
NOT resumed: local stopped, remote unknown - resume requires explicit confirmation: re-run with --confirm
resume starts no AI work, restores no revoked authority and resets no retry/rework counts
[exit 1]
```

## resume --confirm

```
$ warden resume --confirm --as maint1
RESUMED: local running, remote running
resume starts no AI work, restores no revoked authority and resets no retry/rework counts
[exit 0]
```

## stop while GitHub unreachable (UNCONFIRMED, not global success)

```
$ warden stop
local: STOPPED (new local model/verification work is refused)
no in-flight local run to cancel
remote (instance): UNCONFIRMED - propagation failed: simulated outage
writer acknowledgements: none yet (unconfirmed until a writer acknowledges)
WARNING: the shared stop is NOT confirmed. Global success is not claimed; writers may continue until the stop propagates.
[exit 2]
```

## status while GitHub unreachable

```
$ warden status
warden 0.1.0-p1 status for acme/widgets (instance acme-widgets-d782c874, mode shadow)
local stop: STOPPED since 2026-11-18T18:39:50.953Z by maint1
credentials: automation enabled; none issued yet; ceiling present
journal: 0 unacknowledged local operation(s)
decisions recorded locally: 0
remote: UNREACHABLE (simulated outage); remote stop/pending state is UNKNOWN
last sweep: {"state":"none recorded (sweep lands in P2)"}
[exit 0]
```
